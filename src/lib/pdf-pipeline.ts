/**
 * pdf-pipeline.ts
 *
 * Handles TEXT-BASED and SCANNED/IMAGE-BASED PDFs.
 *
 * Vision providers (in priority order):
 *   1. Anthropic Claude  (AI_API_KEY)      — paid
 *   2. Google Gemini     (GEMINI_API_KEY)  — FREE, 1500 req/day
 */

import { config, pdfConfig } from "./config";
import { normalize } from "./search";
import { embed } from "./embeddings";
import { extractQuestionsFromImage, VisionUnavailableError } from "./vision";
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

// ─── Custom errors ────────────────────────────────────────────────────────────

export class PdfPageLimitError extends Error {
  constructor(message: string, public readonly actualPages: number, public readonly limit: number) {
    super(message);
    this.name = "PdfPageLimitError";
  }
}
export { VisionUnavailableError };

// ─── Magic-byte check ─────────────────────────────────────────────────────────

export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf.slice(0, 4).toString("binary") === "%PDF";
}

// ─── pdf-parse init (once per process) ────────────────────────────────────────

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

// ─── Text extraction ──────────────────────────────────────────────────────────

export async function extractPdfText(buf: Buffer, maxPages: number): Promise<ExtractionResult> {
  const PDFParse = await getPdfParser();
  const parser = new PDFParse({ data: buf });
  let text = "";
  let pageCount = 0;

  try {
    const result = await parser.getText({ first: maxPages });
    text =
      typeof result?.text === "string" ? result.text
      : Array.isArray(result?.pages)
        ? (result.pages as Array<{ text?: string }>).map(p => p?.text ?? "").join("\n")
        : "";
    pageCount =
      typeof result?.total === "number" ? result.total
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

  const trimmed = text.trim();

  // Strip pdf-parse page separators ("-- N of M --") before checking
  // if real text exists. These markers are always injected by pdf-parse
  // and would fool the length check into thinking the PDF is text-based.
  const meaningful = trimmed
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const kind: PdfKind = meaningful.length < pdfConfig.pdfTextMinLength ? "scanned" : "text";
  return { text: meaningful, pageCount: pageCount || 1, kind };
}

// ─── Embedded image extraction (Blackboard/LMS PDFs) ─────────────────────────

interface EmbeddedImage {
  pageNumber: number;
  imageIndex: number;
  b64: string;
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
        if (sizeBytes < 10000) continue; // skip icons/bullets
        images.push({
          pageNumber: page.pageNumber,
          imageIndex: i,
          b64: img.dataUrl.replace(/^data:[^;]+;base64,/, ""),
          sizeBytes,
        });
      }
    }
    return images;
  } finally {
    await parser.destroy?.();
  }
}

// ─── Text-based: AI Q/A split ─────────────────────────────────────────────────

async function splitTextWithAI(rawText: string, fileName: string, locale: "ar" | "en"): Promise<ProcessedPair[]> {
  const apiKey = config.aiApiKey || config.geminiApiKey;
  if (!apiKey) return splitTextFallback(rawText);

  const lang = locale === "ar" ? "Arabic" : "English";
  const prompt = `Extract homework questions and answers from this university course file named "${fileName}".
Content:
---
${rawText.slice(0, 12000)}
---
Return ONLY a JSON array (no markdown). Each element:
{"questionNumber":number,"questionText":"string","choices":["string"],"selectedAnswer":"string or null","answerText":"string","pageNumber":number,"confidence":number,"needsReview":boolean}
- "Selected" after an option = that is the answer.
- needsReview: true if answerText empty.
- Respond in ${lang}.
- Return valid JSON array only.`;

  try {
    let raw = "";
    if (config.aiApiKey) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": config.aiApiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: config.aiAnswerModel, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
      });
      if (res.ok) {
        const d = await res.json();
        raw = (d.content ?? []).map((b: { type: string; text?: string }) => b.text ?? "").join("").trim();
      }
    } else if (config.geminiApiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096 } }),
      });
      if (res.ok) {
        const d = await res.json();
        raw = d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      }
    }
    const clean = raw.replace(/```json|```/g, "").trim();
    if (clean) {
      const parsed = JSON.parse(clean) as ProcessedPair[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* fall through */ }

  return splitTextFallback(rawText);
}

// ─── Text-based: Blackboard-aware regex fallback ──────────────────────────────

function splitTextFallback(text: string): ProcessedPair[] {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);

  // ── Try Blackboard format: "Question N" + "Selected" ──
  const bbPattern = /^Question\s+(\d+)/i;
  const selectedPattern = /Selected\s*$/i;
  const pointsPattern = /^\d+(\.\d+)?\s+Points?$/i;

  const blocks: ProcessedPair[] = [];
  let cur: { num: number; parts: string[]; choices: string[]; selected: string | null } | null = null;

  for (const line of lines) {
    if (pointsPattern.test(line)) continue;
    if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) continue;
    if (/^Clear selection$/i.test(line)) continue;

    const bbm = line.match(bbPattern);
    if (bbm) {
      if (cur) blocks.push(finalize(cur));
      cur = { num: parseInt(bbm[1], 10), parts: [], choices: [], selected: null };
      const rest = line.replace(bbm[0], "").trim();
      if (rest) cur.parts.push(rest);
      continue;
    }
    if (!cur) continue;

    const isSelected = selectedPattern.test(line);
    const cleanLine = line.replace(/\s*Selected\s*$/i, "").trim();

    const optM = cleanLine.match(/^([A-Da-d])[.)]\s+(.+)$/);
    if (optM) {
      const choiceText = `${optM[1].toUpperCase()}. ${optM[2].trim()}`;
      cur.choices.push(choiceText);
      if (isSelected) cur.selected = choiceText;
      continue;
    }
    if (/^(True|False)$/i.test(cleanLine)) {
      cur.choices.push(cleanLine);
      if (isSelected) cur.selected = cleanLine;
      continue;
    }
    cur.parts.push(cleanLine + (isSelected ? " (Selected)" : ""));
  }
  if (cur) blocks.push(finalize(cur));
  if (blocks.length > 0) return blocks;

  // ── Numbered fallback: "1. question" ──
  return splitNumberedFallback(lines);
}

function finalize(cur: { num: number; parts: string[]; choices: string[]; selected: string | null }): ProcessedPair {
  return {
    questionNumber: cur.num,
    questionText: cur.parts.join(" ").trim(),
    choices: cur.choices,
    selectedAnswer: cur.selected,
    answerText: cur.selected ?? "",
    pageNumber: 1,
    confidence: cur.selected ? 0.82 : 0.55,
    needsReview: !cur.selected,
  };
}

function splitNumberedFallback(lines: string[]): ProcessedPair[] {
  const answerKey = new Map<number, string>();
  for (const line of lines) {
    const m = line.match(/\b(\d{1,3})\s+([A-D])\b/);
    if (m) answerKey.set(parseInt(m[1], 10), m[2]);
  }
  const blocks: ProcessedPair[] = [];
  let cur: { num: number; parts: string[]; opts: Record<string, string> } | null = null;
  for (const line of lines) {
    const qm = line.match(/^(\d{1,3})[.)]\s+(.+)$/);
    if (qm) {
      if (cur) blocks.push(buildNumbered(cur, answerKey));
      cur = { num: parseInt(qm[1], 10), parts: [qm[2].trim()], opts: {} };
      continue;
    }
    if (!cur) continue;
    const om = line.match(/^([a-dA-D])[.)]\s+(.+)$/);
    if (om) { cur.opts[om[1].toUpperCase()] = om[2].trim(); continue; }
    cur.parts.push(line);
  }
  if (cur) blocks.push(buildNumbered(cur, answerKey));
  return blocks.length > 0 ? blocks : [{
    questionNumber: 1, questionText: lines.slice(0, 10).join(" "),
    choices: [], selectedAnswer: null, answerText: "",
    pageNumber: 1, confidence: 0.3, needsReview: true,
  }];
}

function buildNumbered(cur: { num: number; parts: string[]; opts: Record<string, string> }, key: Map<number, string>): ProcessedPair {
  const letter = key.get(cur.num);
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
    // ── Step 1: Extract text ───────────────────────────────────────────────
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

    if (extraction.kind === "text") {
      // ── Text-based path ────────────────────────────────────────────────
      pairs = await splitTextWithAI(extraction.text, fileName, locale);

    } else {
      // ── Scanned/image-based path ───────────────────────────────────────
      if (config.visionProvider === "none" && !config.isDemoMode) {
        await repo.updateFile(fileId, {
          status: "failed",
          processingError:
            "هذا الملف لا يحتوي على نص قابل للاستخراج (ممسوح ضوئياً). " +
            "يلزم مفتاح API لمعالجته. " +
            "أضف GEMINI_API_KEY (مجاني) من https://aistudio.google.com/app/apikey " +
            "في إعدادات Vercel ثم أعد المعالجة.",
        });
        return;
      }

      // Extract embedded images
      let embeddedImages: EmbeddedImage[] = [];
      try {
        embeddedImages = await extractEmbeddedImages(buf, config.maxPdfPages);
      } catch (e) {
        await repo.updateFile(fileId, { status: "failed", processingError: `Image extraction failed: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }

      if (embeddedImages.length === 0) {
        await repo.updateFile(fileId, { status: "failed", processingError: "PDF has no text and no embedded images. Try a higher quality PDF." });
        return;
      }

      if (config.isDemoMode && config.visionProvider === "none") {
        pairs = [{
          questionNumber: 1,
          questionText: `[DEMO] هذا الملف ممسوح ضوئياً — يحتوي على ${embeddedImages.length} صورة. أضف GEMINI_API_KEY (مجاني) لاستخراج الأسئلة فعلياً.`,
          choices: [], selectedAnswer: null, answerText: "",
          pageNumber: 1, confidence: 0.4, needsReview: true,
        }];
      } else {
        // Send each image to vision model
        const errors: string[] = [];
        for (const img of embeddedImages) {
          try {
            const raw = await extractQuestionsFromImage({
              b64: img.b64,
              pageNum: img.pageNumber,
              fileName,
              locale,
            });
            for (const item of raw) {
              if (!item.questionText?.trim()) continue;
              const sel = item.selectedAnswer ?? item.answer ?? null;
              const qNum =
                typeof item.questionNumber === "number" ? item.questionNumber
                : typeof item.questionNumber === "string" ? (parseInt(item.questionNumber, 10) || (img.imageIndex * 10 + 1))
                : img.imageIndex * 10 + 1;
              pairs.push({
                questionNumber: qNum,
                questionText: item.questionText.trim(),
                choices: Array.isArray(item.choices) ? item.choices : [],
                selectedAnswer: sel,
                answerText: sel ?? "",
                pageNumber: item.pageNumber ?? img.pageNumber,
                confidence: typeof item.confidence === "number" ? item.confidence : (sel ? 0.88 : 0.5),
                needsReview: !sel,
              });
            }
          } catch (e) {
            if (e instanceof VisionUnavailableError) {
              await repo.updateFile(fileId, { status: "failed", processingError: e.message });
              return;
            }
            errors.push(`page ${img.pageNumber}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        if (pairs.length === 0) {
          await repo.updateFile(fileId, {
            status: "failed",
            processingError: errors.length > 0 ? `Vision failed: ${errors[0]}` : "No questions extracted from any image.",
          });
          return;
        }
      }
    }

    // ── Step 2: Deduplicate by questionNumber ─────────────────────────────
    const seen = new Set<number>();
    const unique = pairs
      .filter(p => p.questionText.trim().length > 3 && !seen.has(p.questionNumber) && seen.add(p.questionNumber))
      .sort((a, b) => a.questionNumber - b.questionNumber);

    // ── Step 3: Save to database ──────────────────────────────────────────
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

    await repo.updateFile(fileId, { status: "needs_review" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[pdf-pipeline] fatal:", msg);
    await repo.updateFile(fileId, { status: "failed", processingError: msg });
  }
}
