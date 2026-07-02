import { config } from "./config";

/**
 * Splits raw submitted text into individual questions.
 * Recognizes common numbering styles: "1.", "1)", "Q1", "السؤال 1", arabic-indic digits, newlines.
 */
export function splitIntoQuestions(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];

  const numberedPattern = /(?:^|\n)\s*(?:Q\.?\s*\d+|السؤال\s*\d+|\d+[.)]|[٠-٩]+[.)])\s*/g;
  const hasNumbering = numberedPattern.test(text);
  numberedPattern.lastIndex = 0;

  let parts: string[];
  if (hasNumbering) {
    parts = text
      .split(numberedPattern)
      .map((p) => p.trim())
      .filter(Boolean);
  } else {
    parts = text
      .split(/\n{2,}|\r\n\r\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) {
      parts = text
        .split(/\n/)
        .map((p) => p.trim())
        .filter(Boolean);
    }
  }

  if (parts.length === 0) parts = [text];

  return parts.slice(0, config.maxQuestionsPerRequest);
}
