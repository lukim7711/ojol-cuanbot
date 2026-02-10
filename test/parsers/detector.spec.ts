import { describe, it, expect } from "vitest";
import { detectFormat } from "../../src/parsers/detector";

describe("detectFormat", () => {
  describe("ShopeeFood detection", () => {
    it("detects standard 'ShopeeFood'", () => {
      const result = detectFormat("22:30 ShopeeFood Rp18,400");
      expect(result.format).toBe("shopeefood");
      expect(result.confidence).toBe("high");
    });

    it("detects OCR typo 'ShapeeFood'", () => {
      expect(detectFormat("22:30 If ShapeeFoodPesanan").format).toBe("shopeefood");
    });

    it("detects OCR typo 'Shopeefood' (lowercase)", () => {
      expect(detectFormat("21:43 f ShopeefoodRp12.000").format).toBe("shopeefood");
    });

    it("detects OCR typo 'shopeeFood' (mixed case)", () => {
      expect(detectFormat("20:52 I! shopeeFoodPesunan").format).toBe("shopeefood");
    });

    it("detects OCR typo 'ShuppeFood'", () => {
      expect(detectFormat("20:18 f ShuppeFood Pesanan").format).toBe("shopeefood");
    });

    it("detects 'Shopee Food' with space", () => {
      expect(detectFormat("22:30 Shopee Food Rp18,400").format).toBe("shopeefood");
    });
  });

  describe("SPX detection", () => {
    it("detects 'SPX Express'", () => {
      expect(detectFormat("SPX Express Rp8,000").format).toBe("spx");
    });

    it("detects 'SPX Instant'", () => {
      expect(detectFormat("SPX Instant (Marketplace)").format).toBe("spx");
    });

    it("detects 'SPX Standard'", () => {
      expect(detectFormat("SPX Standard Rp12,000").format).toBe("spx");
    });

    it("detects 'SPX Ekonomi'", () => {
      expect(detectFormat("SPX Ekonomi Rp5,000").format).toBe("spx");
    });
  });

  describe("GrabFood detection", () => {
    it("detects 'GrabFood'", () => {
      expect(detectFormat("GrabFood Rp25,000").format).toBe("grab");
    });

    it("detects 'Grab Food' with space", () => {
      expect(detectFormat("Grab Food order").format).toBe("grab");
    });
  });

  describe("GoPay detection", () => {
    it("detects 'GoPay'", () => {
      const result = detectFormat("GoPay Transfer Rp50,000");
      expect(result.format).toBe("gopay");
      expect(result.confidence).toBe("medium");
    });

    it("detects 'Go-Pay' with hyphen", () => {
      expect(detectFormat("Go-Pay Balance").format).toBe("gopay");
    });
  });

  describe("Unknown format", () => {
    it("returns unknown for plain text", () => {
      expect(detectFormat("makan siang 25rb").format).toBe("unknown");
    });

    it("returns unknown for handwriting OCR", () => {
      expect(detectFormat("Beli bensin pertamax Rp50.000").format).toBe("unknown");
    });

    it("returns unknown for bank transfer", () => {
      expect(detectFormat("Transfer BCA ke 1234567").format).toBe("unknown");
    });
  });
});
