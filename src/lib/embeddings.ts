import { config } from "./config";

/**
 * Generate an embedding vector for the given text.
 * Uses OpenAI (or any compatible API) when EMBEDDING_API_KEY is configured.
 * Returns null when no embedding provider is configured — callers must
 * fall back to trigram/keyword search in that case.
 */
export async function embed(text: string): Promise<number[] | null> {
  if (!config.embeddingEnabled) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);

    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.embeddingApiKey}`,
      },
      body: JSON.stringify({ model: config.embeddingModel, input: text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.data?.[0]?.embedding as number[]) ?? null;
  } catch {
    return null;
  }
}
