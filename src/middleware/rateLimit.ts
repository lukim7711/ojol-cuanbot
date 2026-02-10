/**
 * Per-user Rate Limiter (Cloudflare KV)
 *
 * Limits messages per user within a time window.
 * Uses KV with absolute expiration — state persists across Worker cold starts.
 *
 * Config: 30 messages per 60 seconds per user.
 *
 * KV key format: rl:{userId}
 * KV value: JSON { count: number, start: number (epoch seconds) }
 * KV expiration: absolute epoch = start + WINDOW_SECONDS (min now+60)
 *
 * Bug #10 fix: Cloudflare KV requires `expiration` to be at least
 * 60 seconds in the future. When the window has < 60s remaining,
 * `data.start + WINDOW_SECONDS` could be < now + 60 → KV rejects.
 * Fix: Use Math.max to ensure expiration is always valid.
 */

const MAX_MESSAGES = 30;
const WINDOW_SECONDS = 60;

/** Cloudflare KV minimum: expiration must be at least this many seconds in the future */
const KV_MIN_FUTURE_SECONDS = 60;

interface RateLimitEntry {
  count: number;
  start: number; // epoch seconds
}

/**
 * Calculate a valid KV expiration timestamp.
 * Ensures it's always at least KV_MIN_FUTURE_SECONDS from now.
 */
function safeExpiration(windowEnd: number): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.max(windowEnd, now + KV_MIN_FUTURE_SECONDS);
}

/**
 * Check if a user has exceeded the rate limit.
 * Returns true if the request should be BLOCKED.
 *
 * @param kv - Cloudflare KV namespace (RATE_LIMIT binding)
 * @param userId - Telegram user ID
 */
export async function isRateLimited(
  kv: KVNamespace,
  userId: string
): Promise<boolean> {
  const key = `rl:${userId}`;
  const now = Math.floor(Date.now() / 1000);

  try {
    const data = await kv.get<RateLimitEntry>(key, "json");

    // No entry or window expired → start fresh
    if (!data || now - data.start >= WINDOW_SECONDS) {
      const windowStart = now;
      await kv.put(key, JSON.stringify({ count: 1, start: windowStart }), {
        expiration: safeExpiration(windowStart + WINDOW_SECONDS),
      });
      return false;
    }

    // Within window — check count
    if (data.count >= MAX_MESSAGES) {
      console.warn(
        `[RateLimit] User ${userId} exceeded ${MAX_MESSAGES} msgs/${WINDOW_SECONDS}s`
      );
      return true;
    }

    // Increment counter, keep same window expiration
    await kv.put(
      key,
      JSON.stringify({ count: data.count + 1, start: data.start }),
      { expiration: safeExpiration(data.start + WINDOW_SECONDS) }
    );
    return false;
  } catch (error) {
    // If KV fails, ALLOW the request (fail-open)
    // Better to let a spammer through than block all users
    console.error("[RateLimit] KV error, failing open:", error);
    return false;
  }
}
