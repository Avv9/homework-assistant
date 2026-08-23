/**
 * pdf-pipeline.ts
 *
 * Supports BOTH text-based and scanned/image-based PDFs (e.g. Blackboard LMS).
 *
 * Vision providers (in priority order):
 *   1. Anthropic Claude  — when AI_API_KEY is set  (paid, best quality)
 *   2. Google Gemini     — when GEMINI_API_KEY is set  (FREE, great quality)
 *   3. Tesseract.js      — always available, no key needed  (free, offline)
 */

import { config, pdfConfig } from "./config";
import { normalize } from "./search";
import { embed } from "./embeddings";
import type { AdminRepo } from "./repo/interface";

// ─── Types ────────────────────────────────────────────────────────────────────

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

export type PdfKind = "text" | "scanned";

export interface ExtractionResult {
  text: string;
  pageCount: number;
  kind: PdfKind;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class PdfPageLimitError extends Error {
  constructor(message: string, public readonly actualPages: number, public readonly limit: number) {
    super(message);
    this.name = "PdfPageLimitError";
  }
}

export class VisionUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "VisionUnavailableError"; }
}

// ─── Magic bytes ──────────────────────────────────────────────────────────────

export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf.slice(0, 4).toString("binary") === "%PDF";
}

// ─── pdf-parse init ───────────────────────────────────────────────────────────

let _pdfInit: Promise<typeof import("pdf-parse")["PDFParse"]> | null = null;

async function getPdfParser() {
  if (!_pdfInit) {
    _pdfInit = (async () => {
      const canvas = await import("@napi-rs/canvas");
      const g = globalThis as Record<string, unknown>;
      g.DOMMatrix ??= canvas.DOMMatrix;
      g.ImageData ??= canvas.ImageData;
      if (canvas.Path2D) g.Path2D ??= canvas.Path2D;
      const mod = await import("pdf-parse");
      const { getData } = await import("pdf-parse/worker");
      mod.PDFParse.setWorker(getData());
      return mod.PDFParse;
    })();
  }
  return _pdfInit;
}

// ─── Text extraction ──────────────────────────────────────────────────────────

export async function extractPdfText(buf: Buffer, maxPages: number): Promise<ExtractionResult> {
  const PDFParse = await getPdfParser();
  const parser = new PDFParse({ data: buf });
  let text = "";
  let pageCount = 0;

  try {
    const result = await parser.getText({ first: maxPages });
    text = typeof result?.text === "string" ? result.text
      : Array.isArray(result?.pages)
        ? (result.pages as Array<{ text?: string }>).map(p => p?.text ?? "").join("\n")
        : "";
    pageCount = typeof result?.total === "number" ? result.total
      : Array.isArray(result?.pages) ? (result.pages as unknown[]).length : 0;

    if (pageCount > maxPages) {
      throw new PdfPageLimitError(
        `PDF has ${pageCount} pages but the limit is ${maxPages}. Please split the file.`,
        pageCount, maxPages,
      );
    }
  } finally {
    await parser.destroy?.();
  }

  // Strip pdf-parse page separators ("-- N of M --") — these are NOT real content
  const meaningful = text
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const kind: PdfKind = meaningful.length < pdfConfig.pdfTextMinLength ? "scanned" : "text";
  return { text: meaningful, pageCount: pageCount || 1, kind };
}

// ─── Embedded image extraction ────────────────────────────────────────────────

interface EmbeddedImage {
  pageNumber: number;
  imageIndex: number;
  dataUrl: string;
  sizeBytes: number;
}

async function extractEmbeddedImages(buf: Buffer, maxPages: number): Promise<EmbeddedImage[]> {
  const PDFParse = await getPdfParser();
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getImage({ first: maxPages, imageBuffer: true });
    const images: EmbeddedImage[] = [];
    for (const page of (result.pages as Array<{ pageNumber: number; images: Array<{ dataUrl: string; data?: { length: number } }> }>) ?? []) {
      for (let i = 0; i < (page.images ?? []).length; i++) {
        const img = page.images[i];
        if (!img.dataUrl) continue;
        const sizeBytes = img.data?.length ?? Math.round(img.dataUrl.length * 0.75);
        if (sizeBytes < 10000) continue; // skip tiny icons/bullets
        images.push({ pageNumber: page.pageNumber, imageIndex: i, dataUrl: img.dataUrl, sizeBytes });
      }
    }
    return images;
  } finally {
    await parser.destroy?.();
  }
}

// ─── Vision provider selection ────────────────────────────────────────────────

function getVisionProvider(): "anthropic" | "gemini" | "tesseract" {
  if (config.aiApiKey) return "anthropic";
  if (config.geminiApiKey) return "gemini";
  return "tesseract";
}

// ─── Anthropic vision ─────────────────────────────────────────────────────────

async function visionWithAnthropic(b64: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fileProcessingTimeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": config.aiApiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: pdfConfig.visionModel,
        max_tokens: 2048,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
          { type: "text", text: prompt },
        ]}],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text().catch(() => "")}`);
    const data = await res.json();
    return (data.content ?? []).map((b: { type: string; text?: string }) => b.text ?? "").join("").trim();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Gemini vision (FREE) ─────────────────────────────────────────────────────

async function visionWithGemini(b64: string, prompt: string): Promise<string> {
  const model = config.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fileProcessingTimeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inlineData: { mimeType: "image/png", data: b64 } },
          { text: prompt },
        ]}],
        generationConfig: { maxOutputTokens: 2048 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text().catch(() => "")}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

// ─── AI vision → structured JSON ─────────────────────────────────────────────

async function extractFromImageWithAI(
  image: EmbeddedImage,
  fileName: string,
  locale: "ar" | "en",
  provider: "anthropic" | "gemini",
): Promise<ProcessedPair[]> {
  const lang = locale === "ar" ? "Arabic" : "English";
  const b64 = image.dataUrl.replace(/^data:[^;]+;base64,/, "");

  const prompt = `This image is from page ${image.pageNumber} of a university assignment PDF named "${fileName}".
Extract every question visible. Return ONLY a JSON array — no markdown, no explanation.

Schema per element:
{
  "questionNumber": "string or null",
  "questionText": "full question text",
  "choices": ["choice text"],
  "selectedAnswer": "text of selected option or null",
  "answer": "same as selectedAnswer if selected, else null",
  "pageNumber": ${image.pageNumber},
  "confidence": 0.9,
  "needsReview": false
}

Rules:
- Filled radio (●) or row highlighted or "Selected" label → selectedAnswer.
- No answer selected → selectedAnswer: null, needsReview: true.
- No question on this image → return [].
- Respond in ${lang}. Return valid JSON array only.`;

  const raw = provider === "anthropic"
    ? await visionWithAnthropic(b64, prompt)
    : await visionWithGemini(b64, prompt);

  const clean = raw.replace(/```json|```/g, "").trim();
  if (!clean || clean === "[]") return [];

  let parsed: Array<{
    questionNumber?: string | number | null;
    questionText?: string;
    choices?: string[];
    selectedAnswer?: string | null;
    answer?: string | null;
    pageNumber?: number;
    confidence?: number;
    needsReview?: boolean;
  }>;

  try {
    parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    return [];
  }

  return parsed
    .filter(item => typeof item.questionText === "string" && item.questionText.trim().length > 3)
    .map((item, idx) => {
      const sel = item.selectedAnswer ?? item.answer ?? null;
      const qNum = typeof item.questionNumber === "number" ? item.questionNumber
        : typeof item.questionNumber === "string" ? (parseInt(item.questionNumber, 10) || image.imageIndex + idx + 1)
        : image.imageIndex + idx + 1;
      return {
        questionNumber: qNum,
        questionText: (item.questionText ?? "").trim(),
        choices: Array.isArray(item.choices) ? item.choices : [],
        selectedAnswer: sel,
        answerText: sel ?? "",
        pageNumber: item.pageNumber ?? image.pageNumber,
        confidence: typeof item.confidence === "number" ? item.confidence : (sel ? 0.88 : 0.5),
        needsReview: !sel,
      };
    });
}

// ─── Tesseract OCR → ParsedQuestion → ProcessedPair ──────────────────────────

async function extractFromImageWithTesseract(
  image: EmbeddedImage,
  globalImageIndex: number,
): Promise<ProcessedPair[]> {
  const { ocrImage, parseBlackboardOcr } = await import("./tesseract-ocr");
  const b64 = image.dataUrl.replace(/^data:[^;]+;base64,/, "");
  const imgBuf = Buffer.from(b64, "base64");

  const { text, confidence } = await ocrImage(imgBuf);
  if (!text.trim()) return [];

  const parsed = parseBlackboardOcr(text, globalImageIndex + 1);

  // Skip if no real question text was found
  if (!parsed.questionText || parsed.questionText.length < 5) return [];

  return [{
    questionNumber: parsed.questionNumber ?? globalImageIndex + 1,
    questionText: parsed.questionText,
    choices: parsed.choices,
    selectedAnswer: parsed.selectedAnswer,
    answerText: parsed.selectedAnswer ?? "",
    pageNumber: image.pageNumber,
    confidence: Math.min(parsed.confidence, confidence > 0 ? confidence : 0.75),
    needsReview: parsed.needsReview,
  }];
}

// ─── Text-based: AI Q/A split ─────────────────────────────────────────────────

async function splitTextWithAI(rawText: string, fileName: string, locale: "ar" | "en"): Promise<ProcessedPair[]> {
  const lang = locale === "ar" ? "Arabic" : "English";
  const prompt = `Extract homework questions and answers from this university course file named "${fileName}".
Content:
---
${rawText.slice(0, 12000)}
---
Return ONLY a JSON array. Each element: { "questionNumber": number, "questionText": string, "choices": [string], "selectedAnswer": string|null, "answerText": string, "pageNumber": number, "confidence": number, "needsReview": boolean }
Set needsReview: true if answerText is empty. Respond in ${lang}. Return valid JSON array only.`;

  try {
    let raw = "";
    const provider = getVisionProvider();
    if (provider === "anthropic" && config.aiApiKey) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": config.aiApiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: config.aiAnswerModel, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      raw = (data.content ?? []).map((b: { type: string; text?: string }) => b.text ?? "").join("").trim();
    } else if (provider === "gemini" && config.geminiApiKey) {
      raw = await visionWithGemini("", prompt).catch(() => "");
    }
    if (raw) {
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean) as ProcessedPair[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* fall through */ }

  return splitTextFallback(rawText);
}

// ─── Blackboard-aware regex fallback ─────────────────────────────────────────

function splitTextFallback(text: string): ProcessedPair[] {
  // ── Format: "Q1: question A) opt B) opt Answer: B" (inline) ──────────────
  // Split on "Q1: ... Q2: ..." inline format
  const inlineSplit = text.split(/Q(\d+):\s*/);
  const inlineMatches: Array<[string, string]> = [];
  for (let i = 1; i < inlineSplit.length - 1; i += 2) {
    inlineMatches.push([inlineSplit[i], inlineSplit[i + 1] ?? ""]);
  }
  if (inlineMatches.length > 1) {
    const pairs: ProcessedPair[] = [];
    for (const m of inlineMatches) {
      const qNum = parseInt(m[0], 10);
      const block = m[1].trim();
      // Extract answer: "Answer: B (False)" or "Answer: A"
      const answerMatch = block.match(/Answer:\s*([A-D])(?:\s*\(([^)]+)\))?/i);
      const answerLetter = answerMatch?.[1]?.toUpperCase() ?? null;
      const answerFull = answerMatch?.[2] ?? answerLetter ?? null;
      // Remove answer part from block to get question + choices
      const withoutAnswer = block.replace(/Answer:\s*[A-D][^Q]*/i, "").trim();
      // Extract choices: "A) text B) text"
      const choiceParts = withoutAnswer.match(/[A-D]\)\s*[^A-D)]+/g) ?? [];
      const choices = choiceParts.map(c => c.trim());
      // Question text = everything before first choice
      const firstChoiceIdx = withoutAnswer.search(/[A-D]\)/);
      const questionText = firstChoiceIdx > 0 ? withoutAnswer.slice(0, firstChoiceIdx).trim() : withoutAnswer;
      const selectedChoice = answerLetter ? choices.find(c => c.startsWith(answerLetter)) ?? answerFull ?? "" : "";
      pairs.push({
        questionNumber: qNum, questionText, choices,
        selectedAnswer: selectedChoice || null, answerText: selectedChoice || answerFull || "",
        pageNumber: 1, confidence: answerFull ? 0.88 : 0.6, needsReview: !answerFull,
      });
    }
    if (pairs.length > 0) return pairs;
  }

  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const bbPattern = /^Question\s+(\d+)/i;
  const selectedSuffix = /\s*Selected\s*$/i;
  const radioPrefix = /^[\(©OoO○●\u00A9\u25CB\u25CF]+\s*/;
  const skipPatterns = [/^\d+(\.\d+)?\s+Points?$/i, /^-- \d+ of \d+ --$/, /^Clear selection$/i, /^Page \d+ of \d+/i];

  const blocks: ProcessedPair[] = [];
  let cur: { num: number; parts: string[]; choices: string[]; selected: string | null; page: number } | null = null;

  for (const line of lines) {
    if (skipPatterns.some(p => p.test(line))) continue;
    const bbm = line.match(bbPattern);
    if (bbm) {
      if (cur) blocks.push(finalize(cur));
      cur = { num: parseInt(bbm[1], 10), parts: [], choices: [], selected: null, page: 1 };
      const rest = line.replace(bbm[0], "").trim();
      if (rest) cur.parts.push(rest);
      continue;
    }
    if (!cur) continue;

    const isSelected = selectedSuffix.test(line);
    const cleanLine = line.replace(selectedSuffix, "").trim();
    const isRadio = radioPrefix.test(cleanLine) || /^(True|False)$/i.test(cleanLine);

    if (isRadio) {
      const choiceText = cleanLine.replace(radioPrefix, "").trim();
      if (choiceText.length < 2) continue;
      cur.choices.push(choiceText);
      if (isSelected) cur.selected = choiceText;
    } else {
      cur.parts.push(cleanLine + (isSelected ? " (Selected)" : ""));
    }
  }
  if (cur) blocks.push(finalize(cur));

  if (blocks.length === 0) {
    return [{ questionNumber: 1, questionText: lines.slice(0, 10).join(" "), choices: [], selectedAnswer: null, answerText: "", pageNumber: 1, confidence: 0.3, needsReview: true }];
  }
  return blocks;
}

function finalize(cur: { num: number; parts: string[]; choices: string[]; selected: string | null; page: number }): ProcessedPair {
  return {
    questionNumber: cur.num, questionText: cur.parts.join(" ").trim(),
    choices: cur.choices, selectedAnswer: cur.selected, answerText: cur.selected ?? "",
    pageNumber: cur.page, confidence: cur.selected ? 0.82 : 0.55, needsReview: !cur.selected,
  };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

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
    // Step 1: Try text extraction
    let extraction: ExtractionResult;
    try {
      extraction = await extractPdfText(buf, config.maxPdfPages);
    } catch (e) {
      if (e instanceof PdfPageLimitError) {
        await repo.updateFile(fileId, { status: "failed", processingError: e.message });
        return;
      }
      await repo.updateFile(fileId, { status: "failed", processingError: `Text extraction failed: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    await repo.updateFile(fileId, { pageCount: extraction.pageCount, status: "processing" });

    let pairs: ProcessedPair[] = [];
    const provider = getVisionProvider();

    if (extraction.kind === "text") {
      // Text-based PDF
      pairs = await splitTextWithAI(extraction.text, fileName, locale);
    } else {
      // Scanned / image-based PDF
      let embeddedImages: EmbeddedImage[] = [];
      try {
        embeddedImages = await extractEmbeddedImages(buf, config.maxPdfPages);
      } catch (e) {
        await repo.updateFile(fileId, { status: "failed", processingError: `Image extraction failed: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }

      if (embeddedImages.length === 0) {
        await repo.updateFile(fileId, { status: "failed", processingError: "PDF has no text and no embedded images. Please upload a clearer PDF." });
        return;
      }

      const errors: string[] = [];

      for (let idx = 0; idx < embeddedImages.length; idx++) {
        const image = embeddedImages[idx];
        try {
          let imgPairs: ProcessedPair[];

          if (provider === "anthropic" || provider === "gemini") {
            imgPairs = await extractFromImageWithAI(image, fileName, locale, provider);
          } else {
            // Tesseract — free, offline
            imgPairs = await extractFromImageWithTesseract(image, idx);
          }

          pairs.push(...imgPairs);
        } catch (e) {
          errors.push(`Page ${image.pageNumber} img ${image.imageIndex}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (pairs.length === 0) {
        await repo.updateFile(fileId, {
          status: "failed",
          processingError: errors.length > 0 ? `OCR failed on all images: ${errors[0]}` : "No questions could be extracted.",
        });
        return;
      }
    }

    // Deduplicate + sort
    const seen = new Set<string>();
    const unique = pairs.filter(p => {
      if (!p.questionText.trim() || p.questionText.length < 5) return false;
      const key = p.questionNumber + ":" + p.questionText.slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) => a.questionNumber - b.questionNumber);

    // Persist
    for (const pair of unique) {
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
        published: false,
      });

      if (config.embeddingEnabled) {
        const vector = await embed(pair.questionText);
        if (vector) await repo.storeEmbedding(q.id, vector);
      }
    }

    const providerNote = provider === "tesseract" ? " (OCR via Tesseract — review carefully)" : "";
    await repo.updateFile(fileId, {
      status: "needs_review",
      processingError: providerNote || undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[pdf-pipeline] fatal:", msg);
    await repo.updateFile(fileId, { status: "failed", processingError: msg });
  }
}
