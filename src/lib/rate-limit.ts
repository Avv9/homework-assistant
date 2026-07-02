import { config } from "./config";

interface Bucket { count: number; resetAt: number; }

const memBuckets = new Map<string, Bucket>();

async function checkMemory(key: string): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const windowMs = config.rateLimitWindowSeconds * 1000;
  const bucket = memBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    memBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: config.rateLimitCount - 1 };
  }
  if (bucket.count >= config.rateLimitCount) return { allowed: false, remaining: 0 };
  bucket.count += 1;
  return { allowed: true, remaining: config.rateLimitCount - bucket.count };
}

async function checkUpstash(key: string): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const window = config.rateLimitWindowSeconds;
    const limit = config.rateLimitCount;
    // INCR + EXPIRE via Upstash REST API (no extra SDK needed)
    const base = config.upstashRedisUrl.replace(/\/$/, "");
    const token = config.upstashRedisToken;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const incrRes = await fetch(`${base}/incr/${encodeURIComponent(key)}`, { method: "POST", headers });
    const { result: count } = await incrRes.json() as { result: number };
    if (count === 1) {
      await fetch(`${base}/expire/${encodeURIComponent(key)}/${window}`, { method: "POST", headers });
    }
    if (count > limit) return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: limit - count };
  } catch {
    // If Upstash is temporarily unavailable, fail open (allow) and log.
    console.warn("[rate-limit] Upstash unavailable, failing open");
    return { allowed: true, remaining: 1 };
  }
}

export async function checkRateLimit(key: string): Promise<{ allowed: boolean; remaining: number }> {
  if (config.upstashRedisUrl && config.upstashRedisToken) return checkUpstash(key);
  return checkMemory(key);
}
