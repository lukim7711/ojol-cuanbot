/**
 * Per-user Rate Limiter (in-memory)
 *
 * Limits messages per user within a sliding window.
 * Uses in-memory Map — resets on worker cold start (acceptable for edge workers).
 *
 * Config: 30 messages per 60 seconds per user.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Rate limit config
const MAX_MESSAGES = 30;
const WINDOW_MS = 60 * 1000; // 60 seconds
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let lastCleanup = Date.now();

/**
 * Check if a user has exceeded the rate limit.
 * Returns true if the request should be BLOCKED.
 */
export function isRateLimited(userId: string): boolean {
  const now = Date.now();

  // Periodic cleanup of stale entries
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    cleanupStaleEntries(now);
    lastCleanup = now;
  }

  let entry = rateLimitMap.get(userId);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitMap.set(userId, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);

  // Check if over limit
  if (entry.timestamps.length >= MAX_MESSAGES) {
    console.warn(`[RateLimit] User ${userId} exceeded ${MAX_MESSAGES} msgs/${WINDOW_MS / 1000}s`);
    return true;
  }

  // Record this request
  entry.timestamps.push(now);
  return false;
}

/**
 * Remove entries that haven't been active in the last window.
 */
function cleanupStaleEntries(now: number): void {
  let removed = 0;
  for (const [userId, entry] of rateLimitMap.entries()) {
    // If all timestamps are outside window, remove entry
    const fresh = entry.timestamps.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) {
      rateLimitMap.delete(userId);
      removed++;
    } else {
      entry.timestamps = fresh;
    }
  }
  if (removed > 0) {
    console.log(`[RateLimit] Cleanup: removed ${removed} stale entries, ${rateLimitMap.size} remaining`);
  }
}
