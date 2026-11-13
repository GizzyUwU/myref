import type { Bucket, RequestIPServer } from "./rate-limit.types";

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { allowed: boolean; retryAfter: number } {
  if (now - lastSweep > 60_000) {
    for (const [k, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(k);
    }
    lastSweep = now;
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export function clientIp(
  request: Request,
  server: unknown,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  const address = (server as RequestIPServer | null | undefined)?.requestIP?.(request)?.address;
  return address || "unknown";
}
