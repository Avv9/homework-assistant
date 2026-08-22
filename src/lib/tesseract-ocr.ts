/**
 * tesseract-ocr.ts
 * Free OCR using Tesseract.js with locally-installed language data.
 * No API key needed. No internet connection required at runtime.
 */

import path from "path";

interface OcrResult {
  text: string;
  confidence: number;
}

let _workerPromise: Promise<import("tesseract.js").Worker> | null = null;

/** Returns a cached Tesseract worker (created once per process). */
async function getWorker() {
  if (_workerPromise) return _workerPromise;

  _workerPromise = (async () => {
    const { createWorker } = await import("tesseract.js");

    // Use the locally-installed @tesseract.js-data/eng package (no CDN download)
    const langPath = path.join(
      process.cwd(),
      "node_modules/@tesseract.js-data/eng/4.0.0_best_int",
    );

    const worker = await createWorker("eng", 1, {
      langPath,
      cacheMethod: "readOnly",
    });

    return worker;
  })();

  return _workerPromise;
}

/** Run OCR on a PNG/JPEG buffer and return the extracted text. */
export async function ocrImage(imageBuffer: Buffer): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageBuffer);
  return {
    text: data.text ?? "",
    confidence: (data.confidence ?? 0) / 100,
  };
}

/** Parse Tesseract OCR output from a Blackboard question image.
 *
 *  Tesseract renders:
 *    - Filled radio (●) as   "©" or "(©"
 *    - Empty radio  (○) as   "O"  or "(O"
 *    - Selected answer row ends with "Selected"
 *
 *  We detect the selected answer by finding the line that contains "Selected".
 */
export interface ParsedQuestion {
  questionNumber: number | null;
  questionText: string;
  choices: string[];
  selectedAnswer: string | null;
  confidence: number;
  needsReview: boolean;
}

export function parseBlackboardOcr(
  ocrText: string,
  fallbackNumber: number,
): ParsedQuestion {
  const lines = ocrText
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // ── Strip Blackboard UI noise ──────────────────────────────────────────────
  const skipPatterns = [
    /^clear selection$/i,
    /^grades\s*\/\s*attempts/i,
    /^assessment due date/i,
    /^time limit/i,
    /^new attempts/i,
    /^submissions will/i,
    /^attempts:/i,
    /^your grade/i,
    /^page \d+ of \d+/i,
    /^-- \d+ of \d+ --$/i,
    /^\d+(\.\d+)?\s+points?$/i,
    /^view submission$/i,
    /^details$/i,
  ];
  const filtered = lines.filter(
    (l) => !skipPatterns.some((p) => p.test(l)),
  );

  // ── Extract question number ────────────────────────────────────────────────
  let questionNumber: number | null = null;
  const qNumPattern = /^question\s+(\d+)/i;
  const questionNumberIdx = filtered.findIndex((l) => qNumPattern.test(l));
  if (questionNumberIdx >= 0) {
    const m = filtered[questionNumberIdx].match(qNumPattern);
    if (m) questionNumber = parseInt(m[1], 10);
  }

  // ── Separate radio-button lines from question body ─────────────────────────
  // Radio button lines start with © O ○ ● or (O (© etc.
  const radioPrefix = /^[\(©OoO○●\u00A9\u25CB\u25CF]+\s*/;
  const selectedSuffix = /\s*Selected\s*$/i;

  const choiceLines: string[] = [];
  const questionLines: string[] = [];
  let selectedAnswer: string | null = null;

  let pastQuestionHeader = questionNumberIdx >= 0 ? false : true;

  for (let i = 0; i < filtered.length; i++) {
    const line = filtered[i];

    // Skip the "Question N" header line itself
    if (qNumPattern.test(line)) {
      pastQuestionHeader = true;
      continue;
    }
    if (!pastQuestionHeader) {
      questionLines.push(line);
      continue;
    }

    const isSelected = selectedSuffix.test(line);
    const cleanLine = line.replace(selectedSuffix, "").trim();
    const isRadio = radioPrefix.test(cleanLine);

    if (isRadio) {
      const choiceText = cleanLine.replace(radioPrefix, "").trim();
      if (choiceText.length < 2) continue; // skip stray characters
      choiceLines.push(choiceText);
      if (isSelected) selectedAnswer = choiceText;
    } else {
      // True/False lines (no radio prefix but short option)
      if (/^(True|False)$/i.test(cleanLine)) {
        choiceLines.push(cleanLine);
        if (isSelected) selectedAnswer = cleanLine;
      } else {
        questionLines.push(cleanLine);
      }
    }
  }

  const questionText = questionLines
    .filter((l) => !qNumPattern.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const needsReview = !selectedAnswer || questionText.length < 5;

  return {
    questionNumber: questionNumber ?? fallbackNumber,
    questionText,
    choices: choiceLines,
    selectedAnswer,
    confidence: selectedAnswer && questionText.length > 10 ? 0.78 : 0.5,
    needsReview,
  };
}

/** Terminate the shared worker (call on server shutdown if needed). */
export async function terminateOcr() {
  if (_workerPromise) {
    const w = await _workerPromise;
    await w.terminate();
    _workerPromise = null;
  }
}
