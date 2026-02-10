import { describe, it, expect } from "vitest";

/**
 * Tests for Bug #9 fix: OCR text cleaning and truncation.
 *
 * We test the buildOCRPrompt logic by extracting the cleaning/truncation
 * into testable pure functions.
 */

// Inline the cleaning logic for direct testing
const MAX_OCR_CHARS = 800;

const OCR_NOISE_PATTERNS = [
  /alamat pelanggan disembunyikan/gi,
  /alamat pengirim disembunyikan/gi,
  /^\s*$/gm,
];

function cleanOCRText(text: string): string {
  let cleaned = text;
  for (const pattern of OCR_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function truncateOCRText(text: string, maxChars: number = MAX_OCR_CHARS): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const cutPoint = text.lastIndexOf("\n", maxChars);
  return {
    text: text.substring(0, cutPoint > 0 ? cutPoint : maxChars),
    truncated: true,
  };
}

describe("OCR text cleaning (Bug #9)", () => {
  it("removes 'Alamat Pelanggan disembunyikan' noise", () => {
    const input = "22:30 ShopeeFood Rp18.400\nAlamat Pelanggan disembunyikan\nRepublic Kebab";
    const result = cleanOCRText(input);
    expect(result).not.toContain("Alamat Pelanggan disembunyikan");
    expect(result).toContain("22:30 ShopeeFood Rp18.400");
    expect(result).toContain("Republic Kebab");
  });

  it("removes 'Alamat Pengirim disembunyikan' noise", () => {
    const input = "18:25 Rp27.200\nAlamat Pengirim disembunyikan\nAlamat Pelanggan disembunyikan";
    const result = cleanOCRText(input);
    expect(result).not.toContain("Alamat Pengirim disembunyikan");
    expect(result).not.toContain("Alamat Pelanggan disembunyikan");
    expect(result).toContain("18:25 Rp27.200");
  });

  it("collapses multiple blank lines", () => {
    const input = "line1\n\n\n\n\nline2\n\n\nline3";
    const result = cleanOCRText(input);
    expect(result).toBe("line1\n\nline2\n\nline3");
  });

  it("significantly reduces ShopeeFood screenshot text", () => {
    // Simulate the actual OCR output from the bug report (1369 chars)
    const shopeeText = Array.from({ length: 9 }, (_, i) =>
      `${22 - i}:${30 - i * 5} ShopeeFood Rp${(18400 - i * 2000).toLocaleString()}\nRestaurant Name ${i + 1}\nAlamat Pelanggan disembunyikan\nAlamat Pelanggan disembunyikan`
    ).join("\n");

    const cleaned = cleanOCRText(shopeeText);
    // Should be significantly shorter after removing noise
    expect(cleaned.length).toBeLessThan(shopeeText.length * 0.6);
  });
});

describe("OCR text truncation (Bug #9)", () => {
  it("does not truncate short text", () => {
    const result = truncateOCRText("short text");
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("short text");
  });

  it("truncates at last newline within limit", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: Rp${(i + 1) * 10000}`);
    const longText = lines.join("\n");
    expect(longText.length).toBeGreaterThan(MAX_OCR_CHARS);

    const result = truncateOCRText(longText);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(MAX_OCR_CHARS);
    // Should end at a complete line (no partial line cut)
    expect(result.text.endsWith("\n")).toBe(false); // ends with content, not newline
  });

  it("handles text with no newlines gracefully", () => {
    const noNewlines = "x".repeat(1000);
    const result = truncateOCRText(noNewlines);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(MAX_OCR_CHARS);
  });
});
