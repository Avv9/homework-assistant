/**
 * vision.ts — unified vision service
 *
 * Priority order:
 *   1. Anthropic Claude Vision  (AI_API_KEY set)       — paid, best quality
 *   2. Google Gemini Flash      (GEMINI_API_KEY set)   — FREE, 1500 req/day
 *   3. None                                            — clear error message
 *
 * Both providers receive the same prompt and return the same JSON structure.
 */

import { config } from "./config";

export interface VisionResult {
  questionNumber: string | number | null;
  questionText: string;
  choices: string[];
  selectedAnswer: string | null;
  answer: string | null;
  pageNumber: number;
  confidence: number;
  needsReview: boolean;
}

const BASE_PROMPT = (pageNum: number, fileName: string, lang: string) => `
This image is from page ${pageNum} of a university assignment PDF named "${fileName}".
It shows one or more multiple-choice or true/false questions from a Blackboard/LMS submission.

Extract every question and return ONLY a JSON array — no markdown, no explanation.

Each element must follow this exact schema:
{
  "questionNumber": "string or null",
  "questionText": "the complete question text",
  "choices": ["A. text", "B. text", ...],
  "selectedAnswer": "text of the selected option or null",
  "answer": "same as selectedAnswer if clearly visible, else null",
  "pageNumber": ${pageNum},
  "confidence": 0.9,
  "needsReview": false
}

Rules:
- Filled radio button (●) or "Selected" label → that is the selectedAnswer.
- Preserve full question text including tables and lists.
- No answer selected → selectedAnswer: null, needsReview: true, confidence: 0.5.
- No question in this image → return [].
- Respond in ${lang}.
- Return valid JSON array ONLY.
`.trim();

// ── Anthropic Claude ──────────────────────────────────────────────────────────

async function callAnthropic(b64: string, pageNum: number, fileName: string, lang: string): Promise<VisionResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);

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
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
            { type: "text", text: BASE_PROMPT(pageNum, fileName, lang) },
          ],
        }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const raw = (data.content ?? []).map((b: { type: string; text?: string }) => b.text ?? "").join("").trim();
    return parseVisionJSON(raw);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Google Gemini Flash (FREE) ────────────────────────────────────────────────

async function callGemini(b64: string, pageNum: number, fileName: string, lang: string): Promise<VisionResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);

  const model = config.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: "image/png", data: b64 } },
            { text: BASE_PROMPT(pageNum, fileName, lang) },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini ${res.status}: ${err}`);
    }
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return parseVisionJSON(raw.trim());
  } finally {
    clearTimeout(timeout);
  }
}

// ── JSON parser ───────────────────────────────────────────────────────────────

function parseVisionJSON(raw: string): VisionResult[] {
  const clean = raw.replace(/```json|```/g, "").trim();
  if (!clean || clean === "[]") return [];
  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Try to extract first JSON array substring
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* ignore */ }
    }
    throw new Error(`Invalid JSON from vision model. Raw: ${clean.slice(0, 200)}`);
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────

export class VisionUnavailableError extends Error {
  constructor() {
    super(
      "No vision provider configured. " +
      "Please set GEMINI_API_KEY (free) or AI_API_KEY in your Vercel environment variables. " +
      "Get a free Gemini key at: https://aistudio.google.com/app/apikey"
    );
    this.name = "VisionUnavailableError";
  }
}

export async function extractQuestionsFromImage(opts: {
  b64: string;
  pageNum: number;
  fileName: string;
  locale: "ar" | "en";
}): Promise<VisionResult[]> {
  const { b64, pageNum, fileName, locale } = opts;
  const lang = locale === "ar" ? "Arabic" : "English";

  switch (config.visionProvider) {
    case "anthropic":
      return callAnthropic(b64, pageNum, fileName, lang);
    case "gemini":
      return callGemini(b64, pageNum, fileName, lang);
    default:
      throw new VisionUnavailableError();
  }
}
