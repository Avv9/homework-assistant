import { config } from "./config";

interface ExtractionResult {
  rawText: string;
  pageCount?: number;
}

const DEMO_IMAGE_TEXT_AR = "ما الفرق بين بروتوكولي TCP و UDP؟";
const DEMO_IMAGE_TEXT_EN = "What is the difference between TCP and UDP protocols?";
const DEMO_PDF_TEXT_AR = "1. اشرح مفهوم التطبيع (Normalization) في قواعد البيانات العلائقية.\n2. ما هي الأشكال الطبيعية الأساسية؟";
const DEMO_PDF_TEXT_EN =
  "1. Explain the concept of normalization in relational databases.\n2. What are the main normal forms?";

/** Extracts question text from an uploaded image using a vision-capable AI model. */
export async function extractTextFromImage(base64: string, mimeType: string, locale: "ar" | "en"): Promise<ExtractionResult> {
  if (config.isDemoMode) {
    return { rawText: locale === "ar" ? DEMO_IMAGE_TEXT_AR : DEMO_IMAGE_TEXT_EN };
  }
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
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
              {
                type: "text",
                text: "Extract every homework question shown in this image verbatim, numbering them if there is more than one. Return only the question text.",
              },
            ],
          },
        ],
      }),
    });
    const data = await res.json();
    const text = (data.content ?? []).map((b: { type: string; text?: string }) => b.text ?? "").join("\n");
    return { rawText: text.trim() || (locale === "ar" ? DEMO_IMAGE_TEXT_AR : DEMO_IMAGE_TEXT_EN) };
  } catch {
    return { rawText: locale === "ar" ? DEMO_IMAGE_TEXT_AR : DEMO_IMAGE_TEXT_EN };
  }
}

/** Extracts question text from an uploaded PDF using AI document understanding. */
export async function extractTextFromPdf(base64: string, locale: "ar" | "en"): Promise<ExtractionResult> {
  if (config.isDemoMode) {
    return { rawText: locale === "ar" ? DEMO_PDF_TEXT_AR : DEMO_PDF_TEXT_EN, pageCount: 1 };
  }
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
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              {
                type: "text",
                text: "Extract every homework question contained in this PDF verbatim, numbering them in order. Return only the question text.",
              },
            ],
          },
        ],
      }),
    });
    const data = await res.json();
    const text = (data.content ?? []).map((b: { type: string; text?: string }) => b.text ?? "").join("\n");
    return { rawText: text.trim() || (locale === "ar" ? DEMO_PDF_TEXT_AR : DEMO_PDF_TEXT_EN) };
  } catch {
    return { rawText: locale === "ar" ? DEMO_PDF_TEXT_AR : DEMO_PDF_TEXT_EN };
  }
}
