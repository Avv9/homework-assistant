import { config } from "./config";
import { normalize } from "./search";
import { embed } from "./embeddings";
import type { AdminRepo } from "./repo/interface";
 
export interface ProcessedPair {
  questionNumber: number;
  questionText: string;
  answerText: string;
  pageNumber: number;
  confidence: number;
}
 
type ParsedQuestionBlock = {
  questionNumber: number;
  questionText: string;
  options: Record<string, string>;
  pageNumber: number;
};
 
export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf.slice(0, 4).toString("binary") === "%PDF";
}
 
type PdfParseModule = typeof import("pdf-parse");
type CanvasModule = typeof import("@napi-rs/canvas");

let workerConfigured = false;

async function loadPdfParser(): Promise<PdfParseModule["PDFParse"]> {
  // pdf-parse (via pdfjs-dist) expects browser Canvas APIs (DOMMatrix,
  // ImageData, Path2D) to exist on globalThis. These don't exist in the
  // Node.js runtime on Vercel, so we polyfill them using @napi-rs/canvas
  // BEFORE pdf-parse is loaded. This must be a dynamic import executed at
  // call time — a static top-level import would load pdf-parse (and
  // therefore pdfjs-dist) before this polyfill runs, causing:
  // "ReferenceError: DOMMatrix is not defined"
  const canvas: CanvasModule = await import("@napi-rs/canvas");

  // @napi-rs/canvas ships its own DOMMatrix/ImageData/Path2D type
  // declarations that don't exactly match lib.dom.d.ts (e.g. missing the
  // legacy `scaleNonUniform` method), even though they're compatible at
  // runtime for pdfjs-dist's purposes. We assign via `unknown` to avoid a
  // structural type mismatch at build time.
  const globalScope = globalThis as Omit<
    typeof globalThis,
    "DOMMatrix" | "ImageData" | "Path2D"
  > & {
    DOMMatrix?: unknown;
    ImageData?: unknown;
    Path2D?: unknown;
  };

  globalScope.DOMMatrix ??= canvas.DOMMatrix;
  globalScope.ImageData ??= canvas.ImageData;
  if (canvas.Path2D) {
    globalScope.Path2D ??= canvas.Path2D;
  }

  const pdfParseModule: PdfParseModule = await import("pdf-parse");

  if (!workerConfigured) {
    // By default pdfjs-dist (used internally by pdf-parse) resolves its
    // worker by file PATH at runtime (pdf.worker.mjs). On Vercel's
    // serverless bundle that file often isn't present at the expected
    // location — even with serverExternalPackages/outputFileTracingIncludes
    // — because the path is built dynamically and isn't picked up by the
    // tracer, causing:
    // "Setting up fake worker failed: Cannot find module '.../pdf.worker.mjs'"
    // `getData()` instead returns the worker source embedded as a string,
    // so no file-system lookup is needed at runtime.
    const { getData } = await import("pdf-parse/worker");
    pdfParseModule.PDFParse.setWorker(getData());
    workerConfigured = true;
  }

  return pdfParseModule.PDFParse;
}

async function extractTextFromBuffer(
  buf: Buffer,
): Promise<{ text: string; pageCount: number }> {
  try {
    const PDFParse = await loadPdfParser();
 
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText({ first: config.maxPdfPages });
 
    const text =
      typeof result?.text === "string"
        ? result.text
        : Array.isArray(result?.pages)
          ? result.pages
              .map((p: { text?: string }) => p?.text ?? "")
              .join("\n")
          : "";
 
    const pageCount =
      typeof result?.total === "number"
        ? result.total
        : Array.isArray(result?.pages)
          ? result.pages.length
          : 1;
 
    if (typeof parser.destroy === "function") {
      await parser.destroy();
    }
 
    return { text, pageCount };
  } catch (error) {
    console.error("PDF extract failed:", error);
    return { text: "", pageCount: 0 };
  }
}
 
function extractAnswerKey(text: string): Map<number, string> {
  const map = new Map<number, string>();
 
  // غالبًا مفتاح الإجابات يكون آخر الملف
  const tail = text.slice(Math.max(0, text.length - 3000)).toUpperCase();
 
  const regex = /\b(\d{1,3})\s+([A-D])\b/g;
  let match: RegExpExecArray | null;
 
  while ((match = regex.exec(tail)) !== null) {
    const num = Number(match[1]);
    const letter = match[2];
    if (!Number.isNaN(num)) {
      map.set(num, letter);
    }
  }
 
  return map;
}
 
function parseQuestionBlocks(text: string): ParsedQuestionBlock[] {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/MODULE\s+\d+/gi, "")
    .trim();
 
  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
 
  const blocks: ParsedQuestionBlock[] = [];
  const qPattern = /^(\d{1,3})[.)]\s+(.*)$/;
  const optionPattern = /^([a-d])[.)]\s+(.*)$/i;
 
  let current:
    | {
        questionNumber: number;
        questionParts: string[];
        options: Record<string, string>;
        pageNumber: number;
      }
    | null = null;
 
  for (const line of lines) {
    const qMatch = line.match(qPattern);
 
    if (qMatch) {
      if (current) {
        blocks.push({
          questionNumber: current.questionNumber,
          questionText: current.questionParts.join(" ").trim(),
          options: current.options,
          pageNumber: current.pageNumber,
        });
      }
 
      current = {
        questionNumber: Number(qMatch[1]),
        questionParts: [qMatch[2].trim()],
        options: {},
        pageNumber: 1,
      };
      continue;
    }
 
    if (!current) continue;
 
    const optionMatch = line.match(optionPattern);
    if (optionMatch) {
      current.options[optionMatch[1].toUpperCase()] = optionMatch[2].trim();
      continue;
    }
 
    // تجاهل سطور answer key المجمعة في نهاية الملف
    if (/^(?:\d+\s+[A-D]\s*){2,}$/i.test(line)) {
      continue;
    }
 
    current.questionParts.push(line);
  }
 
  if (current) {
    blocks.push({
      questionNumber: current.questionNumber,
      questionText: current.questionParts.join(" ").trim(),
      options: current.options,
      pageNumber: current.pageNumber,
    });
  }
 
  return blocks;
}
 
function splitFallback(text: string): ProcessedPair[] {
  const answerKey = extractAnswerKey(text);
  const blocks = parseQuestionBlocks(text);
 
  if (blocks.length > 0) {
    return blocks.map((block) => {
      const answerLetter = answerKey.get(block.questionNumber);
      const answerText = answerLetter
        ? block.options[answerLetter] ?? answerLetter
        : "";
 
      return {
        questionNumber: block.questionNumber,
        questionText: block.questionText,
        answerText,
        pageNumber: block.pageNumber,
        confidence: answerText ? 0.82 : 0.62,
      };
    });
  }
 
  return [
    {
      questionNumber: 1,
      questionText: text.slice(0, 500).trim(),
      answerText: "",
      pageNumber: 1,
      confidence: 0.3,
    },
  ];
}
 
async function splitWithAI(
  rawText: string,
  fileName: string,
  locale: "ar" | "en",
): Promise<ProcessedPair[]> {
  if (!config.aiApiKey) return splitFallback(rawText);
 
  const lang = locale === "ar" ? "Arabic" : "English";
  const prompt = `You are extracting homework questions and answers from a university course file named "${fileName}".
 
The file content is:
---
${rawText.slice(0, 12000)}
---
 
Return a JSON array (and only JSON, no markdown fences).
Each element must have:
{
  "questionNumber": number,
  "questionText": "",
  "answerText": "",
  "pageNumber": number,
  "confidence": number
}
 
If the file is a test bank with answer key letters at the end, map each question to its correct answer choice text.
If only questions exist and no answer can be inferred, set answerText to "".
Respond in ${lang} for text fields when applicable.
 
Return only valid JSON array.`;
 
  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.fileProcessingTimeoutMs,
    );
 
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.aiApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.aiAnswerModel,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
 
    clearTimeout(timeout);
 
    const data = await res.json();
    const text = (data.content ?? [])
      .map((b: { type: string; text?: string }) => b.text ?? "")
      .join("")
      .trim();
 
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as ProcessedPair[];
 
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return splitFallback(rawText);
  } catch {
    return splitFallback(rawText);
  }
}
 
async function ocrWithAI(buf: Buffer, fileName: string): Promise<string> {
  if (!config.aiApiKey) return "";
 
  const base64 = buf.toString("base64");
 
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
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64,
                },
              },
              {
                type: "text",
                text: `Extract all text from this scanned PDF document named "${fileName}".
Include question numbers, question text, and answers exactly as written.`,
              },
            ],
          },
        ],
      }),
    });
 
    const data = await res.json();
    return (data.content ?? [])
      .map((b: { type: string; text?: string }) => b.text ?? "")
      .join("")
      .trim();
  } catch {
    return "";
  }
}
 
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
    let rawText = "";
    let pageCount = 1;
 
    const extracted = await extractTextFromBuffer(buf);
    rawText = extracted.text;
    pageCount = extracted.pageCount;
 
    if (rawText.trim().length < 100 && config.aiApiKey) {
      rawText = await ocrWithAI(buf, fileName);
    }
 
    if (!rawText.trim()) {
      await repo.updateFile(fileId, {
        status: "failed",
        processingError: "Could not extract text from PDF",
      });
      return;
    }
 
    await repo.updateFile(fileId, { pageCount, status: "processing" });
 
    const pairs = await splitWithAI(rawText, fileName, locale);
 
    for (const pair of pairs) {
      if (!pair.questionText.trim()) continue;
 
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
    await repo.updateFile(fileId, {
      status: "failed",
      processingError: e instanceof Error ? e.message : "Unknown error",
    });
  }
}