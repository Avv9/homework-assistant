import { config } from "./config";

export interface AiAnswerContext {
  categoryName: string;
  specializationName?: string;
  levelName?: string;
  courseName: string;
  assignmentName: string;
  locale: "ar" | "en";
}

export async function generateAiAnswer(
  question: string,
  ctx: AiAnswerContext,
): Promise<string> {
  if (!config.aiApiKey) {
    return noAiConfiguredAnswer(question, ctx);
  }

  const systemPrompt = buildSystemPrompt(ctx);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.aiApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.aiAnswerModel,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: question }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`AI provider error: ${res.status}`);
    }

    const data = await res.json();
    const text = (data.content ?? [])
      .map((block: { type: string; text?: string }) =>
        block.type === "text" ? block.text ?? "" : "",
      )
      .join("\n")
      .trim();

    return text || noAiConfiguredAnswer(question, ctx);
  } catch {
    return noAiConfiguredAnswer(question, ctx);
  }
}

function buildSystemPrompt(ctx: AiAnswerContext): string {
  const lang = ctx.locale === "ar" ? "Arabic" : "English";

  return [
    `You are a university teaching assistant helping a student understand a homework question.`,
    `Context: Category: ${ctx.categoryName}; ${ctx.specializationName ? `Specialization: ${ctx.specializationName}; ` : ""}${ctx.levelName ? `Level: ${ctx.levelName}; ` : ""}Course: ${ctx.courseName}; Assignment: ${ctx.assignmentName}.`,
    `Answer clearly and directly in ${lang}, using Markdown.`,
    `For programming questions, return well-formatted code blocks with a short explanation.`,
    `For mathematical questions, show the steps and then the final answer.`,
    `Never claim this answer is an "approved" or official course answer — it is AI-generated.`,
  ].join("\n");
}

function noAiConfiguredAnswer(question: string, ctx: AiAnswerContext): string {
  const isArabic = ctx.locale === "ar";

  if (isArabic) {
    return [
      `لم نجد إجابة معتمدة لهذا السؤال في ملفات المقرر حتى الآن.`,
      ``,
      `> السؤال: ${question}`,
      ``,
      `لم يتم تفعيل الذكاء الاصطناعي بعد في هذا الموقع.`,
      `يمكنك المحاولة بصياغة مختلفة، أو رفع ملف/حل إضافي، أو الرجوع لاحقًا بعد إضافة المزيد من الملفات.`,
    ].join("\n");
  }

  return [
    `We couldn't find an approved answer for this question in the course files yet.`,
    ``,
    `> Question: ${question}`,
    ``,
    `AI is not enabled on this site yet.`,
    `You can try rephrasing the question, upload more course material, or check back later.`,
  ].join("\n");
}