import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { splitIntoQuestions } from "@/lib/question-splitter";
import { extractTextFromImage, extractTextFromPdf } from "@/lib/extract";
import { generateAiAnswer } from "@/lib/ai";
import { embed } from "@/lib/embeddings";
import { getPublicRepo } from "@/lib/repo";
import type { SearchResultItem } from "@/lib/types";

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

const requestSchema = z.object({
  courseId: z.string().min(1),
  assignmentId: z.string().min(1),
  locale: z.enum(["ar", "en"]).default("ar"),
  text: z.string().max(20000).optional(),
  image: z.object({ base64: z.string(), mimeType: z.string() }).optional(),
  pdf: z.object({ base64: z.string(), fileName: z.string(), sizeBytes: z.number() }).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Rate-limit by IP
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    const rl = await checkRateLimit(`search:${ip}`);
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { courseId, assignmentId, locale, text, image, pdf } = parsed.data;

    // Validate course + assignment exist in repo (Supabase or demo)
    const repo = await getPublicRepo();
    const course = await repo.getCourseById(courseId);
    const assignment = await repo.getAssignmentById(assignmentId);
    if (!course || !assignment || assignment.courseId !== courseId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (!text && !image && !pdf) {
      return NextResponse.json({ error: "no_input" }, { status: 400 });
    }

    // File validations
    if (image) {
      if (!ALLOWED_IMAGE_TYPES.includes(image.mimeType)) {
        return NextResponse.json({ error: "invalid_image_type" }, { status: 400 });
      }
      const approxBytes = (image.base64.length * 3) / 4;
      if (approxBytes > config.maxUploadSizeMb * 1024 * 1024) {
        return NextResponse.json({ error: "file_too_large" }, { status: 400 });
      }
    }
    if (pdf) {
      if (pdf.sizeBytes > config.maxUploadSizeMb * 1024 * 1024) {
        return NextResponse.json({ error: "file_too_large" }, { status: 400 });
      }
      if (!pdf.fileName.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: "invalid_pdf" }, { status: 400 });
      }
    }

    // Extract raw text
    let rawContent = text?.trim() ?? "";
    if (image) {
      const extracted = await extractTextFromImage(image.base64, image.mimeType, locale);
      rawContent = extracted.rawText;
    } else if (pdf) {
      const extracted = await extractTextFromPdf(pdf.base64, locale);
      rawContent = extracted.rawText;
    }

    const questions = splitIntoQuestions(rawContent);
    if (questions.length === 0) {
      return NextResponse.json({ error: "no_questions_found" }, { status: 422 });
    }

    // Build context for AI
    const categoryName = course.categoryId; // will be enriched below
    const cat = await (async () => {
      try { return await repo.getCategoryBySlug(""); } catch { return null; }
    })();
    void cat;
    const specName = course.specializationId
      ? ((await repo.getSpecializationById(course.specializationId))?.nameEn ?? undefined)
      : undefined;
    const levelName = course.levelId
      ? ((await repo.getLevelById(course.levelId))?.nameEn ?? undefined)
      : undefined;
    const courseName = locale === "ar" ? course.nameAr : course.nameEn;
    const assignmentName = locale === "ar" ? assignment.nameAr : assignment.nameEn;

    const results: SearchResultItem[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];

      // Generate embedding for semantic search (null when provider not configured)
      const queryEmbedding = await embed(q);

      // Search approved answers
      const matches = await repo.searchQuestions(courseId, assignmentId, q, queryEmbedding);
      const best = matches[0];

      if (best && best.score >= config.searchConfidenceThreshold) {
        results.push({
          questionIndex: i + 1,
          questionText: q,
          answerMarkdown: best.question.answerText,
          source: "approved",
          confidence: best.score,
        });
      } else {
        // AI fallback
        const aiAnswer = await generateAiAnswer(q, {
          categoryName,
          specializationName: specName,
          levelName,
          courseName,
          assignmentName,
          locale,
        });

        results.push({
          questionIndex: i + 1,
          questionText: q,
          answerMarkdown: aiAnswer,
          source: "ai",
          confidence: 0,
        });

        // Persist for admin review
        await repo.saveAiAnswer({
          questionText: q,
          answerText: aiAnswer,
          categoryId: course.categoryId,
          specializationId: course.specializationId ?? undefined,
          levelId: course.levelId ?? undefined,
          courseId: course.id,
          assignmentId: assignment.id,
        });
      }
    }

    return NextResponse.json({ results, isDemoMode: config.isDemoMode });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
