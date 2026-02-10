/**
 * Shopee Driver Order History Parser
 *
 * Unified parser for Shopee driver order history screenshots.
 * Shopee drivers handle BOTH:
 *   - ShopeeFood (food delivery orders)
 *   - SPX (package delivery: Instant, Standard, Express, Ekonomi)
 *
 * Both types appear in the same order history screen.
 * Each order line → 1 income transaction for the driver.
 *
 * Real OCR patterns:
 *   "22:30 If ShapeeFoodPesanan GabunganRp18,400"   ← food
 *   "21:43 f ShopeefoodRp12.000"                     ← food
 *   "18:25 SPX Instant (Marketplace) Rp27,200"       ← package
 *   "17:06 SPX Instant (Marketplace) Rp30,400"       ← package
 *   "16:00 Rp32,800"                                  ← fallback (no label)
 */

import { ParsedTransaction } from "../types/transaction";

/**
 * Pass 1: ShopeeFood orders
 * Pattern: time + [noise] + ShopeeFood + [gabungan] + Rp + amount
 */
const SHOPEE_FOOD_REGEX =
  /(\d{1,2}:\d{2})\s*.*?sh[aou]p+ee?\s*food.*?Rp\s*([\d.,:']+)/gi;

/**
 * Pass 2: SPX package deliveries
 * Pattern: time + SPX + (Instant|Standard|Express|Ekonomi|Marketplace) + Rp + amount
 * OCR may read "SPX" as "5PX", "SPx", etc.
 */
const SPX_ORDER_REGEX =
  /(\d{1,2}:\d{2})\s*.*?(?:spx|5px)\s*(?:instant|standard|express|ekonomi|marketplace).*?Rp\s*([\d.,:']+)/gi;

/**
 * Pass 3: Fallback — lines with time + Rp but no platform label
 * Used for entries at the bottom of screenshots where OCR
 * drops the platform name.
 */
const TIME_AMOUNT_REGEX =
  /^\s*(\d{1,2}:\d{2})\s+.*?Rp\s*([\d.,:']+)/gm;

/**
 * Parse Shopee driver order history OCR text into transactions.
 *
 * @param cleanedText - OCR text after noise removal
 * @returns Array of income transactions, one per order.
 */
export function parseShopee(cleanedText: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  const seen = new Set<string>(); // dedup by time+amount

  // Pass 1: ShopeeFood orders
  extractOrders(cleanedText, SHOPEE_FOOD_REGEX, "ShopeeFood", seen, transactions);

  // Pass 2: SPX package deliveries
  extractOrders(cleanedText, SPX_ORDER_REGEX, "SPX", seen, transactions);

  // Pass 3: Fallback — time + Rp without label
  extractOrders(cleanedText, TIME_AMOUNT_REGEX, "Shopee", seen, transactions);

  // Sort by time descending (latest first, matching screenshot order)
  transactions.sort((a, b) => {
    const timeA = a.description.match(/\d{1,2}:\d{2}/)?.[0] || "";
    const timeB = b.description.match(/\d{1,2}:\d{2}/)?.[0] || "";
    return timeB.localeCompare(timeA);
  });

  return transactions;
}

/**
 * Extract orders from text using a regex pattern.
 * Shared logic for all 3 passes.
 */
function extractOrders(
  text: string,
  regex: RegExp,
  label: string,
  seen: Set<string>,
  transactions: ParsedTransaction[]
): void {
  let match: RegExpExecArray | null;
  regex.lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
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
      description: `${label} ${time}`,
      date_offset: 0,
    });
  }
}

/**
 * Parse ojol amount strings from OCR.
 *
 * Handles common OCR artifacts:
 *   "18,400"  → 18400  (comma as thousand sep)
 *   "12.000"  → 12000  (dot as thousand sep)
 *   "27:200"  → 27200  (colon misread from comma/dot)
 *   "12'000"  → 12000  (apostrophe artifact)
 *
 * @returns Parsed integer amount, or null if unparseable.
 */
export function parseOjolAmount(raw: string): number | null {
  if (!raw) return null;

  // Step 1: Normalize separators — colon and apostrophe → comma
  let cleaned = raw.replace(/[:']/g, ",");

  // Step 2: If separator followed by exactly 3 digits → thousand separator
  cleaned = cleaned.replace(/[.,](\d{3})(?!\d)/g, "$1");

  // Step 3: Remove any remaining non-digit chars
  cleaned = cleaned.replace(/[^\d]/g, "");

  const num = parseInt(cleaned, 10);
  return isNaN(num) || num <= 0 ? null : num;
}
