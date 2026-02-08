import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the idempotency logic in isolation
// by simulating the dedup mechanism

describe("Message idempotency guard", () => {
  let processedMessages: Set<string>;

  beforeEach(() => {
    processedMessages = new Set();
  });

  function getMessageKey(chatId: number | undefined, messageId: number | undefined): string | null {
    if (!chatId || !messageId) return null;
    return `${chatId}:${messageId}`;
  }

  it("generates correct message key", () => {
    expect(getMessageKey(12345, 678)).toBe("12345:678");
  });

  it("returns null for missing chatId", () => {
    expect(getMessageKey(undefined, 678)).toBeNull();
  });

  it("returns null for missing messageId", () => {
    expect(getMessageKey(12345, undefined)).toBeNull();
  });

  it("detects duplicate message", () => {
    const key = getMessageKey(12345, 678)!;

    // First time: not duplicate
    expect(processedMessages.has(key)).toBe(false);
    processedMessages.add(key);

    // Second time: duplicate!
    expect(processedMessages.has(key)).toBe(true);
  });

  it("allows different messages from same chat", () => {
    const key1 = getMessageKey(12345, 100)!;
    const key2 = getMessageKey(12345, 101)!;

    processedMessages.add(key1);

    expect(processedMessages.has(key1)).toBe(true);
    expect(processedMessages.has(key2)).toBe(false);
  });

  it("handles cache cleanup at limit", () => {
    const MAX = 1000;
    // Fill up cache
    for (let i = 0; i < MAX + 50; i++) {
      processedMessages.add(`chat:${i}`);
    }

    expect(processedMessages.size).toBe(MAX + 50);

    // Simulate cleanup
    if (processedMessages.size > MAX) {
      const entries = Array.from(processedMessages);
      const removeCount = Math.floor(entries.length / 2);
      for (let i = 0; i < removeCount; i++) {
        processedMessages.delete(entries[i]);
      }
    }

    // Should be roughly half now
    expect(processedMessages.size).toBeLessThanOrEqual(MAX);
    // Recent entries should still exist
    expect(processedMessages.has(`chat:${MAX + 49}`)).toBe(true);
  });
});
