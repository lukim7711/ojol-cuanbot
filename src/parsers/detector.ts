/**
 * OCR Format Detector
 * Scans cleaned OCR text and identifies the source app/format.
 * Used to route to the correct local parser (bypass AI).
 *
 * NOTE: ShopeeFood and SPX are NOT separate formats.
 * Shopee drivers handle both food orders and SPX package deliveries.
 * Both appear in the same order history screen.
 * → Both route to the unified "shopee" parser.
 */

export type OCRFormat = "shopee" | "grab" | "gopay" | "unknown";

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
    return { format: "shopee", confidence: "high" };
  }

  // SPX Express / Instant / Standard / Ekonomi (Shopee logistics)
  // Same driver, same history screen → same parser
  if (/spx\s*(express|instant|standard|ekonomi|marketplace)/i.test(text)) {
    return { format: "shopee", confidence: "high" };
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
