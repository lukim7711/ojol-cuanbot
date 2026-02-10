/**
 * OCR Format Detector
 * Scans cleaned OCR text and identifies the source app/format.
 * Used to route to the correct local parser (bypass AI).
 */

export type OCRFormat = "shopeefood" | "spx" | "grab" | "gopay" | "unknown";

export interface DetectionResult {
  format: OCRFormat;
  confidence: "high" | "medium";
}

/**
 * Detect the format/source of OCR text.
 *
 * Detection strategy: keyword matching with typo tolerance.
 * OCR engines commonly produce typos like:
 *   ShapeeFood, Shopeefood, shopeeFood, ShuppeFood
 *
 * Returns "unknown" if no known format is detected → caller should
 * fall back to AI pipeline.
 */
export function detectFormat(text: string): DetectionResult {
  // ShopeeFood: flexible pattern for OCR typos
  // Matches: ShopeeFood, ShapeeFood, Shopeefood, shopeeFood, ShuppeFood
  if (/sh[aou]p+ee?\s*food/i.test(text)) {
    return { format: "shopeefood", confidence: "high" };
  }

  // SPX Express / SPX Instant / SPX Standard (Shopee logistics)
  if (/spx\s*(express|instant|standard|ekonomi)/i.test(text)) {
    return { format: "spx", confidence: "high" };
  }

  // GrabFood
  if (/grab\s*food/i.test(text)) {
    return { format: "grab", confidence: "high" };
  }

  // GoPay / Go-Pay e-wallet
  if (/go-?pay/i.test(text)) {
    return { format: "gopay", confidence: "medium" };
  }

  return { format: "unknown", confidence: "medium" };
}
