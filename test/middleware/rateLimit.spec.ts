import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for Bug #8 + #10 (v2) fix: Rate limiter with safeExpiration()
 * using 65s margin to handle clock skew.
 */

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
    if (opts?.expirationTtl !== undefined && opts.expirationTtl < 60) {
      throw new Error(
        `KV PUT failed: 400 Invalid expiration_ttl of ${opts.expirationTtl}. Expiration TTL must be at least 60.`
      );
    }
    if (opts?.expiration !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      if (opts.expiration < now + 60) {
        throw new Error(
          `KV PUT failed: 400 Invalid expiration of ${opts.expiration}. Expiration times must be at least 60 seconds in the future.`
        );
      }
    }
    kvStore[key] = { value, expiration: opts?.expiration };
  }),
} as unknown as KVNamespace;

import { isRateLimited } from "../../src/middleware/rateLimit";

describe("isRateLimited — Bug #8 + #10 v2 fix", () => {
  beforeEach(() => {
    kvStore = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first message with valid expiration", async () => {
    const fakeNow = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(fakeNow);

    const result = await isRateLimited(mockKV, "user1");
    expect(result).toBe(false);

    const opts = mockKV.put.mock.calls[0][2] as any;
    expect(opts).toHaveProperty("expiration");
    const nowEpoch = Math.floor(fakeNow.getTime() / 1000);
    expect(opts.expiration).toBeGreaterThanOrEqual(nowEpoch + 60);
  });

  it("never uses expirationTtl", async () => {
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

  it("increments counter within window", async () => {
    vi.setSystemTime(new Date("2026-02-10T05:00:00Z"));
    await isRateLimited(mockKV, "user1");

    vi.setSystemTime(new Date("2026-02-10T05:00:10Z"));
    await isRateLimited(mockKV, "user1");

    vi.setSystemTime(new Date("2026-02-10T05:00:30Z"));
    const result = await isRateLimited(mockKV, "user1");
    expect(result).toBe(false);

    const lastPut = mockKV.put.mock.calls[mockKV.put.mock.calls.length - 1];
    const value = JSON.parse(lastPut[1] as string);
    expect(value.count).toBe(3);
  });

  it("blocks after MAX_MESSAGES", async () => {
    const start = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(start);
    const epochStart = Math.floor(start.getTime() / 1000);

    kvStore["rl:spammer"] = {
      value: JSON.stringify({ count: 30, start: epochStart }),
      expiration: epochStart + 120,
    };

    vi.setSystemTime(new Date("2026-02-10T05:00:30Z"));
    expect(await isRateLimited(mockKV, "spammer")).toBe(true);
  });

  it("resets after window expires", async () => {
    const start = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(start);
    const epochStart = Math.floor(start.getTime() / 1000);

    kvStore["rl:user2"] = {
      value: JSON.stringify({ count: 30, start: epochStart }),
      expiration: epochStart + 65,
    };

    vi.setSystemTime(new Date("2026-02-10T05:01:06Z")); // +66s
    expect(await isRateLimited(mockKV, "user2")).toBe(false);
  });

  it("expiration is always >= now + 60 even 55s into window (Bug #10)", async () => {
    vi.setSystemTime(new Date("2026-02-10T05:00:00Z"));
    await isRateLimited(mockKV, "user3");

    // 55s later — only 5s left in window
    vi.setSystemTime(new Date("2026-02-10T05:00:55Z"));
    await isRateLimited(mockKV, "user3");

    // KV put should NOT throw
    const lastPut = mockKV.put.mock.calls[mockKV.put.mock.calls.length - 1];
    const opts = lastPut[2] as any;
    const nowEpoch = Math.floor(new Date("2026-02-10T05:00:55Z").getTime() / 1000);
    expect(opts.expiration).toBeGreaterThanOrEqual(nowEpoch + 60);
  });

  it("uses 65s margin (5s buffer for clock skew)", async () => {
    const fakeNow = new Date("2026-02-10T05:00:00Z");
    vi.setSystemTime(fakeNow);

    await isRateLimited(mockKV, "user4");

    const opts = mockKV.put.mock.calls[0][2] as any;
    const nowEpoch = Math.floor(fakeNow.getTime() / 1000);
    // expiration should be max(now+60, now+65) = now+65
    expect(opts.expiration).toBeGreaterThanOrEqual(nowEpoch + 65);
  });

  it("fails open when KV throws", async () => {
    const errorKV = {
      get: vi.fn().mockRejectedValue(new Error("KV unavailable")),
      put: vi.fn(),
    } as unknown as KVNamespace;

    expect(await isRateLimited(errorKV, "user1")).toBe(false);
  });
});
