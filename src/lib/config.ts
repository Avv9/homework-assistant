export const config = {
  isDemoMode: process.env.DEMO_MODE === "true",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  // Answer generation (Anthropic)
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiAnswerModel: process.env.AI_ANSWER_MODEL ?? "claude-sonnet-4-6",
  aiVisionModel: process.env.AI_VISION_MODEL ?? "claude-sonnet-4-6",
  // Embeddings (separate provider — e.g. OpenAI)
  embeddingApiKey: process.env.EMBEDDING_API_KEY ?? "",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  embeddingEnabled: Boolean(process.env.EMBEDDING_API_KEY),
  // Limits
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB ?? 15),
  maxPdfPages: Number(process.env.MAX_PDF_PAGES ?? 10),
  maxQuestionsPerRequest: Number(process.env.MAX_QUESTIONS_PER_REQUEST ?? 10),
  rateLimitCount: Number(process.env.RATE_LIMIT_COUNT ?? 20),
  rateLimitWindowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 600),
  searchConfidenceThreshold: Number(process.env.SEARCH_CONFIDENCE_THRESHOLD ?? 0.78),
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 30000),
  fileProcessingTimeoutMs: Number(process.env.FILE_PROCESSING_TIMEOUT_MS ?? 60000),
  // Upstash Redis (optional — swap in-memory rate limiter)
  upstashRedisUrl: process.env.UPSTASH_REDIS_REST_URL ?? "",
  upstashRedisToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
};
