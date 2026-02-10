import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tryParseOCR, detectDateOffset } from "../../src/parsers/index";

describe("tryParseOCR", () => {
  it("returns null for unknown format", () => {
    const result = tryParseOCR("Beli bensin Rp50.000 di SPBU");
    expect(result).toBeNull();
  });

  it("parses ShopeeFood text as shopee format", () => {
    const text = [
      "10 Feb 2026",
      "22:30 ShopeeFood Rp18,400",
      "Restaurant Name",
      "21:43 ShopeeFood Rp12,000",
    ].join("\n");

    const result = tryParseOCR(text);

    expect(result).not.toBeNull();
    expect(result!.format).toBe("shopee");
    expect(result!.transactions.length).toBe(2);
    expect(result!.confidence).toBe("high");
  });

  it("parses SPX text as shopee format", () => {
    const text = [
      "10 Feb 2026",
      "18:25 SPX Instant (Marketplace) Rp27,200",
      "17:06 SPX Standard Rp30,400",
    ].join("\n");

    const result = tryParseOCR(text);

    expect(result).not.toBeNull();
    expect(result!.format).toBe("shopee");
    expect(result!.transactions.length).toBe(2);
  });

  it("parses mixed ShopeeFood + SPX as single shopee format", () => {
    const text = [
      "10 Feb 2026",
      "22:30 ShopeeFood Rp18,400",
      "18:25 SPX Instant (Marketplace) Rp27,200",
    ].join("\n");

    const result = tryParseOCR(text);

    expect(result).not.toBeNull();
    expect(result!.format).toBe("shopee");
    expect(result!.transactions.length).toBe(2);
    expect(result!.transactions[0].description).toBe("ShopeeFood 22:30");
    expect(result!.transactions[1].description).toBe("SPX 18:25");
  });

  it("returns null for detected format with 0 parseable transactions", () => {
    const result = tryParseOCR("ShopeeFood app version 3.2.1");
    expect(result).toBeNull();
  });
});

describe("detectDateOffset", () => {
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
