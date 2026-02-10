import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for Bug #8 + #10 fix: Rate limiter uses absolute `expiration`
 * with safeExpiration() to always stay >= now + 60 seconds.
 */

// Mock KV store
let kvStore: Record<string, { value: string; expiration?: number }> = {};

const mockKV = {
  get: vi.fn(async (key: string) => {
    const entry = kvStore[key];
    if (!entry) return null;
    const now = Math.floor(Date.now() / 1000);
    if (entry.expiration && now >= entry.expiration) {
      delete kvStore[key];
      return null;
    }
    return JSON.parse(entry.value);
  }),
  put: vi.fn(async (key: string, value: string, opts?: { expiration?: number; expirationTtl?: number }) => {
    // Simulate Cloudflare KV validation: expirationTtl must be >= 60
    if (opts?.expirationTtl !== undefined && opts.expirationTtl < 60) {
      throw new Error(
        `KV PUT failed: 400 Invalid expiration_ttl of ${opts.expirationTtl}. Expiration TTL must be at least 60.`
      );
    }
    // Simulate Cloudflare KV validation: expiration must be >= now + 60
    if (opts?.expiration !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      if (opts.expiration < now + 60) {
        throw new Error(
          `KV PUT failed: 400 Invalid expiration of ${opts.expiration}. Expiration times must be at least 60 seconds in the future.`
        );
      }
    }
    kvStore[key] = {
      value,
      expiration: opts?.expiration,
    };
  }),
} as unknown as KVNamespace;

import { isRateLimited } from "../../src/middleware/rateLimit";

describe("isRateLimited — Bug #8 + #10 fix", () => {
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
    // expiration should be at least epochStart + 60 AND at least now + 60
    const putCall = mockKV.put.mock.calls[0];
    const opts = putCall[2] as any;
    expect(opts).toHaveProperty("expiration");
    expect(opts.expiration).toBeGreaterThanOrEqual(epochStart + 60);
  });

  it("never uses expirationTtl (avoids <60s KV error)", async () => {
    vi.setSystemTime(new Date("2026-02-10T05:00:00Z"));

    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(Date.now() + i * 2000));
      await isRateLimited(mockKV, "user1");
    }

    for (const call of mockKV.put.mock.calls) {
      const opts = call[2] as any;
      expect(opts).not.toHaveProperty("expirationTtl");
      expect(opts).toHaveProperty("expiration");
    }
  });

  it("increments counter on subsequent messages within window", async () => {
    vi.setSystemTime(new Date("2026-02-10T05:00:00Z"));

    await isRateLimited(mockKV, "user1"); // count: 1

    vi.setSystemTime(new Date("2026-02-10T05:00:10Z"));
    await isRateLimited(mockKV, "user1"); // count: 2

    vi.setSystemTime(new Date("2026-02-10T05:00:30Z"));
    const result = await isRateLimited(mockKV, "user1"); // count: 3

    expect(result).toBe(false);

    const lastPut = mockKV.put.mock.calls[mockKV.put.mock.calls.length - 1];
    const value = JSON.parse(lastPut[1] as string);
    expect(value.count).toBe(3);
  });

  it("blocks user after MAX_MESSAGES within window", async () => {
    const start = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(start);
    const epochStart = Math.floor(start.getTime() / 1000);

    kvStore["rl:spammer"] = {
      value: JSON.stringify({ count: 30, start: epochStart }),
      expiration: epochStart + 120, // valid KV entry
    };

    vi.setSystemTime(new Date("2026-02-10T05:00:30Z"));
    const result = await isRateLimited(mockKV, "spammer");

    expect(result).toBe(true);
  });

  it("resets after window expires", async () => {
    const start = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(start);
    const epochStart = Math.floor(start.getTime() / 1000);

    kvStore["rl:user2"] = {
      value: JSON.stringify({ count: 30, start: epochStart }),
      expiration: epochStart + 60,
    };

    vi.setSystemTime(new Date("2026-02-10T05:01:01Z"));
    const result = await isRateLimited(mockKV, "user2");

    expect(result).toBe(false);
  });

  it("expiration is always >= now + 60 even late in window (Bug #10)", async () => {
    // Start a window
    const start = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(start);
    await isRateLimited(mockKV, "user3"); // starts window

    // Jump to 55s into window — only 5s remaining
    // data.start + 60 = now + 5, but KV needs >= now + 60
    vi.setSystemTime(new Date("2026-02-10T05:00:55Z"));
    await isRateLimited(mockKV, "user3");

    // Verify KV put did NOT throw (would have thrown in old code)
    const lastPut = mockKV.put.mock.calls[mockKV.put.mock.calls.length - 1];
    const opts = lastPut[2] as any;
    const nowEpoch = Math.floor(new Date("2026-02-10T05:00:55Z").getTime() / 1000);
    expect(opts.expiration).toBeGreaterThanOrEqual(nowEpoch + 60);
  });

  it("fails open when KV throws unexpected error", async () => {
    const errorKV = {
      get: vi.fn().mockRejectedValue(new Error("KV unavailable")),
      put: vi.fn(),
    } as unknown as KVNamespace;

    const result = await isRateLimited(errorKV, "user1");
    expect(result).toBe(false);
  });
});
