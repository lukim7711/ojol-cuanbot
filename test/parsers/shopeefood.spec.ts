import { describe, it, expect } from "vitest";
import { parseShopeeFood, parseOjolAmount } from "../../src/parsers/shopeefood";

describe("parseOjolAmount", () => {
  it("parses comma thousand separator: '18,400' → 18400", () => {
    expect(parseOjolAmount("18,400")).toBe(18400);
  });

  it("parses dot thousand separator: '12.000' → 12000", () => {
    expect(parseOjolAmount("12.000")).toBe(12000);
  });

  it("parses large amount: '382.350' → 382350", () => {
    expect(parseOjolAmount("382.350")).toBe(382350);
  });

  it("parses colon artifact: '27:200' → 27200", () => {
    expect(parseOjolAmount("27:200")).toBe(27200);
  });

  it("parses small amount: '8.000' → 8000", () => {
    expect(parseOjolAmount("8.000")).toBe(8000);
  });

  it("parses apostrophe artifact: '12'000' → 12000", () => {
    expect(parseOjolAmount("12'000")).toBe(12000);
  });

  it("returns null for empty string", () => {
    expect(parseOjolAmount("")).toBeNull();
  });

  it("returns null for non-numeric", () => {
    expect(parseOjolAmount("abc")).toBeNull();
  });
});

describe("parseShopeeFood", () => {
  it("parses single ShopeeFood order", () => {
    const text = "22:30 ShopeeFood Rp18,400";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe("income");
    expect(result[0].amount).toBe(18400);
    expect(result[0].category).toBe("orderan");
    expect(result[0].description).toBe("ShopeeFood 22:30");
  });

  it("parses OCR typo 'ShapeeFood'", () => {
    const text = "22:30 If ShapeeFoodPesanan GabunganRp18,400";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(18400);
  });

  it("parses OCR typo 'shopeeFood' with noise prefix", () => {
    const text = "20:52 I! shopeeFoodPesunan GabunganRp16,800";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(16800);
  });

  it("parses dot separator: 'Rp12.000'", () => {
    const text = "21:43 f ShopeefoodRp12.000";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(12000);
  });

  it("parses ShuppeFood typo", () => {
    const text = "20:18 f ShuppeFood Pesanan @ubungonRp12,800";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(12800);
  });

  it("picks up fallback time+Rp lines without ShopeeFood label", () => {
    const text = "18:25 Rp27,200\n17:06 Rp30,400\n16:00 Rp32,800";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(3);
    expect(result[0].amount).toBe(32800);  // sorted descending by time
    expect(result[1].amount).toBe(30400);
    expect(result[2].amount).toBe(27200);
  });

  it("deduplicates same time+amount", () => {
    const text = "22:30 ShopeeFood Rp18,400\n22:30 ShopeeFood Rp18,400";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(1);
  });

  it("keeps different amounts at same time", () => {
    const text = "22:30 ShopeeFood Rp18,400\n22:30 ShopeeFood Rp25,000";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(2);
  });

  it("filters out amounts < 1000", () => {
    const text = "22:30 ShopeeFood Rp500";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(0);
  });

  it("filters out amounts > 10,000,000", () => {
    const text = "22:30 ShopeeFood Rp15,000,000";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(0);
  });

  // ============================================
  // REAL-WORLD TEST: Actual OCR from live test
  // ============================================
  it("parses full real-world ShopeeFood screenshot (9 orders, 1369 chars raw)", () => {
    // This is the actual OCR output from the user's live test
    // that caused the AI timeout (Bug #12)
    const realOCR = [
      "09 Feb 2026 ~",
      "22:30 If ShapeeFoodPesanan GabunganRp18,400",
      "Muncul Malam Nasi Goreng Kambing - Ke...",
      "Republic Kebab Premium, Kembangan",
      "21:43 f ShopeefoodRp12.000",
      "Mas oak nadatokan",
      "Republic Kebab Premium - Kreo Selatan",
      "21:16 ff ShopeeFoodRp8.000",
      "11.Cafe Seblak Mabel - Cipadu",
      "20:52 I! shopeeFoodPesunan GabunganRp16,800",
      "Bubur Ayam Warkop Berkah - Bintaro",
      "Martabak Oeloeng Sehati - Pesanggrahan",
      "20:18 f ShuppeFood Pesanan @ubungonRp12,800",
      "Hil Kebab - Ciputat Timur",
      "Kerang Kiloan Presiden - Ciputat Timur",
      "19:17 ShopeeFood Pesanan GabungenRp12,000",
      "Hot Side Story (Hangry Spicy Chicken) - C.L...",
      "Hot Side Story (Hangry Spicy Chicken) - CL..",
      "18:25 Rp27,200",
      "17:06 Rp30,400",
      "nanare alacos",
      "16:00 Rp32,800",
    ].join("\n");

    const result = parseShopeeFood(realOCR);

    // ALL 9 orders should be parsed
    expect(result.length).toBe(9);

    // Verify amounts (sorted by time descending)
    const amounts = result.map((t) => t.amount);
    expect(amounts).toContain(18400);  // 22:30
    expect(amounts).toContain(12000);  // 21:43
    expect(amounts).toContain(8000);   // 21:16
    expect(amounts).toContain(16800);  // 20:52
    expect(amounts).toContain(12800);  // 20:18
    expect(amounts).toContain(12000);  // 19:17
    expect(amounts).toContain(27200);  // 18:25
    expect(amounts).toContain(30400);  // 17:06
    expect(amounts).toContain(32800);  // 16:00

    // Total should be Rp170,400
    const total = result.reduce((sum, t) => sum + t.amount, 0);
    expect(total).toBe(170400);

    // All should be income/orderan
    for (const t of result) {
      expect(t.type).toBe("income");
      expect(t.category).toBe("orderan");
    }
  });

  it("handles colon as separator in amount: 'Rp27:200'", () => {
    // OCR sometimes reads comma/dot as colon
    const text = "18:25 Rp27:200";
    const result = parseShopeeFood(text);

    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(27200);
  });
});
