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

// ─── Magic-byte PDF signature check ─────────────────────────────────────────
export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf.slice(0, 4).toString("binary") === "%PDF";
}

// ─── Extract text from a PDF buffer ─────────────────────────────────────────
async function extractTextFromBuffer(
  buf: Buffer,
): Promise<{ text: string; pageCount: number }> {
  try {
    
    const pdfParse = require("pdf-parse");
    const result = await pdfParse(buf, { max: config.maxPdfPages });
    return { text: result.text ?? "", pageCount: result.numpages ?? 1 };
  } catch {
    return { text: "", pageCount: 0 };
  }
}

// ─── AI-based Q/A splitting ──────────────────────────────────────────────────
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

If the text contains both questions and answers (a solution file), extract every pair.
If only questions, set answerText to "".
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

// ─── OCR fallback via AI vision (for scanned PDFs) ──────────────────────────
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

// ─── Simple regex-based fallback splitter ────────────────────────────────────
function splitFallback(text: string): ProcessedPair[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const pairs: ProcessedPair[] = [];
  const qPattern = /^(?:Q\.?\s*|السؤال\s*|Question\s*)?(\d+)[.):\s]/i;

  let currentQ = "";
  let currentA = "";
  let qNum = 0;
  let inAnswer = false;

  for (const line of lines) {
    const m = line.match(qPattern);

    if (m) {
      if (currentQ) {
        pairs.push({
          questionNumber: qNum,
          questionText: currentQ.trim(),
          answerText: currentA.trim(),
          pageNumber: 1,
          confidence: 0.6,
        });
      }

      qNum = parseInt(m[1]);
      currentQ = line.replace(qPattern, "").trim();
      currentA = "";
      inAnswer = false;
    } else if (/^(?:answer|الإجابة|الجواب|Solution)[:\s]/i.test(line)) {
      inAnswer = true;
      currentA += " " + line.replace(/^[^:]+:\s*/i, "");
    } else if (inAnswer) {
      currentA += " " + line;
    } else {
      currentQ += " " + line;
    }
  }

  if (currentQ) {
    pairs.push({
      questionNumber: qNum || pairs.length + 1,
      questionText: currentQ.trim(),
      answerText: currentA.trim(),
      pageNumber: 1,
      confidence: 0.5,
    });
  }

  return pairs.length > 0
    ? pairs
    : [
        {
          questionNumber: 1,
          questionText: text.slice(0, 500),
          answerText: "",
          pageNumber: 1,
          confidence: 0.3,
        },
      ];
}

// ─── Main entry point ────────────────────────────────────────────────────────
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

    // If text layer is too short, try OCR via AI vision
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

      // Generate and store embedding if provider configured
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