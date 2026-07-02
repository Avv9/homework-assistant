import { config } from "./config";

export interface AiAnswerContext {
  categoryName: string;
  specializationName?: string;
  levelName?: string;
  courseName: string;
  assignmentName: string;
  locale: "ar" | "en";
}

/**
 * Independent AI service layer. Swap the implementation here to change providers
 * (Anthropic, OpenAI, etc.) without touching API routes or UI code.
 * Falls back to a clearly-labeled demo answer when no AI_API_KEY is configured
 * (Demo Mode), so the app never crashes due to missing credentials.
 */
export async function generateAiAnswer(question: string, ctx: AiAnswerContext): Promise<string> {
  if (config.isDemoMode) {
    return demoAnswer(question, ctx);
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
      .map((block: { type: string; text?: string }) => (block.type === "text" ? block.text ?? "" : ""))
      .join("\n")
      .trim();
    return text || demoAnswer(question, ctx);
  } catch {
    // Never crash the request flow because of an AI/network failure.
    return demoAnswer(question, ctx);
  }
}

function buildSystemPrompt(ctx: AiAnswerContext): string {
  const lang = ctx.locale === "ar" ? "Arabic" : "English";
  return [
    `You are a university teaching assistant helping a student understand a homework question.`,
    `Context: Category: ${ctx.categoryName}; ${ctx.specializationName ? `Specialization: ${ctx.specializationName}; ` : ""}${
      ctx.levelName ? `Level: ${ctx.levelName}; ` : ""
    }Course: ${ctx.courseName}; Assignment: ${ctx.assignmentName}.`,
    `Answer clearly and directly in ${lang}, using Markdown.`,
    `For programming questions, return well-formatted code blocks with a short explanation.`,
    `For mathematical questions, show the steps and then the final answer.`,
    `Never claim this answer is an "approved" or official course answer — it is AI-generated.`,
  ].join("\n");
}

function demoAnswer(question: string, ctx: AiAnswerContext): string {
  const isArabic = ctx.locale === "ar";
  if (isArabic) {
    return [
      `هذه إجابة توضيحية (وضع العرض التجريبي) للسؤال المتعلق بمقرر **${ctx.courseName}** ضمن ${ctx.assignmentName}.`,
      ``,
      `> السؤال: ${question}`,
      ``,
      `للحصول على إجابات حقيقية مولّدة بالذكاء الاصطناعي، يرجى من مالك الموقع إضافة مفتاح AI_API_KEY في إعدادات البيئة.`,
      ``,
      `بشكل عام، يُنصح بتحليل السؤال إلى مفاهيمه الأساسية، الرجوع إلى محاضرات المقرر ذات الصلة، ثم صياغة إجابة خطوة بخطوة مع ذكر الأمثلة عند الحاجة.`,
    ].join("\n");
  }
  return [
    `This is a placeholder explanatory answer (Demo Mode) for a question related to **${ctx.courseName}** — ${ctx.assignmentName}.`,
    ``,
    `> Question: ${question}`,
    ``,
    `To receive real AI-generated answers, the site owner needs to set the AI_API_KEY environment variable.`,
    ``,
    `As general guidance: break the question into its core concepts, review the related course material, and build a step-by-step answer with examples where relevant.`,
  ].join("\n");
}
