// In-memory token-bucket rate limiter.
//
// IMPORTANT — single-VM / localhost only.
// On serverless platforms (Vercel, Cloudflare Workers, AWS Lambda) every
// invocation can land on a fresh process, so this bucket is effectively a
// no-op. Replace with Upstash / Vercel KV / Cloudflare KV before deploying
// to a serverless host. `shouldEnforceLocalRateLimit()` returns false in
// detectable serverless environments so this never silently passes traffic
// it claims to gate.

type Bucket = {
  tokens: number;
  updatedAt: number;
};

export type RateLimitOptions = {
  burst: number;
  refillPerSecond: number;
};

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

const buckets = new Map<string, Bucket>();

export function consume(
  key: string,
  options: RateLimitOptions,
  now: number = Date.now()
): RateLimitResult {
  const existing = buckets.get(key);
  const bucket: Bucket = existing
    ? refill(existing, options, now)
    : { tokens: options.burst, updatedAt: now };

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }

  buckets.set(key, bucket);
  const deficit = 1 - bucket.tokens;
  const retryAfterSeconds = Math.max(1, Math.ceil(deficit / options.refillPerSecond));
  return { allowed: false, retryAfterSeconds };
}

function refill(bucket: Bucket, options: RateLimitOptions, now: number): Bucket {
  const elapsedMs = Math.max(0, now - bucket.updatedAt);
  const refilled = bucket.tokens + (elapsedMs / 1000) * options.refillPerSecond;
  return {
    tokens: Math.min(options.burst, refilled),
    updatedAt: now
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}

// Returns the most trustworthy client IP available. We trust only
// platform-set headers (set by the proxy after stripping any inbound copy
// from the client), never raw x-forwarded-for which is trivially spoofable.
export function getClientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

// Detects serverless platforms where in-memory state is unreliable.
// If true, skip the limiter and rely on platform-native or KV-backed
// limits instead of pretending we have a bucket.
export function shouldEnforceLocalRateLimit(): boolean {
  if (process.env.VERCEL === "1") return false;
  if (process.env.CF_PAGES === "1") return false;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
}

export function rateLimitKey(input: {
  userId?: string | null;
  ip?: string | null;
  scope: string;
}): string {
  if (input.userId) return `${input.scope}:user:${input.userId}`;
  if (input.ip) return `${input.scope}:ip:${input.ip}`;
  return `${input.scope}:anon`;
}
