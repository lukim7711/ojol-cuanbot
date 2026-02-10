/**
 * ShopeeFood Order History Parser
 *
 * Parses OCR text from ShopeeFood order history screenshots.
 * Each order line becomes 1 income transaction for the driver.
 *
 * Pattern (from real OCR output):
 *   "22:30 If ShapeeFoodPesanan GabunganRp18,400"
 *   "21:43 f ShopeefoodRp12.000"
 *   "20:52 I! shopeeFoodPesunan GabunganRp16,800"
 *   "18:25 Rp27:200"  ← no platform label but has time + amount
 *
 * OCR artifacts handled:
 *   - Typos: ShapeeFood, ShuppeFood, Shopeefood
 *   - Noise: "If", "f", "ff", "I!" before platform name
 *   - Separators: comma, dot, or colon as thousand separator
 *   - Missing platform: later entries sometimes omit "ShopeeFood"
 */

import { ParsedTransaction } from "../types/transaction";

/**
 * Primary pattern: time + [noise] + ShopeeFood + [gabungan] + Rp + amount
 * Captures: (1) time, (2) raw amount string
 */
const SHOPEE_ORDER_REGEX =
  /(\d{1,2}:\d{2})\s*.*?sh[aou]p+ee?\s*food.*?Rp\s*([\d.,:']+)/gi;

/**
 * Fallback pattern: time + Rp + amount (no platform label)
 * Used for entries at the bottom of screenshots where OCR
 * drops the platform name. Only matched if NOT already caught
 * by the primary pattern.
 * Captures: (1) time, (2) raw amount string
 */
const TIME_AMOUNT_REGEX =
  /^\s*(\d{1,2}:\d{2})\s+.*?Rp\s*([\d.,:']+)/gm;

/**
 * Parse ShopeeFood order history OCR text into transactions.
 *
 * @param cleanedText - OCR text after noise removal (no "Alamat Pelanggan" etc.)
 * @returns Array of income transactions, one per order.
 */
export function parseShopeeFood(cleanedText: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  const seen = new Set<string>(); // dedup by time+amount

  // Pass 1: Primary pattern (with ShopeeFood label)
  let match: RegExpExecArray | null;
  SHOPEE_ORDER_REGEX.lastIndex = 0;

  while ((match = SHOPEE_ORDER_REGEX.exec(cleanedText)) !== null) {
    const time = match[1];
    const amount = parseOjolAmount(match[2]);
    if (!amount || amount < 1000 || amount > 10_000_000) continue;

    const key = `${time}:${amount}`;
    if (seen.has(key)) continue;
    seen.add(key);

    transactions.push({
      type: "income",
      amount,
      category: "orderan",
      description: `ShopeeFood ${time}`,
      date_offset: 0,
    });
  }

  // Pass 2: Fallback — lines with time + Rp but no ShopeeFood label
  // Only add if not already captured in Pass 1
  TIME_AMOUNT_REGEX.lastIndex = 0;

  while ((match = TIME_AMOUNT_REGEX.exec(cleanedText)) !== null) {
    const time = match[1];
    const amount = parseOjolAmount(match[2]);
    if (!amount || amount < 1000 || amount > 10_000_000) continue;

    const key = `${time}:${amount}`;
    if (seen.has(key)) continue;
    seen.add(key);

    transactions.push({
      type: "income",
      amount,
      category: "orderan",
      description: `ShopeeFood ${time}`,
      date_offset: 0,
    });
  }

  // Sort by time descending (latest first, matching screenshot order)
  transactions.sort((a, b) => {
    const timeA = a.description.split(" ")[1] || "";
    const timeB = b.description.split(" ")[1] || "";
    return timeB.localeCompare(timeA);
  });

  return transactions;
}

/**
 * Parse ojol amount strings from OCR.
 *
 * Handles common OCR artifacts:
 *   "18,400"  → 18400  (comma as thousand sep)
 *   "12.000"  → 12000  (dot as thousand sep)
 *   "382.350" → 382350
 *   "27:200"  → 27200  (colon misread from comma/dot)
 *   "8.000"   → 8000
 *   "16,800"  → 16800
 *   "12'000"  → 12000  (apostrophe artifact)
 *
 * @returns Parsed integer amount, or null if unparseable.
 */
export function parseOjolAmount(raw: string): number | null {
  if (!raw) return null;

  // Step 1: Normalize separators — colon and apostrophe → comma
  let cleaned = raw.replace(/[:']/g, ",");

  // Step 2: If separator followed by exactly 3 digits → thousand separator
  // "18,400" → "18400", "12.000" → "12000"
  cleaned = cleaned.replace(/[.,](\d{3})(?!\d)/g, "$1");

  // Step 3: Remove any remaining non-digit chars
  cleaned = cleaned.replace(/[^\d]/g, "");

  const num = parseInt(cleaned, 10);
  return isNaN(num) || num <= 0 ? null : num;
}
