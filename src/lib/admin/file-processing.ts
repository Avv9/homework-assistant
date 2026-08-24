import { config } from "@/lib/config";
import { isPdfBuffer, processPdfFile } from "@/lib/pdf-pipeline";
import type { AdminRepo } from "@/lib/repo/interface";
import { normalize } from "@/lib/search";
import type { SourceFile } from "@/lib/types";

export function safeStorageFileName(fileName: string) {
  const extension = fileName.toLowerCase().endsWith(".pdf") ? ".pdf" : "";
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  const cleanedBase = baseName
    .normalize("NFKD")
    .replace(/[\\/]+/g, "_")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120);

  return `${cleanedBase || "upload"}${extension}`;
}

export function summarizeFileQueue(files: SourceFile[]) {
  return files.reduce(
    (acc, file) => {
      acc.total += 1;
      acc[file.status] += 1;
      return acc;
    },
    { total: 0, uploaded: 0, processing: 0, needs_review: 0, published: 0, failed: 0 },
  );
}

export function getNextQueuedFile(files: SourceFile[]) {
  return files
    .filter((file) => file.status === "uploaded")
    .sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime())[0] ?? null;
}

export async function getFileById(repo: AdminRepo, id: string) {
  const files = await repo.getFiles({});
  return files.find((file) => file.id === id) ?? null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function createDemoReviewQuestion(file: SourceFile, repo: AdminRepo) {
  const existing = await repo.getExtractedQuestions({ sourceFileId: file.id });
  if (existing.length > 0) return;

  const questionText = `(Demo) Extracted placeholder for ${file.fileName}. Replace this with the real question before publishing.`;
  await repo.createExtractedQuestion({
    sourceFileId: file.id,
    courseId: file.courseId,
    assignmentId: file.assignmentId,
    questionNumber: 1,
    questionText,
    normalizedText: normalize(questionText),
    answerText: "(Demo answer) Please review and edit.",
    pageNumber: 1,
    confidence: 0.5,
    published: false,
  });
}

export async function processStoredPdfFile(opts: {
  file: SourceFile;
  repo: AdminRepo;
  locale: "ar" | "en";
}) {
  const { file, repo, locale } = opts;

  try {
    await repo.updateFile(file.id, { status: "processing", processingError: "" });

    if (config.isDemoMode || !config.supabaseUrl || !config.supabaseServiceRoleKey) {
      await createDemoReviewQuestion(file, repo);
      return await repo.updateFile(file.id, { status: "needs_review", processingError: "" });
    }

    const { createServiceClient } = await import("@/lib/supabase/server");
    const sb = await createServiceClient();
    const { data, error } = await sb.storage.from("course-files").download(file.storagePath);

    if (error || !data) {
      return await repo.updateFile(file.id, {
        status: "failed",
        processingError: `storage_download_error: ${error?.message ?? "file not found"}`,
      });
    }

    const buf = Buffer.from(await data.arrayBuffer());
    if (!isPdfBuffer(buf)) {
      return await repo.updateFile(file.id, { status: "failed", processingError: "not_a_pdf" });
    }

    await processPdfFile({
      fileId: file.id,
      buf,
      fileName: file.fileName,
      courseId: file.courseId,
      assignmentId: file.assignmentId,
      locale,
      repo,
    });

    return (await getFileById(repo, file.id)) ?? file;
  } catch (error) {
    return await repo.updateFile(file.id, { status: "failed", processingError: errorMessage(error) });
  }
}
