import { demoQuestions } from "./demo-data";
import { config } from "./config";
import type { ExtractedQuestion } from "./types";

/** Normalize text: lowercase, strip diacritics/punctuation, collapse whitespace. Handles Arabic + English. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0617-\u061A\u064B-\u0652]/g, "") // arabic diacritics
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

/** Levenshtein-based similarity ratio between 0 and 1. */
function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const al = a.length;
  const bl = b.length;
  if (al === 0 || bl === 0) return 0;
  const dp: number[] = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  const distance = dp[bl];
  return 1 - distance / Math.max(al, bl);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export interface SearchMatch {
  question: ExtractedQuestion;
  score: number;
}

/**
 * Hybrid search restricted to a specific course + assignment scope.
 * Combines exact match, keyword/jaccard overlap, and fuzzy (levenshtein) similarity.
 * In production this score is additionally blended with cosine similarity against
 * pgvector embeddings (see supabase/migrations + match_questions() SQL function).
 */
export function hybridSearch(
  questionText: string,
  courseId: string,
  assignmentId: string,
  pool: ExtractedQuestion[] = demoQuestions
): SearchMatch[] {
  const normalizedQuery = normalize(questionText);
  const queryTokens = tokenize(questionText);

  const scoped = pool.filter(
    (q) => q.courseId === courseId && q.assignmentId === assignmentId && q.published
  );

  const scored: SearchMatch[] = scoped.map((q) => {
    const exact = normalizedQuery === q.normalizedText ? 1 : 0;
    const keyword = jaccardSimilarity(queryTokens, tokenize(q.normalizedText));
    const fuzzy = levenshteinRatio(normalizedQuery, q.normalizedText);
    // Weighted blend; exact match dominates, then fuzzy + keyword overlap.
    const score = exact === 1 ? 1 : 0.5 * fuzzy + 0.35 * keyword + 0.15 * Math.min(1, fuzzy + keyword);
    return { question: q, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

export function bestMatch(
  questionText: string,
  courseId: string,
  assignmentId: string,
  pool: ExtractedQuestion[] = demoQuestions
): SearchMatch | null {
  const results = hybridSearch(questionText, courseId, assignmentId, pool);
  if (results.length === 0) return null;
  const top = results[0];
  return top.score >= config.searchConfidenceThreshold ? top : null;
}
