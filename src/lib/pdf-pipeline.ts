/**
 * pdf-pipeline.ts — handles text-based AND scanned/image-based PDFs
 *
 * Strategy for Blackboard/LMS PDFs (like this project's main use case):
 *  - These PDFs embed each question as a separate PNG image inside the PDF.
 *  - pdf-parse getText() returns empty text (the text is inside the images).
 *  - We use pdf-parse getImage() to extract every embedded image.
 *  - Each image is sent to the Claude vision model independently.
 *  - The model returns structured JSON per image with question + selected answer.
 */

import { config, pdfConfig } from "./config";
import { normalize } from "./search";
import { embed } from "./embeddings";
import type { AdminRepo } from "./repo/interface";

// ─── Public types ─────────────────────────────────────────────────────────────

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

// ─── Custom errors ─────────────────────────────────────────────────────────────

export class PdfPageLimitError extends Error {
  constructor(message: string, public readonly actualPages: number, public readonly limit: number) {
    super(message);
    this.name = "PdfPageLimitError";
  }
}

export class VisionUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "VisionUnavailableError"; }
}

export class ScannedPdfNoVisionError extends Error {
  constructor() {
    super(
      "This PDF is image-based (no text layer). Vision OCR is required but AI_API_KEY is not configured."
    );
    this.name = "ScannedPdfNoVisionError";
  }
}

// ─── Magic-byte check ─────────────────────────────────────────────────────────

export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf.slice(0, 4).toString("binary") === "%PDF";
}

// ─── pdf-parse initialisation (once per process) ─────────────────────────────

type PDFParseClass = Awaited<ReturnType<typeof initPdfParse>>;
let _initPromise: Promise<PDFParseClass> | null = null;

async function initPdfParse() {
  const canvas = await import("@napi-rs/canvas");
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= canvas.DOMMatrix;
  g.ImageData ??= canvas.ImageData;
  if (canvas.Path2D) g.Path2D ??= canvas.Path2D;

  const mod = await import("pdf-parse");
  const { getData } = await import("pdf-parse/worker");
  mod.PDFParse.setWorker(getData());
  return mod.PDFParse;
}

async function getPdfParser() {
  if (!_initPromise) _initPromise = initPdfParse();
  return _initPromise;
}

// ─── Embedded image extraction (Blackboard / LMS PDFs) ───────────────────────

interface EmbeddedImage {
  pageNumber: number;
  imageIndex: number;
  dataUrl: string;   // data:image/png;base64,...
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
        // Skip tiny images (icons, bullets) — less than 10 KB is probably not a question
        if (sizeBytes < 10000) continue;
        images.push({
          pageNumber: page.pageNumber,
          imageIndex: i,
          dataUrl: img.dataUrl,
          sizeBytes,
        });
      }
    }
    return images;
  } finally {
    await parser.destroy?.();
  }
}

// ─── Text extraction ──────────────────────────────────────────────────────────

export async function extractPdfText(buf: Buffer, maxPages: number): Promise<ExtractionResult> {
  const PDFParse = await getPdfParser();
  const parser = new PDFParse({ data: buf });

  let text = "";
  let pageCount = 0;

  try {
    const result = await parser.getText({ first: maxPages });

    text =
      typeof result?.text === "string"
        ? result.text
        : Array.isArray(result?.pages)
          ? (result.pages as Array<{ text?: string }>).map(p => p?.text ?? "").join("\n")
          : "";

    pageCount =
      typeof result?.total === "number"
        ? result.total
        : Array.isArray(result?.pages)
          ? (result.pages as unknown[]).length
          : 0;

    if (pageCount > maxPages) {
      throw new PdfPageLimitError(
        `PDF has ${pageCount} pages but the limit is ${maxPages}. Please split the file.`,
        pageCount,
        maxPages,
      );
    }
  } finally {
    await parser.destroy?.();
  }

  const trimmed = text.trim();

  // Strip pdf-parse page separators ("-- N of M --") before checking
  // if the PDF actually has a real text layer. These markers are always
  // present and would fool the length check into thinking this is text-based.
  const meaningful = trimmed
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const kind: PdfKind = meaningful.length < pdfConfig.pdfTextMinLength ? "scanned" : "text";
  return { text: meaningful, pageCount: pageCount || 1, kind };
}

// ─── Vision: one image → one or more Q/A pairs ───────────────────────────────

async function extractFromImage(
  image: EmbeddedImage,
  fileName: string,
  locale: "ar" | "en",
): Promise<ProcessedPair[]> {
  const apiKey = config.aiApiKey;
  if (!apiKey) throw new VisionUnavailableError("AI_API_KEY is not configured.");

  const lang = locale === "ar" ? "Arabic" : "English";
  const b64 = image.dataUrl.replace(/^data:[^;]+;base64,/, "");

  const prompt = `This image is from page ${image.pageNumber} of a university assignment PDF named "${fileName}".
It shows one or more multiple-choice or true/false questions from a Blackboard/LMS submission.

Extract every question visible and return ONLY a JSON array — no markdown, no explanation.

Each element must follow this exact schema:
{
  "questionNumber": "string or null",
  "questionText": "the complete question text",
  "choices": ["A. text", "B. text", ...],
  "selectedAnswer": "the text of the selected/highlighted option, or null",
  "answer": "same as selectedAnswer if clearly selected, else null",
  "pageNumber": ${image.pageNumber},
  "confidence": 0.9,
  "needsReview": false
}

IMPORTANT rules:
- If a radio button is FILLED (●) or the row is highlighted or shows "Selected" label → that is the selectedAnswer.
- Preserve the full question text including any data tables or lists within the question.
- If no answer is selected → selectedAnswer: null, needsReview: true, confidence: 0.5.
- If the image contains NO question (e.g. header only) → return [].
- Respond in ${lang} only if the source text is in ${lang}.
- Return valid JSON array only.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fileProcessingTimeoutMs);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: pdfConfig.visionModel,
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
            { type: "text", text: prompt },
          ],
        }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Vision API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const raw = (data.content ?? [])
      .map((b: { type: string; text?: string }) => b.text ?? "")
      .join("")
      .trim()
      .replace(/```json|```/g, "")
      .trim();

    if (!raw || raw === "[]") return [];

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
      parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      throw new Error(`Vision model returned invalid JSON for page ${image.pageNumber} image ${image.imageIndex}. Raw: ${raw.slice(0, 300)}`);
    }

    return parsed
      .filter(item => typeof item.questionText === "string" && item.questionText.trim().length > 3)
      .map((item, idx) => {
        const sel = item.selectedAnswer ?? item.answer ?? null;
        const qNum =
          typeof item.questionNumber === "number" ? item.questionNumber :
          typeof item.questionNumber === "string" ? (parseInt(item.questionNumber, 10) || (image.imageIndex * 10 + idx + 1)) :
          image.imageIndex * 10 + idx + 1;

        return {
          questionNumber: qNum,
          questionText: (item.questionText ?? "").trim(),
          choices: Array.isArray(item.choices) ? item.choices : [],
          selectedAnswer: sel,
          answerText: sel ?? "",
          pageNumber: item.pageNumber ?? image.pageNumber,
          confidence: typeof item.confidence === "number" ? item.confidence : (sel ? 0.88 : 0.5),
          needsReview: item.needsReview !== false ? true : !sel,
        };
      });
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Text-based: AI Q/A split ─────────────────────────────────────────────────

async function splitTextWithAI(rawText: string, fileName: string, locale: "ar" | "en"): Promise<ProcessedPair[]> {
  if (!config.aiApiKey) return splitTextFallback(rawText);

  const lang = locale === "ar" ? "Arabic" : "English";
  const prompt = `Extract homework questions and answers from this university course file named "${fileName}".

Content:
---
${rawText.slice(0, 12000)}
---

Return ONLY a JSON array (no markdown). Each element:
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

- If you see "Selected" after an option, that is the answer.
- Set needsReview: true if answerText is empty or unclear.
- Respond in ${lang}.
- Return valid JSON array only.`;

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
    if (!res.ok) return splitTextFallback(rawText);
    const data = await res.json();
    const text = (data.content ?? []).map((b: { type: string; text?: string }) => b.text ?? "").join("").trim();
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as ProcessedPair[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* fall through */ }

  return splitTextFallback(rawText);
}

// ─── Text-based: Blackboard-aware regex fallback ──────────────────────────────

function splitTextFallback(text: string): ProcessedPair[] {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);

  // Try Blackboard format: "Question N" headers + "Selected" marker
  const bbPattern = /^Question\s+(\d+)/i;
  const selectedPattern = /Selected\s*$/i;
  const optionPattern = /^([A-Da-d])[.)]\s+(.+)$/;
  const pointsPattern = /^\d+(\.\d+)?\s+Points?$/i;

  const blocks: ProcessedPair[] = [];
  let cur: {
    num: number; parts: string[]; choices: string[]; selected: string | null; page: number;
  } | null = null;

  for (const line of lines) {
    if (pointsPattern.test(line)) continue; // skip "0.5 Points" lines
    if (/^-- \d+ of \d+ --$/.test(line)) continue; // skip page markers
    if (/^Clear selection$/i.test(line)) continue;

    const bbm = line.match(bbPattern);
    if (bbm) {
      if (cur) blocks.push(finalize(cur));
      cur = { num: parseInt(bbm[1], 10), parts: [], choices: [], selected: null, page: 1 };
      // Question text may follow on same line after "Question N"
      const rest = line.replace(bbm[0], "").trim();
      if (rest) cur.parts.push(rest);
      continue;
    }

    if (!cur) continue;

    // Check if this line ends with "Selected"
    const isSelected = selectedPattern.test(line);
    const cleanLine = line.replace(/\s*Selected\s*$/i, "").trim();

    const optM = cleanLine.match(optionPattern);
    if (optM) {
      const choiceText = `${optM[1].toUpperCase()}. ${optM[2].trim()}`;
      cur.choices.push(choiceText);
      if (isSelected) cur.selected = choiceText;
      continue;
    }

    // True/False options
    if (/^(True|False)$/i.test(cleanLine)) {
      cur.choices.push(cleanLine);
      if (isSelected) cur.selected = cleanLine;
      continue;
    }

    // Otherwise part of the question text
    cur.parts.push(cleanLine + (isSelected ? " (Selected)" : ""));
  }

  if (cur) blocks.push(finalize(cur));

  // Fallback: if nothing matched Blackboard pattern, try numbered pattern
  if (blocks.length === 0) {
    return splitNumberedFallback(lines);
  }

  return blocks;
}

function finalize(cur: { num: number; parts: string[]; choices: string[]; selected: string | null; page: number }): ProcessedPair {
  return {
    questionNumber: cur.num,
    questionText: cur.parts.join(" ").trim(),
    choices: cur.choices,
    selectedAnswer: cur.selected,
    answerText: cur.selected ?? "",
    pageNumber: cur.page,
    confidence: cur.selected ? 0.82 : 0.55,
    needsReview: !cur.selected,
  };
}

function splitNumberedFallback(lines: string[]): ProcessedPair[] {
  const qPattern = /^(\d{1,3})[.)]\s+(.+)$/;
  const optPattern = /^([a-dA-D])[.)]\s+(.+)$/;
  const answerKey = new Map<number, string>();

  // Detect answer key block at end
  for (const line of lines) {
    const m = line.match(/\b(\d{1,3})\s+([A-D])\b/);
    if (m) answerKey.set(parseInt(m[1], 10), m[2]);
  }

  const blocks: ProcessedPair[] = [];
  let cur: { num: number; parts: string[]; opts: Record<string, string> } | null = null;

  for (const line of lines) {
    const qm = line.match(qPattern);
    if (qm) {
      if (cur) blocks.push(buildFromNumbered(cur, answerKey));
      cur = { num: parseInt(qm[1], 10), parts: [qm[2].trim()], opts: {} };
      continue;
    }
    if (!cur) continue;
    const om = line.match(optPattern);
    if (om) { cur.opts[om[1].toUpperCase()] = om[2].trim(); continue; }
    cur.parts.push(line);
  }
  if (cur) blocks.push(buildFromNumbered(cur, answerKey));

  return blocks.length > 0 ? blocks : [{
    questionNumber: 1, questionText: lines.slice(0, 10).join(" "), choices: [],
    selectedAnswer: null, answerText: "", pageNumber: 1, confidence: 0.3, needsReview: true,
  }];
}

function buildFromNumbered(cur: { num: number; parts: string[]; opts: Record<string, string> }, answerKey: Map<number, string>): ProcessedPair {
  const letter = answerKey.get(cur.num);
  const answerText = letter ? (cur.opts[letter] ?? letter) : "";
  return {
    questionNumber: cur.num, questionText: cur.parts.join(" ").trim(),
    choices: Object.entries(cur.opts).map(([k, v]) => `${k}. ${v}`),
    selectedAnswer: letter ?? null, answerText,
    pageNumber: 1, confidence: answerText ? 0.8 : 0.55, needsReview: !answerText,
  };
}

// ─── Main pipeline entry point ────────────────────────────────────────────────

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
    let extraction: ExtractionResult;
    try {
      extraction = await extractPdfText(buf, config.maxPdfPages);
    } catch (e) {
      if (e instanceof PdfPageLimitError) {
        await repo.updateFile(fileId, { status: "failed", processingError: e.message });
        return;
      }
      await repo.updateFile(fileId, { status: "failed", processingError: `PDF text extraction failed: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    await repo.updateFile(fileId, { pageCount: extraction.pageCount, status: "processing" });

    let pairs: ProcessedPair[] = [];
    let processingNote = "";

    if (extraction.kind === "text") {
      // ── Text-based path ───────────────────────────────────────────────────
      pairs = await splitTextWithAI(extraction.text, fileName, locale);
    } else {
      // ── Image/scanned path ────────────────────────────────────────────────
      // First try: extract embedded images (Blackboard style)
      let embeddedImages: EmbeddedImage[] = [];
      try {
        embeddedImages = await extractEmbeddedImages(buf, config.maxPdfPages);
      } catch (e) {
        processingNote = `Embedded image extraction failed: ${e instanceof Error ? e.message : String(e)}`;
      }

      if (embeddedImages.length > 0) {
        // ── Blackboard/LMS PDF: embedded images per question ───────────────
        if (!config.aiApiKey && !config.isDemoMode) {
          throw new ScannedPdfNoVisionError();
        }

        if (config.isDemoMode && !config.aiApiKey) {
          pairs = [{
            questionNumber: 1,
            questionText: "[DEMO] This is a scanned/image-based PDF. Set AI_API_KEY to enable real OCR extraction.",
            choices: ["A. Option 1", "B. Option 2", "C. Option 3", "D. Option 4"],
            selectedAnswer: "A. Option 1",
            answerText: "A. Option 1",
            pageNumber: 1,
            confidence: 0.4,
            needsReview: true,
          }];
        } else {
          const errors: string[] = [];
          for (const img of embeddedImages) {
            try {
              const imgPairs = await extractFromImage(img, fileName, locale);
              pairs.push(...imgPairs);
            } catch (e) {
              if (e instanceof VisionUnavailableError) {
                await repo.updateFile(fileId, { status: "failed", processingError: e.message });
                return;
              }
              errors.push(`Page ${img.pageNumber} img ${img.imageIndex}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
          if (pairs.length === 0) {
            await repo.updateFile(fileId, {
              status: "failed",
              processingError: errors.length > 0 ? `Vision failed on all images: ${errors[0]}` : "No questions extracted from any image.",
            });
            return;
          }
        }
      } else {
        // ── No embedded images — pure scanned pages ───────────────────────
        await repo.updateFile(fileId, {
          status: "failed",
          processingError: processingNote || "PDF has no text and no embedded images. It may be a fully rasterised scanned PDF. Please upload a higher quality PDF.",
        });
        return;
      }
    }

    // ── Step 2: Deduplicate by questionNumber ─────────────────────────────
    const seen = new Set<number>();
    const unique = pairs.filter(p => {
      if (!p.questionText.trim()) return false;
      if (seen.has(p.questionNumber)) return false;
      seen.add(p.questionNumber);
      return true;
    });

    // Sort by question number
    unique.sort((a, b) => a.questionNumber - b.questionNumber);

    // ── Step 3: Persist ───────────────────────────────────────────────────
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
        published: false, // always require admin review
      });

      if (config.embeddingEnabled) {
        const vector = await embed(pair.questionText);
        if (vector) await repo.storeEmbedding(q.id, vector);
      }
    }

    const note = processingNote ? ` (${processingNote})` : "";
    await repo.updateFile(fileId, {
      status: "needs_review",
      processingError: note || undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown processing error";
    console.error("[pdf-pipeline] fatal:", msg);
    await repo.updateFile(fileId, { status: "failed", processingError: msg });
  }
}
