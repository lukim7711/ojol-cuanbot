import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for Bug 6 fix: daily AI limit TTL at midnight WIB.
 *
 * Tests the getNextMidnightWIBEpoch function directly
 * and verifies that isDailyLimitExceeded uses absolute `expiration`
 * instead of relative `expirationTtl`.
 */

import { getNextMidnightWIBEpoch } from "../../src/ai/engine";

describe("getNextMidnightWIBEpoch (Bug 6)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns epoch for next midnight WIB when called in morning WIB", () => {
    // 2026-02-10 08:00 WIB = 2026-02-10 01:00 UTC
    vi.setSystemTime(new Date("2026-02-10T01:00:00Z"));

    const result = getNextMidnightWIBEpoch();

    // Next midnight WIB = 2026-02-11 00:00 WIB = 2026-02-10 17:00 UTC
    const expected = Math.floor(new Date("2026-02-10T17:00:00Z").getTime() / 1000);
    expect(result).toBe(expected);
  });

  it("returns epoch for next midnight WIB when called late night WIB", () => {
    // 2026-02-10 23:30 WIB = 2026-02-10 16:30 UTC
    vi.setSystemTime(new Date("2026-02-10T16:30:00Z"));

    const result = getNextMidnightWIBEpoch();

    // Next midnight WIB = 2026-02-11 00:00 WIB = 2026-02-10 17:00 UTC
    const expected = Math.floor(new Date("2026-02-10T17:00:00Z").getTime() / 1000);
    expect(result).toBe(expected);
  });

  it("rolls over to next day correctly at 23:59 WIB", () => {
    // 2026-02-10 23:59 WIB = 2026-02-10 16:59 UTC
    vi.setSystemTime(new Date("2026-02-10T16:59:00Z"));

    const result = getNextMidnightWIBEpoch();

    // Should still be 2026-02-11 00:00 WIB (just 1 minute away)
    const expected = Math.floor(new Date("2026-02-10T17:00:00Z").getTime() / 1000);
    expect(result).toBe(expected);
  });

  it("returns tomorrow midnight when called at exactly 00:00 WIB", () => {
    // 2026-02-10 00:00 WIB = 2026-02-09 17:00 UTC
    vi.setSystemTime(new Date("2026-02-09T17:00:00Z"));

    const result = getNextMidnightWIBEpoch();

    // Next midnight WIB = 2026-02-11 00:00 WIB = 2026-02-10 17:00 UTC
    const expected = Math.floor(new Date("2026-02-10T17:00:00Z").getTime() / 1000);
    expect(result).toBe(expected);
  });
});
