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
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
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
  source: "embedded" | "rendered-page";
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
        images.push({ pageNumber: page.pageNumber, imageIndex: i, dataUrl: img.dataUrl, sizeBytes, source: "embedded" });
      }
    }
    return images;
  } finally {
    await parser.destroy?.();
  }
}

async function renderPdfPagesAsImages(buf: Buffer, maxPages: number): Promise<EmbeddedImage[]> {
  const PDFParse = await getPdfParser();
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getScreenshot({
      first: maxPages,
      desiredWidth: 1600,
      imageDataUrl: true,
      imageBuffer: true,
    });

    return (result.pages ?? [])
      .map((page, idx) => {
        const dataUrl = page.dataUrl || `data:image/png;base64,${Buffer.from(page.data ?? []).toString("base64")}`;
        const sizeBytes = page.data?.length ?? Math.round(dataUrl.length * 0.75);
        return {
          pageNumber: page.pageNumber ?? idx + 1,
          imageIndex: idx,
          dataUrl,
          sizeBytes,
          source: "rendered-page" as const,
        };
      })
      .filter((image) => image.sizeBytes > 10000);
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

  if (image.source === "rendered-page") {
    return splitTextFallback(text)
      .filter(pair => pair.questionText.trim().length >= 5)
      .map((pair, idx) => ({
        ...pair,
        questionNumber: pair.questionNumber || globalImageIndex + idx + 1,
        pageNumber: image.pageNumber,
        confidence: Math.min(pair.confidence, confidence > 0 ? confidence : 0.6),
        needsReview: pair.needsReview || confidence < 0.7,
      }));
  }

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
      // Extract answer: "Answer: B (False)", "Answer: A", or "Answer: True"
      const answerMatch = block.match(/^Answer:\s*([A-D])(?:\s*\(([^)]+)\))?\s*$/im);
      const textAnswerMatch = block.match(/^Answer:\s*(True|False)\s*$/im);
      const answerLetter = answerMatch?.[1]?.toUpperCase() ?? null;
      const answerFull = answerMatch?.[2] ?? textAnswerMatch?.[1] ?? answerLetter ?? null;
      // Remove answer line from block to get question + choices
      const withoutAnswer = block.replace(/^Answer:\s*(?:[A-D].*|True|False)\s*$/gim, "").trim();
      const blockLines = withoutAnswer.split(/\n+/).map(line => line.trim()).filter(Boolean);
      const firstChoiceLineIdx = blockLines.findIndex(line => /^[A-D]\)\s*/.test(line));
      const choices = firstChoiceLineIdx >= 0
        ? blockLines.slice(firstChoiceLineIdx).filter(line => /^[A-D]\)\s*/.test(line))
        : (withoutAnswer.match(/(?:^|\s)([A-D]\)\s+.*?)(?=\s+[A-D]\)\s+|$)/g) ?? []).map(c => c.trim());
      const questionText = firstChoiceLineIdx >= 0
        ? blockLines.slice(0, firstChoiceLineIdx).join("\n").trim()
        : withoutAnswer.replace(/(?:^|\s)[A-D]\)\s+.*?(?=\s+[A-D]\)\s+|$)/g, "").trim();
      const selectedChoice = answerLetter
        ? choices.find(c => c.startsWith(answerLetter)) ?? answerFull ?? ""
        : answerFull
          ? choices.find(c => c.replace(/^[A-D]\)\s*/, "").trim().toLowerCase() === answerFull.toLowerCase()) ?? answerFull
          : "";
      pairs.push({
        questionNumber: qNum, questionText, choices,
        selectedAnswer: selectedChoice || null, answerText: selectedChoice || answerFull || "",
        pageNumber: 1, confidence: answerFull ? 0.88 : 0.6, needsReview: !answerFull,
      });
    }
    if (pairs.length > 0) return pairs;
  }

  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const choiceBlocks = splitChoiceBlocksFallback(lines);
  if (choiceBlocks.length > 1) return choiceBlocks;

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
    return choiceBlocks.length > 0 ? choiceBlocks : [{ questionNumber: 1, questionText: lines.slice(0, 10).join(" "), choices: [], selectedAnswer: null, answerText: "", pageNumber: 1, confidence: 0.3, needsReview: true }];
  }
  return blocks;
}

function splitChoiceBlocksFallback(lines: string[]): ProcessedPair[] {
  const optionPattern = /^([A-Da-d])[.)]\s+(.+)$/;
  const answerPattern = /^Answer\s*[:\-]\s*(.+)$/i;
  const skipPatterns = [
    /^-- \d+ of \d+ --$/i,
    /^page \d+ of \d+$/i,
    /^\d+$/,
  ];

  const blocks: Array<{ parts: string[]; choices: string[]; answer: string | null }> = [];
  let cur: { parts: string[]; choices: string[]; answer: string | null } = { parts: [], choices: [], answer: null };

  const flush = () => {
    const parts = trimQuestionNoise(cur.parts);
    if (parts.length > 0 && cur.choices.length >= 2) {
      blocks.push({ parts, choices: cur.choices, answer: cur.answer });
    }
    cur = { parts: [], choices: [], answer: null };
  };

  for (const rawLine of lines) {
    if (skipPatterns.some(pattern => pattern.test(rawLine))) continue;
    const numbered = rawLine.match(/^(?:Q\s*)?(\d{1,3})[.)]\s*(.+)$/i);
    const line = numbered && !optionPattern.test(rawLine) ? numbered[2].trim() : rawLine;
    const option = line.match(optionPattern);
    const answer = line.match(answerPattern);

    if (answer && cur.choices.length > 0) {
      cur.answer = answer[1].trim();
      continue;
    }

    if (option) {
      cur.choices.push(`${option[1].toUpperCase()}) ${option[2].trim()}`);
      continue;
    }

    if (cur.choices.length >= 2) flush();
    cur.parts.push(line);
  }
  flush();

  return blocks.map((block, idx) => {
    const answerText = resolveChoiceAnswer(block.answer, block.choices);
    return {
      questionNumber: idx + 1,
      questionText: block.parts.join(" ").replace(/\s+/g, " ").trim(),
      choices: block.choices,
      selectedAnswer: answerText || null,
      answerText,
      pageNumber: 1,
      confidence: answerText ? 0.78 : 0.58,
      needsReview: !answerText,
    };
  });
}

function trimQuestionNoise(parts: string[]): string[] {
  const questionStart = parts.findIndex((line) => (
    /[?؟]$/.test(line) ||
    /^(what|which|why|how|given|in\s+the|the\s+|a\s+|an\s+|developer|according|cording)\b/i.test(line)
  ));
  return (questionStart >= 0 ? parts.slice(questionStart) : parts)
    .filter((line) => !/^(IT\d+|Data Structure|Module \d+|Algorithm Design Techniques)/i.test(line));
}

function resolveChoiceAnswer(answer: string | null, choices: string[]): string {
  if (!answer) return "";
  const letter = answer.match(/^[A-D]/i)?.[0]?.toUpperCase();
  if (letter) return choices.find(choice => choice.startsWith(`${letter})`)) ?? answer;
  return choices.find(choice => choice.replace(/^[A-D]\)\s*/, "").trim().toLowerCase() === answer.toLowerCase()) ?? answer;
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
    let usedRenderedPages = false;

    if (extraction.kind === "text") {
      // Text-based PDF
      pairs = await splitTextWithAI(extraction.text, fileName, locale);
    } else {
      // Scanned / image-based PDF
      let embeddedImages: EmbeddedImage[] = [];
      const imageExtractionErrors: string[] = [];
      try {
        embeddedImages = await extractEmbeddedImages(buf, config.maxPdfPages);
      } catch (e) {
        imageExtractionErrors.push(`embedded image extraction failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (embeddedImages.length === 0) {
        try {
          embeddedImages = await renderPdfPagesAsImages(buf, config.maxPdfPages);
          usedRenderedPages = embeddedImages.length > 0;
        } catch (e) {
          imageExtractionErrors.push(`page rendering failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (embeddedImages.length === 0) {
        await repo.updateFile(fileId, {
          status: "failed",
          processingError: imageExtractionErrors.length > 0
            ? `PDF has no text and image extraction failed: ${imageExtractionErrors.join("; ")}`
            : "PDF has no text, no extractable images, and no renderable pages. Please upload a clearer PDF.",
        });
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

    const providerNote = extraction.kind === "scanned" && provider === "tesseract"
      ? ` (OCR via Tesseract${usedRenderedPages ? " rendered pages" : ""} - review carefully)`
      : undefined;
    await repo.updateFile(fileId, {
      status: "needs_review",
      processingError: providerNote,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[pdf-pipeline] fatal:", msg);
    await repo.updateFile(fileId, { status: "failed", processingError: msg });
  }
}
