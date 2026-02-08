import { describe, it, expect } from "vitest";

// Test the dedup key generation logic
function getMessageKey(chatId: number | undefined, messageId: number | undefined): string | null {
  if (!chatId || !messageId) return null;
  return `${chatId}:${messageId}`;
}

describe("Message Deduplication", () => {
  it("generates correct key from chatId and messageId", () => {
    expect(getMessageKey(12345, 678)).toBe("12345:678");
  });

  it("returns null when chatId is undefined", () => {
    expect(getMessageKey(undefined, 678)).toBeNull();
  });

  it("returns null when messageId is undefined", () => {
    expect(getMessageKey(12345, undefined)).toBeNull();
  });

  it("Set correctly detects duplicate keys", () => {
    const processed = new Set<string>();
    const key = "12345:678";

    expect(processed.has(key)).toBe(false);
    processed.add(key);
    expect(processed.has(key)).toBe(true);
  });

  it("different messages get different keys", () => {
    const key1 = getMessageKey(12345, 678);
    const key2 = getMessageKey(12345, 679);
    expect(key1).not.toBe(key2);
  });

  it("cache cleanup removes oldest entries", () => {
    const processed = new Set<string>();
    const MAX = 10;

    // Add entries
    for (let i = 0; i < MAX + 5; i++) {
      processed.add(`chat:${i}`);
    }

    // Simulate cleanup
    if (processed.size > MAX) {
      const entries = Array.from(processed);
      const removeCount = Math.floor(entries.length / 2);
      for (let i = 0; i < removeCount; i++) {
        processed.delete(entries[i]);
      }
    }

    expect(processed.size).toBeLessThanOrEqual(MAX);
    // Newer entries should still exist
    expect(processed.has(`chat:${MAX + 4}`)).toBe(true);
  });
});
