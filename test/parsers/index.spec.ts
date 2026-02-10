import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tryParseOCR, detectDateOffset } from "../../src/parsers/index";

describe("tryParseOCR", () => {
  it("returns null for unknown format", () => {
    const result = tryParseOCR("Beli bensin Rp50.000 di SPBU");
    expect(result).toBeNull();
  });

  it("parses ShopeeFood text successfully", () => {
    const text = [
      "10 Feb 2026",
      "22:30 ShopeeFood Rp18,400",
      "Restaurant Name",
      "21:43 ShopeeFood Rp12,000",
    ].join("\n");

    const result = tryParseOCR(text);

    expect(result).not.toBeNull();
    expect(result!.format).toBe("shopeefood");
    expect(result!.transactions.length).toBe(2);
    expect(result!.confidence).toBe("high");
  });

  it("returns null for detected format with 0 parseable transactions", () => {
    // Has ShopeeFood keyword but no valid Rp amounts
    const result = tryParseOCR("ShopeeFood app version 3.2.1");
    expect(result).toBeNull();
  });

  it("returns null for SPX (parser not yet implemented)", () => {
    const result = tryParseOCR("SPX Express Rp8,000");
    expect(result).toBeNull();
  });
});

describe("detectDateOffset", () => {
  // We need to mock Date.now() for predictable tests
  beforeEach(() => {
    // Mock: "today" is 10 Feb 2026, 14:00 WIB (07:00 UTC)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-10T07:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 for today's date", () => {
    expect(detectDateOffset("10 Feb 2026 ~")).toBe(0);
  });

  it("returns -1 for yesterday", () => {
    expect(detectDateOffset("09 Feb 2026 ~")).toBe(-1);
  });

  it("returns -2 for 2 days ago", () => {
    expect(detectDateOffset("08 Feb 2026")).toBe(-2);
  });

  it("returns 0 for no date in text", () => {
    expect(detectDateOffset("ShopeeFood Rp18,400")).toBe(0);
  });

  it("returns 0 for future date (invalid)", () => {
    expect(detectDateOffset("15 Feb 2026")).toBe(0);
  });

  it("returns 0 for date > 30 days ago (too old)", () => {
    expect(detectDateOffset("01 Jan 2026")).toBe(0);
  });

  it("handles single-digit day: '9 Feb 2026'", () => {
    expect(detectDateOffset("9 Feb 2026 ~")).toBe(-1);
  });
});
