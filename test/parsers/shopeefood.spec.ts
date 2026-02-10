import { describe, it, expect } from "vitest";
import { parseShopee, parseOjolAmount } from "../../src/parsers/shopee";

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

describe("parseShopee", () => {
  describe("ShopeeFood orders", () => {
    it("parses single ShopeeFood order", () => {
      const text = "22:30 ShopeeFood Rp18,400";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe("income");
      expect(result[0].amount).toBe(18400);
      expect(result[0].category).toBe("orderan");
      expect(result[0].description).toBe("ShopeeFood 22:30");
    });

    it("parses OCR typo 'ShapeeFood'", () => {
      const text = "22:30 If ShapeeFoodPesanan GabunganRp18,400";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(18400);
      expect(result[0].description).toBe("ShopeeFood 22:30");
    });

    it("parses OCR typo 'shopeeFood' with noise prefix", () => {
      const text = "20:52 I! shopeeFoodPesunan GabunganRp16,800";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(16800);
    });

    it("parses dot separator: 'Rp12.000'", () => {
      const text = "21:43 f ShopeefoodRp12.000";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(12000);
    });

    it("parses ShuppeFood typo", () => {
      const text = "20:18 f ShuppeFood Pesanan @ubungonRp12,800";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(12800);
    });
  });

  describe("SPX package orders", () => {
    it("parses SPX Instant order", () => {
      const text = "18:25 SPX Instant (Marketplace) Rp27,200";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe("income");
      expect(result[0].amount).toBe(27200);
      expect(result[0].category).toBe("orderan");
      expect(result[0].description).toBe("SPX 18:25");
    });

    it("parses SPX Standard order", () => {
      const text = "14:00 SPX Standard Rp15,000";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(15000);
      expect(result[0].description).toBe("SPX 14:00");
    });

    it("parses SPX Express order", () => {
      const text = "10:30 SPX Express Rp20,000";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(20000);
      expect(result[0].description).toBe("SPX 10:30");
    });

    it("parses SPX Ekonomi order", () => {
      const text = "09:15 SPX Ekonomi Rp8,500";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(8500);
      expect(result[0].description).toBe("SPX 09:15");
    });
  });

  describe("Mixed ShopeeFood + SPX", () => {
    it("parses mixed food and package orders correctly", () => {
      const text = [
        "22:30 ShopeeFood Pesanan Gabungan Rp18,400",
        "Restaurant Name",
        "18:25 SPX Instant (Marketplace) Rp27,200",
        "Alamat Pengirim disembunyikan",
        "17:06 SPX Instant (Marketplace) Rp30,400",
      ].join("\n");

      const result = parseShopee(text);

      expect(result.length).toBe(3);
      // Sorted by time descending
      expect(result[0].description).toBe("ShopeeFood 22:30");
      expect(result[0].amount).toBe(18400);
      expect(result[1].description).toBe("SPX 18:25");
      expect(result[1].amount).toBe(27200);
      expect(result[2].description).toBe("SPX 17:06");
      expect(result[2].amount).toBe(30400);
    });

    it("deduplicates same time+amount across passes", () => {
      // If somehow both ShopeeFood and SPX regex match same line
      const text = "22:30 ShopeeFood Rp18,400\n22:30 ShopeeFood Rp18,400";
      const result = parseShopee(text);
      expect(result.length).toBe(1);
    });
  });

  describe("Fallback (time+Rp, no label)", () => {
    it("picks up time+Rp lines without platform label", () => {
      const text = "18:25 Rp27,200\n17:06 Rp30,400\n16:00 Rp32,800";
      const result = parseShopee(text);

      expect(result.length).toBe(3);
      // Sorted descending by time: 18:25 > 17:06 > 16:00
      expect(result[0].amount).toBe(27200);
      expect(result[0].description).toBe("Shopee 18:25");
      expect(result[1].amount).toBe(30400);
      expect(result[1].description).toBe("Shopee 17:06");
      expect(result[2].amount).toBe(32800);
      expect(result[2].description).toBe("Shopee 16:00");
    });

    it("handles colon as separator in amount: 'Rp27:200'", () => {
      const text = "18:25 Rp27:200";
      const result = parseShopee(text);

      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(27200);
    });
  });

  describe("Edge cases", () => {
    it("filters out amounts < 1000", () => {
      const text = "22:30 ShopeeFood Rp500";
      expect(parseShopee(text).length).toBe(0);
    });

    it("filters out amounts > 10,000,000", () => {
      const text = "22:30 ShopeeFood Rp15,000,000";
      expect(parseShopee(text).length).toBe(0);
    });

    it("keeps different amounts at same time", () => {
      const text = "22:30 ShopeeFood Rp18,400\n22:30 ShopeeFood Rp25,000";
      expect(parseShopee(text).length).toBe(2);
    });
  });

  // ============================================
  // REAL-WORLD TEST: Full screenshot with food + SPX
  // ============================================
  describe("Real-world: full screenshot (6 food + 3 SPX)", () => {
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
      "18:25 SPX Instant (Marketplace) Rp27,200",
      "17:06 SPX Instant (Marketplace) Rp30,400",
      "nanare alacos",
      "16:00 SPX Instant (Marketplace) Rp32,800",
    ].join("\n");

    it("parses all 9 orders", () => {
      const result = parseShopee(realOCR);
      expect(result.length).toBe(9);
    });

    it("correctly labels food vs SPX", () => {
      const result = parseShopee(realOCR);

      const food = result.filter((t) => t.description.startsWith("ShopeeFood"));
      const spx = result.filter((t) => t.description.startsWith("SPX"));

      expect(food.length).toBe(6);
      expect(spx.length).toBe(3);
    });

    it("calculates correct total: Rp170,400", () => {
      const result = parseShopee(realOCR);
      const total = result.reduce((sum, t) => sum + t.amount, 0);
      expect(total).toBe(170400);
    });

    it("sorts by time descending (22:30 first, 16:00 last)", () => {
      const result = parseShopee(realOCR);
      expect(result[0].description).toBe("ShopeeFood 22:30");
      expect(result[result.length - 1].description).toBe("SPX 16:00");
    });

    it("all transactions are income/orderan", () => {
      const result = parseShopee(realOCR);
      for (const t of result) {
        expect(t.type).toBe("income");
        expect(t.category).toBe("orderan");
      }
    });
  });
});
