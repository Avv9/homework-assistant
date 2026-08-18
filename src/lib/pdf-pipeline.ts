/**
 * PDF Processing Pipeline
 *
 * Flow:
 *  1. Validate PDF (magic bytes, size, page count)
 *  2. Try text extraction via pdf-parse v2
 *  3. If text too short → detect as scanned/image-based
 *  4. Convert pages to images → vision model (structured JSON)
 *  5. Fallback: tesseract OCR → text-based Q/A split
 *  6. Store extracted Q/A pairs for admin review (never auto-publish low-confidence)
 */

import path from "path";
import { config } from "./config";
import { normalize } from "./search";
import { embed } from "./embeddings";
import type { AdminRepo } from "./repo/interface";

// ─── Exported types ──────────────────────────────────────────────────────────

export interface ProcessedPair {
  questionNumber: number;
  questionText: string;
  choices: string[];
  selectedAnswer: string | null;
  answerText: string;
  pageNumber: number;
  confidence: number;
  needsReview: boolean;
}

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  isScanned: boolean;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PDF_TEXT_MIN_LENGTH = Number(process.env.PDF_TEXT_MIN_LENGTH ?? 50);

// ─── Magic-byte PDF validation ───────────────────────────────────────────────

export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf.slice(0, 4).toString("binary") === "%PDF";
}

// ─── Worker / canvas bootstrap (run once) ────────────────────────────────────

let _pdfParseClass: Awaited<ReturnType<typeof bootstrapPdfParse>> | null = null;

async function bootstrapPdfParse() {
  // pdf-parse v2 uses pdfjs-dist internally. pdfjs-dist requires browser
  // Canvas globals (DOMMatrix, ImageData, Path2D) in Node. We polyfill
  // them with @napi-rs/canvas before the first import.
  const canvas = await import("@napi-rs/canvas");
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= canvas.DOMMatrix;
  g.ImageData ??= canvas.ImageData;
  if (canvas.Path2D) g.Path2D ??= canvas.Path2D;

  const { PDFParse } = await import("pdf-parse");
  const { getData } = await import("pdf-parse/worker");
  PDFParse.setWorker(getData());
  return PDFParse;
}

async function getPdfParser() {
  if (!_pdfParseClass) _pdfParseClass = await bootstrapPdfParse();
  return _pdfParseClass;
}

// ─── Step 1: Text extraction ─────────────────────────────────────────────────

export async function extractTextFromBuffer(buf: Buffer): Promise<PdfExtractionResult> {
  if (!isPdfBuffer(buf)) {
    return { text: "", pageCount: 0, isScanned: false, error: "Not a valid PDF file (invalid magic bytes)" };
  }

  try {
    const PDFParse = await getPdfParser();
    const parser = new PDFParse({ data: buf });

    let result: { text?: string; pages?: { text?: string }[]; total?: number };
    try {
      result = await parser.getText({ first: config.maxPdfPages });
    } catch (textErr) {
      console.error("[pdf-pipeline] getText error:", textErr);
      if (typeof parser.destroy === "function") await parser.destroy().catch(() => {});
      return { text: "", pageCount: 0, isScanned: true, error: "getText failed — likely scanned PDF" };
    }

    const text =
      typeof result?.text === "string"
        ? result.text
        : Array.isArray(result?.pages)
          ? result.pages.map((p) => p?.text ?? "").join("\n")
          : "";

    const rawPageCount =
      typeof result?.total === "number"
        ? result.total
        : Array.isArray(result?.pages)
          ? result.pages.length
          : 0;

    if (typeof parser.destroy === "function") await parser.destroy().catch(() => {});

    // Enforce page limit
    if (rawPageCount > config.maxPdfPages) {
      return {
        text: "",
        pageCount: rawPageCount,
        isScanned: false,
        error: `PDF has ${rawPageCount} pages. Maximum allowed is ${config.maxPdfPages} pages.`,
      };
    }

    const cleaned = text.replace(/\s+/g, " ").trim();
    const isScanned = cleaned.length < PDF_TEXT_MIN_LENGTH;

    return { text: cleaned, pageCount: Math.max(rawPageCount, 1), isScanned };
  } catch (e) {
    console.error("[pdf-pipeline] extractTextFromBuffer failed:", e);
    return {
      text: "",
      pageCount: 0,
      isScanned: true,
      error: `Text extraction failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ─── Step 2a: Extract images from a scanned PDF ──────────────────────────────

interface PdfPageImage {
  data: Buffer;
  pageNumber: number;
}

async function extractPageImages(buf: Buffer): Promise<PdfPageImage[]> {
  const PDFParse = await getPdfParser();
  const parser = new PDFParse({ data: buf });

  try {
    const result = await parser.getImage({
      first: config.maxPdfPages,
      imageBuffer: true,
    }) as { pages: { images: { data: Uint8Array | Buffer }[] }[]; total: number };

    const images: PdfPageImage[] = [];
    for (let pi = 0; pi < result.pages.length; pi++) {
      const page = result.pages[pi];
      for (const img of page.images ?? []) {
        images.push({
          data: Buffer.isBuffer(img.data) ? img.data : Buffer.from(img.data),
          pageNumber: pi + 1,
        });
      }
    }
    return images;
  } catch (e) {
    console.warn("[pdf-pipeline] getImage failed (will try whole-doc OCR):", e instanceof Error ? e.message : e);
    return [];
  } finally {
    if (typeof parser.destroy === "function") await parser.destroy().catch(() => {});
  }
}

// ─── Step 2b: Vision model — structured JSON extraction per page ──────────────

interface VisionQuestion {
  questionNumber: string | null;
  questionText: string;
  choices: string[];
  selectedAnswer: string | null;
  answer: string | null;
  pageNumber: number;
  confidence: number;
  needsReview: boolean;
}

const VISION_PROMPT = `You are analyzing a scanned homework/quiz page image from a university course management system (e.g. Blackboard/LMS).

Extract every question visible on this page. For each question return a JSON object with EXACTLY these fields:
{
  "questionNumber": "string or null",
  "questionText": "full question text",
  "choices": ["A. option text", "B. option text", ...],
  "selectedAnswer": "the choice text that is visually selected (green check, highlighted border, filled radio, 'Selected' label) — or null if none selected",
  "answer": "same as selectedAnswer if visible, otherwise null",
  "pageNumber": <page number passed in context>,
  "confidence": <float 0.0-1.0 how confident you are in the extraction>,
  "needsReview": <true if text is unclear, cut off, or answer is ambiguous>
}

Rules:
- If a multiple-choice option is marked with a green check mark, highlighted/colored border, filled radio button, or labeled "Selected" or "Correct" — set selectedAnswer to that choice text.
- If the answer cannot be determined visually, set selectedAnswer and answer to null and needsReview to true.
- If question text is partially visible or unclear, set needsReview to true.
- Preserve exact Arabic or English text.
- Return ONLY a valid JSON array. No markdown, no explanation, no code fences.`;

async function extractQuestionsFromImageVision(
  imageData: Buffer,
  pageNumber: number,
  fileName: string,
): Promise<VisionQuestion[]> {
  if (!config.aiApiKey) {
    throw new Error("Vision model unavailable: AI_API_KEY is not configured. Cannot process scanned PDF.");
  }

  const base64 = imageData.toString("base64");

  // Try to detect image type from magic bytes
  let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
  if (imageData[0] === 0x89 && imageData[1] === 0x50) mediaType = "image/png";
  else if (imageData[0] === 0x47 && imageData[1] === 0x49) mediaType = "image/gif";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fileProcessingTimeoutMs);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.aiApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.aiVisionModel,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              {
                type: "text",
                text: `${VISION_PROMPT}\n\nContext: This is page ${pageNumber} from file "${fileName}". Set "pageNumber" to ${pageNumber} for all extracted questions.`,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Vision API error ${res.status}: ${errText}`);
    }

    const data = await res.json() as { content?: { type: string; text?: string }[] };
    const raw = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    if (!raw) throw new Error("Vision model returned empty response");

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    let parsed: VisionQuestion[];
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Vision model returned invalid JSON: ${cleaned.slice(0, 200)}`);
    }

    if (!Array.isArray(parsed)) {
      // Model may return a single object
      parsed = [parsed as VisionQuestion];
    }

    return parsed.filter((q) => q && typeof q.questionText === "string" && q.questionText.trim());
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Step 2c: Vision on full PDF document (when no per-page images extracted) ─

async function extractQuestionsFromPdfVision(
  buf: Buffer,
  fileName: string,
): Promise<VisionQuestion[]> {
  if (!config.aiApiKey) {
    throw new Error("Vision model unavailable: AI_API_KEY is not configured. Cannot process scanned PDF.");
  }

  const base64 = buf.toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fileProcessingTimeoutMs);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.aiApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.aiVisionModel,
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
              },
              {
                type: "text",
                text: `${VISION_PROMPT}\n\nThis is the full PDF file named "${fileName}". Process all pages and set "pageNumber" to the actual page number for each question.`,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Vision API error ${res.status}: ${errText}`);
    }

    const data = await res.json() as { content?: { type: string; text?: string }[] };
    const raw = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    let parsed: VisionQuestion[];
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Vision model returned invalid JSON: ${cleaned.slice(0, 200)}`);
    }

    if (!Array.isArray(parsed)) parsed = [parsed as VisionQuestion];
    return parsed.filter((q) => q && typeof q.questionText === "string" && q.questionText.trim());
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Step 3: Tesseract OCR fallback ──────────────────────────────────────────

let tesseractLangPath: string | null = null;

function resolveTesseractLangPath(): string {
  if (tesseractLangPath) return tesseractLangPath;
  tesseractLangPath = path.join(process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0");
  return tesseractLangPath;
}

async function ocrWithTesseract(images: PdfPageImage[]): Promise<string> {
  if (images.length === 0) return "";

  try {
    const Tesseract = await import("tesseract.js");
    const worker = await Tesseract.createWorker("eng", 1, {
      langPath: resolveTesseractLangPath(),
      gzip: true,
      cachePath: "/tmp",
      cacheMethod: "none",
    });

    let text = "";
    try {
      for (const img of images) {
        const { data } = await worker.recognize(img.data);
        text += `\n--- Page ${img.pageNumber} ---\n${data.text}`;
      }
    } finally {
      await worker.terminate();
    }

    return text.trim();
  } catch (e) {
    console.error("[pdf-pipeline] Tesseract OCR failed:", e);
    return "";
  }
}

// ─── Step 4: Text-based Q/A extraction (for text PDFs) ───────────────────────

function extractAnswerKey(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const tail = text.slice(Math.max(0, text.length - 3000)).toUpperCase();
  const regex = /\b(\d{1,3})\s+([A-D])\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tail)) !== null) {
    const num = Number(match[1]);
    if (!Number.isNaN(num)) map.set(num, match[2]);
  }
  return map;
}

function parseQuestionBlocksFromText(text: string): ProcessedPair[] {
  const lines = text
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const qPattern = /^(\d{1,3})[.)]\s+(.*)$/;
  const optionPattern = /^([a-d])[.)]\s+(.*)$/i;
  const answerKey = extractAnswerKey(text);

  interface Block {
    num: number;
    parts: string[];
    options: Record<string, string>;
  }

  const blocks: Block[] = [];
  let cur: Block | null = null;

  for (const line of lines) {
    const qm = line.match(qPattern);
    if (qm) {
      if (cur) blocks.push(cur);
      cur = { num: Number(qm[1]), parts: [qm[2].trim()], options: {} };
      continue;
    }
    if (!cur) continue;
    const om = line.match(optionPattern);
    if (om) { cur.options[om[1].toUpperCase()] = om[2].trim(); continue; }
    if (/^(?:\d+\s+[A-D]\s*){2,}$/i.test(line)) continue; // answer key row
    cur.parts.push(line);
  }
  if (cur) blocks.push(cur);

  if (blocks.length === 0) {
    return [{
      questionNumber: 1,
      questionText: text.slice(0, 500).trim(),
      choices: [],
      selectedAnswer: null,
      answerText: "",
      pageNumber: 1,
      confidence: 0.3,
      needsReview: true,
    }];
  }

  return blocks.map((b) => {
    const letter = answerKey.get(b.num);
    const answerText = letter ? (b.options[letter] ?? letter) : "";
    const choices = Object.entries(b.options).map(([k, v]) => `${k}. ${v}`);
    return {
      questionNumber: b.num,
      questionText: b.parts.join(" ").trim(),
      choices,
      selectedAnswer: letter ? (b.options[letter] ?? null) : null,
      answerText,
      pageNumber: 1,
      confidence: answerText ? 0.82 : 0.62,
      needsReview: !answerText,
    };
  });
}

async function splitTextWithAI(rawText: string, fileName: string, locale: "ar" | "en"): Promise<ProcessedPair[]> {
  if (!config.aiApiKey) return parseQuestionBlocksFromText(rawText);

  const lang = locale === "ar" ? "Arabic" : "English";
  const prompt = `Extract homework questions and answers from this university course file named "${fileName}".

Content:
---
${rawText.slice(0, 12000)}
---

Return ONLY a valid JSON array, no markdown, no explanation.
Each element:
{
  "questionNumber": number,
  "questionText": "string",
  "choices": ["string"],
  "selectedAnswer": "string or null",
  "answerText": "string",
  "pageNumber": number,
  "confidence": number,
  "needsReview": boolean
}

If there is an answer key mapping question numbers to letters (A/B/C/D), map each to the correct choice text.
Respond in ${lang} where applicable.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.fileProcessingTimeoutMs);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": config.aiApiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: config.aiAnswerModel, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json() as { content?: { type: string; text?: string }[] };
    const raw = (data.content ?? []).map((b) => b.text ?? "").join("").trim();
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const parsed = JSON.parse(clean) as ProcessedPair[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return parseQuestionBlocksFromText(rawText);
  } catch {
    return parseQuestionBlocksFromText(rawText);
  }
}

// ─── Vision results → ProcessedPair ──────────────────────────────────────────

function visionToProcessedPairs(questions: VisionQuestion[]): ProcessedPair[] {
  return questions.map((q, i) => ({
    questionNumber: q.questionNumber ? Number(q.questionNumber) || (i + 1) : (i + 1),
    questionText: q.questionText?.trim() ?? "",
    choices: Array.isArray(q.choices) ? q.choices : [],
    selectedAnswer: q.selectedAnswer ?? null,
    answerText: q.answer ?? q.selectedAnswer ?? "",
    pageNumber: q.pageNumber ?? 1,
    confidence: Math.min(1, Math.max(0, q.confidence ?? 0.6)),
    needsReview: q.needsReview ?? !q.answer,
  }));
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function processPdfFile(opts: {
  fileId: string;
  buf: Buffer;
  fileName: string;
  courseId: string;
  assignmentId: string;
  locale: "ar" | "en";
  repo: AdminRepo;
}): Promise<void> {
  const { fileId, buf, fileName, courseId, assignmentId, locale, repo } = opts;

  await repo.updateFile(fileId, { status: "processing" });

  try {
    // ── Step 1: Try text extraction ───────────────────────────────────────────
    const extraction = await extractTextFromBuffer(buf);

    // Page limit exceeded — fail fast with a clear message
    if (extraction.error?.includes("pages. Maximum")) {
      await repo.updateFile(fileId, { status: "failed", processingError: extraction.error });
      return;
    }

    let pairs: ProcessedPair[] = [];

    if (!extraction.isScanned && extraction.text.length >= PDF_TEXT_MIN_LENGTH) {
      // ── Text-based PDF ────────────────────────────────────────────────────
      await repo.updateFile(fileId, { pageCount: extraction.pageCount, status: "processing" });
      pairs = await splitTextWithAI(extraction.text, fileName, locale);
    } else {
      // ── Scanned / image-based PDF ─────────────────────────────────────────
      console.log(`[pdf-pipeline] "${fileName}" detected as scanned PDF (text length: ${extraction.text.length}). Using vision pipeline.`);

      // First try: extract embedded page images and run vision per-image
      const pageImages = await extractPageImages(buf);

      if (pageImages.length > 0 && config.aiApiKey) {
        // Per-image vision (most accurate for LMS-style PDFs)
        const allQuestions: VisionQuestion[] = [];
        for (const img of pageImages) {
          try {
            const qs = await extractQuestionsFromImageVision(img.data, img.pageNumber, fileName);
            allQuestions.push(...qs);
          } catch (e) {
            console.warn(`[pdf-pipeline] Vision failed for page ${img.pageNumber}:`, e instanceof Error ? e.message : e);
          }
        }
        if (allQuestions.length > 0) {
          pairs = visionToProcessedPairs(allQuestions);
        }
      }

      // Second try: pass whole PDF to vision model as a document
      if (pairs.length === 0 && config.aiApiKey) {
        try {
          const questions = await extractQuestionsFromPdfVision(buf, fileName);
          pairs = visionToProcessedPairs(questions);
        } catch (e) {
          console.warn("[pdf-pipeline] Whole-PDF vision failed:", e instanceof Error ? e.message : e);
        }
      }

      // Third try: Tesseract local OCR → text-based split (no API key needed)
      if (pairs.length === 0) {
        let ocrText = "";
        if (pageImages.length > 0) {
          ocrText = await ocrWithTesseract(pageImages);
        }
        if (ocrText.trim().length >= PDF_TEXT_MIN_LENGTH) {
          pairs = await splitTextWithAI(ocrText, fileName, locale);
        }
      }

      // All methods failed
      if (pairs.length === 0) {
        const reason = config.aiApiKey
          ? "Could not extract questions from scanned PDF — vision model returned no results."
          : "Scanned PDF detected but no AI_API_KEY is configured. Vision OCR is unavailable. Please set AI_API_KEY to process scanned PDFs, or upload a text-based PDF.";
        await repo.updateFile(fileId, {
          status: "failed",
          processingError: reason,
          pageCount: extraction.pageCount || pageImages.length || 1,
        });
        return;
      }

      await repo.updateFile(fileId, {
        pageCount: extraction.pageCount || pageImages.length || 1,
        status: "processing",
      });
    }

    // ── Save extracted pairs ──────────────────────────────────────────────────
    for (const pair of pairs) {
      if (!pair.questionText.trim()) continue;

      // Low-confidence items always go to review, never auto-published
      const shouldAutoPublish = false; // always require review

      const q = await repo.createExtractedQuestion({
        sourceFileId: fileId,
        courseId,
        assignmentId,
        questionNumber: pair.questionNumber,
        questionText: pair.questionText.trim(),
        normalizedText: normalize(pair.questionText),
        answerText: pair.answerText.trim(),
        pageNumber: pair.pageNumber,
        confidence: pair.confidence,
        published: shouldAutoPublish,
      });

      // Generate embedding if configured
      if (config.embeddingEnabled) {
        const vector = await embed(pair.questionText);
        if (vector) await repo.storeEmbedding(q.id, vector);
      }
    }

    await repo.updateFile(fileId, { status: "needs_review" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[pdf-pipeline] processPdfFile error:", msg);
    await repo.updateFile(fileId, {
      status: "failed",
      processingError: `Processing failed: ${msg}`,
    });
  }
}
