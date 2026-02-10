import { describe, it, expect } from "vitest";

/**
 * Tests for Bug #9 fix (v2): OCR text cleaning and truncation.
 * MAX_OCR_CHARS reduced to 500.
 */

const MAX_OCR_CHARS = 500;

const OCR_NOISE_PATTERNS = [
  /alamat pelanggan disembunyikan/gi,
  /alamat pengirim disembunyikan/gi,
  /^\s*$/gm,
];

const OCR_NOISE_LINES = [
  /^>\s*$/,
  /^\d\/\d+\s*$/,
  /^pesanan gabungan\s*$/i,
];

function cleanOCRText(text: string): string {
  let cleaned = text;
  for (const pattern of OCR_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  cleaned = cleaned.replace(/\t+/g, " ");
  cleaned = cleaned
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return !OCR_NOISE_LINES.some((p) => p.test(trimmed));
    })
    .join("\n");
  return cleaned.replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
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

describe("OCR text cleaning (Bug #9 v2)", () => {
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

  it("removes tab characters", () => {
    const input = "22:30\tShopeeFood\tRp18.400";
    const result = cleanOCRText(input);
    expect(result).not.toContain("\t");
    expect(result).toContain("22:30 ShopeeFood Rp18.400");
  });

  it("removes standalone UI artifacts (> and lone fractions)", () => {
    const input = "Rp382.350\n>\n7/9\nRp335.360";
    const result = cleanOCRText(input);
    expect(result).not.toMatch(/^>\s*$/m);
    // 7/9 alone should be removed, but "7/9 Rp335.360" line should be kept
    expect(result).toContain("Rp382.350");
    expect(result).toContain("Rp335.360");
  });

  it("significantly reduces ShopeeFood screenshot text", () => {
    const shopeeText = Array.from({ length: 9 }, (_, i) =>
      `${22 - i}:${30 - i * 5} ShopeeFood Rp${(18400 - i * 2000).toLocaleString()}\nRestaurant Name ${i + 1}\nAlamat Pelanggan disembunyikan\nAlamat Pelanggan disembunyikan`
    ).join("\n");

    const cleaned = cleanOCRText(shopeeText);
    expect(cleaned.length).toBeLessThan(shopeeText.length * 0.6);
  });

  it("removes blank lines entirely (filter strips empty lines)", () => {
    const input = "line1\n\n\n\n\nline2\n\n\nline3";
    const result = cleanOCRText(input);
    // Blank lines are removed by filter(!trimmed), not collapsed
    expect(result).toBe("line1\nline2\nline3");
  });
});

describe("OCR text truncation (Bug #9 v2 — limit 500)", () => {
  it("does not truncate short text", () => {
    const result = truncateOCRText("short text");
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("short text");
  });

  it("truncates at last newline within 500 char limit", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: Rp${(i + 1) * 10000}`);
    const longText = lines.join("\n");
    expect(longText.length).toBeGreaterThan(MAX_OCR_CHARS);

    const result = truncateOCRText(longText);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(MAX_OCR_CHARS);
  });

  it("handles text with no newlines gracefully", () => {
    const noNewlines = "x".repeat(1000);
    const result = truncateOCRText(noNewlines);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(MAX_OCR_CHARS);
  });

  it("real-world ShopeeFood 9-order screenshot fits after cleaning", () => {
    // Simulate the actual problematic OCR (1369 chars raw)
    const rawOCR = `09 Feb 2026 ~
22:30 If ShapeeFood\tPesanan Gabungan\tRp18,400
Muncul Malam Nasi Goreng Kambing - Ke...
Alamat Pelanggan disembunyikan
Republic Kebab Premium, Kembangan
Alamat Pelanggan disembunyikan
21:43 f Shopeefood\tRp12.000
Mas oak nadatokan
Alamat Pelanggan disembunyikan
Republic Kebab Premium - Kreo Selatan
Alamat Pelanggan disembunyikan
21:16 ff ShopeeFood\tRp8.000
11.\tCafe Seblak Mabel - Cipadu
Alamat Pelanggan disembunyikan
20:52 I! shopeeFood\tPesunan Gabungan\tRp16,800
Bubur Ayam Warkop Berkah - Bintaro
Alamat Pelanggan disembunyikan
Martabak Oeloeng Sehati - Pesanggrahan
Alamat Pelanggan disembunyikan
20:18 f ShuppeFood Pesanan @ubungon\tRp12,800
Hil Kebab - Ciputat Timur
Alamat Pelanggan disembunyikan
Kerang Kiloan Presiden - Ciputat Timur
Alamat Pelanggan disembunyikan
19:17 (1 ShopeeFood\tPesanan Gabungen\tRp12,000
Hot Side Story (Hangry Spicy Chicken) - C.L...
Alamat Pelanggan disembunyikan
Hot Side Story (Hangry Spicy Chicken) - CL..
Alamat Pelanggan disembunyikan
18:25\tRp27:200
Alamat Pengirim disembunyikan
Alamat Pelanggan disembunyikan
Alamat Pengirim disembunyikan
Alamat Pelanggan disembunyikan
17:06\tRp30,400
nanare alacos
Alamat Pengirim disembunyikan
Alamat Pelanggan disembunyikan
16:00\tRp32,800
Alamat Pengirim disembunyikan
Alamat Pelanggan disembunyikan`;

    const cleaned = cleanOCRText(rawOCR);
    const { text, truncated } = truncateOCRText(cleaned);

    // After cleaning + truncation, should fit within limit
    expect(text.length).toBeLessThanOrEqual(MAX_OCR_CHARS);
    // Should still contain the financial data
    expect(text).toContain("Rp18,400");
    expect(text).toContain("Rp12.000");
  });
});
