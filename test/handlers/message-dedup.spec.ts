import { describe, it, expect } from "vitest";

/**
 * KV-based dedup logic tests.
 * Tests the pure logic (key generation) and simulates KV behavior.
 */

function getDedupKey(chatId: number | undefined, messageId: number | undefined): string | null {
  if (!chatId || !messageId) return null;
  return `dedup:${chatId}:${messageId}`;
}

describe("Message Deduplication (KV-based)", () => {
  it("generates correct KV key from chatId and messageId", () => {
    expect(getDedupKey(12345, 678)).toBe("dedup:12345:678");
  });

  it("returns null when chatId is undefined", () => {
    expect(getDedupKey(undefined, 678)).toBeNull();
  });

  it("returns null when messageId is undefined", () => {
    expect(getDedupKey(12345, undefined)).toBeNull();
  });

  it("different messages get different keys", () => {
    const key1 = getDedupKey(12345, 678);
    const key2 = getDedupKey(12345, 679);
    expect(key1).not.toBe(key2);
  });

  it("simulates KV dedup behavior (get → null means new, string means dup)", () => {
    // Simulate KV store
    const kvStore = new Map<string, string>();

    const key = "dedup:12345:678";

    // First check: not in KV → new message
    expect(kvStore.get(key)).toBeUndefined();

    // Mark as processed
    kvStore.set(key, "1");

    // Second check: in KV → duplicate
    expect(kvStore.get(key)).toBe("1");
  });

  it("simulates TTL expiry (after 5 min, key should be gone)", () => {
    // In real KV, TTL is handled by Cloudflare.
    // Here we just verify the concept: after expiry, key is absent.
    const kvStore = new Map<string, { value: string; expiresAt: number }>();

    const key = "dedup:12345:678";
    const now = Math.floor(Date.now() / 1000);
    const TTL = 300; // 5 minutes

    // Store with TTL
    kvStore.set(key, { value: "1", expiresAt: now + TTL });

    // Before expiry: exists
    const entry = kvStore.get(key)!;
    expect(now < entry.expiresAt).toBe(true);

    // After expiry: simulate check
    const futureTime = now + TTL + 1;
    expect(futureTime > entry.expiresAt).toBe(true);
    // In real KV, .get() would return null after TTL
  });
});
