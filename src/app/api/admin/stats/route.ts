import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRepo } from "@/lib/repo";
import { summarizeFileQueue } from "@/lib/admin/file-processing";

export async function GET() {
  const guard = await requireAdmin("viewer");
  if (!guard.ok) return guard.response;
  const repo = await getAdminRepo();
  const [stats, files, questions] = await Promise.all([
    repo.getStats(),
    repo.getFiles({}),
    repo.getExtractedQuestions({}),
  ]);
  const fileQueue = summarizeFileQueue(files);
  const missingAnswerQuestions = questions.filter(question => !question.answerText.trim()).length;
  const lowConfidenceQuestions = questions.filter(question => question.confidence < 0.7).length;
  const draftQuestions = questions.filter(question => !question.published).length;
  const averageConfidence = questions.length > 0
    ? questions.reduce((sum, question) => sum + question.confidence, 0) / questions.length
    : 0;

  return NextResponse.json({
    ...stats,
    fileQueue,
    extractedQuestions: questions.length,
    draftQuestions,
    missingAnswerQuestions,
    lowConfidenceQuestions,
    averageConfidence,
  });
}
