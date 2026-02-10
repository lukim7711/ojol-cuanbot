import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for Bug #8 fix: Rate limiter uses absolute `expiration`
 * instead of relative `expirationTtl` to avoid Cloudflare KV's
 * minimum TTL of 60 seconds.
 */

// Mock KV store
let kvStore: Record<string, { value: string; expiration?: number }> = {};

const mockKV = {
  get: vi.fn(async (key: string) => {
    const entry = kvStore[key];
    if (!entry) return null;
    // Check if expired
    const now = Math.floor(Date.now() / 1000);
    if (entry.expiration && now >= entry.expiration) {
      delete kvStore[key];
      return null;
    }
    return JSON.parse(entry.value);
  }),
  put: vi.fn(async (key: string, value: string, opts?: { expiration?: number; expirationTtl?: number }) => {
    // Simulate Cloudflare KV validation
    if (opts?.expirationTtl !== undefined && opts.expirationTtl < 60) {
      throw new Error(
        `KV PUT failed: 400 Invalid expiration_ttl of ${opts.expirationTtl}. Expiration TTL must be at least 60.`
      );
    }
    kvStore[key] = {
      value,
      expiration: opts?.expiration,
    };
  }),
} as unknown as KVNamespace;

import { isRateLimited } from "../../src/middleware/rateLimit";

describe("isRateLimited — Bug #8 fix", () => {
  beforeEach(() => {
    kvStore = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first message and creates KV entry with absolute expiration", async () => {
    const fakeNow = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(fakeNow);
    const epochStart = Math.floor(fakeNow.getTime() / 1000);

    const result = await isRateLimited(mockKV, "user1");

    expect(result).toBe(false);
    expect(mockKV.put).toHaveBeenCalledWith(
      "rl:user1",
      JSON.stringify({ count: 1, start: epochStart }),
      { expiration: epochStart + 60 }
    );
  });

  it("never uses expirationTtl (avoids <60s KV error)", async () => {
    vi.setSystemTime(new Date("2026-02-10T05:00:00Z"));

    // Send 5 rapid messages
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(Date.now() + i * 2000)); // 2s apart
      await isRateLimited(mockKV, "user1");
    }

    // Verify NO call ever used expirationTtl
    for (const call of mockKV.put.mock.calls) {
      const opts = call[2] as any;
      expect(opts).not.toHaveProperty("expirationTtl");
      expect(opts).toHaveProperty("expiration");
    }
  });

  it("increments counter on subsequent messages within window", async () => {
    vi.setSystemTime(new Date("2026-02-10T05:00:00Z"));

    await isRateLimited(mockKV, "user1"); // count: 1

    vi.setSystemTime(new Date("2026-02-10T05:00:10Z")); // +10s
    await isRateLimited(mockKV, "user1"); // count: 2

    vi.setSystemTime(new Date("2026-02-10T05:00:30Z")); // +30s
    const result = await isRateLimited(mockKV, "user1"); // count: 3

    expect(result).toBe(false);

    // Last put should have count: 3 with same expiration
    const lastPut = mockKV.put.mock.calls[mockKV.put.mock.calls.length - 1];
    const value = JSON.parse(lastPut[1] as string);
    expect(value.count).toBe(3);
  });

  it("blocks user after MAX_MESSAGES within window", async () => {
    const start = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(start);
    const epochStart = Math.floor(start.getTime() / 1000);

    // Seed KV with count at limit
    kvStore["rl:spammer"] = {
      value: JSON.stringify({ count: 30, start: epochStart }),
      expiration: epochStart + 60,
    };

    vi.setSystemTime(new Date("2026-02-10T05:00:30Z")); // within window
    const result = await isRateLimited(mockKV, "spammer");

    expect(result).toBe(true); // BLOCKED
  });

  it("resets after window expires", async () => {
    const start = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(start);
    const epochStart = Math.floor(start.getTime() / 1000);

    // Seed KV with count at limit
    kvStore["rl:user2"] = {
      value: JSON.stringify({ count: 30, start: epochStart }),
      expiration: epochStart + 60,
    };

    // Jump past window
    vi.setSystemTime(new Date("2026-02-10T05:01:01Z")); // +61s
    const result = await isRateLimited(mockKV, "user2");

    expect(result).toBe(false); // allowed — new window
  });

  it("fails open when KV throws unexpected error", async () => {
    const errorKV = {
      get: vi.fn().mockRejectedValue(new Error("KV unavailable")),
      put: vi.fn(),
    } as unknown as KVNamespace;

    const result = await isRateLimited(errorKV, "user1");
    expect(result).toBe(false); // fail-open: allow
  });
});
