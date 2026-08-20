export const config = {
  isDemoMode: process.env.DEMO_MODE === "true",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  // ── Anthropic (paid) ──────────────────────────────────────────────────────
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiAnswerModel: process.env.AI_ANSWER_MODEL ?? "claude-sonnet-4-6",
  aiVisionModel: process.env.AI_VISION_MODEL ?? "claude-sonnet-4-6",

  // ── Google Gemini (FREE — 1500 requests/day, no credit card needed) ───────
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",

  // ── Which vision provider to use ─────────────────────────────────────────
  // Priority: Anthropic (if AI_API_KEY set) → Gemini (if GEMINI_API_KEY set)
  get visionProvider(): "anthropic" | "gemini" | "none" {
    if (this.aiApiKey) return "anthropic";
    if (this.geminiApiKey) return "gemini";
    return "none";
  },

  // ── Embeddings ───────────────────────────────────────────────────────────
  embeddingApiKey: process.env.EMBEDDING_API_KEY ?? "",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  embeddingEnabled: Boolean(process.env.EMBEDDING_API_KEY),

  // ── Limits ───────────────────────────────────────────────────────────────
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB ?? 15),
  maxPdfPages: Number(process.env.MAX_PDF_PAGES ?? 10),
  maxOcrPages: Number(process.env.MAX_OCR_PAGES ?? 8),
  maxQuestionsPerRequest: Number(process.env.MAX_QUESTIONS_PER_REQUEST ?? 10),
  rateLimitCount: Number(process.env.RATE_LIMIT_COUNT ?? 20),
  rateLimitWindowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 600),
  searchConfidenceThreshold: Number(process.env.SEARCH_CONFIDENCE_THRESHOLD ?? 0.78),
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 30000),
  fileProcessingTimeoutMs: Number(process.env.FILE_PROCESSING_TIMEOUT_MS ?? 60000),

  // ── Upstash Redis ────────────────────────────────────────────────────────
  upstashRedisUrl: process.env.UPSTASH_REDIS_REST_URL ?? "",
  upstashRedisToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
};

export const pdfConfig = {
  pdfTextMinLength: Number(process.env.PDF_TEXT_MIN_LENGTH ?? 50),
  visionModel: process.env.VISION_MODEL ?? process.env.AI_VISION_MODEL ?? "claude-sonnet-4-6",
};
