/**
 * OCR Parser Orchestrator
 *
 * Entry point for local OCR parsing. Tries to detect the format
 * of OCR text and parse it using a specialized regex parser.
 *
 * If format is unknown or parser yields 0 transactions,
 * returns null → caller should fall back to AI pipeline.
 *
 * Flow:
 *   cleanedText → detectFormat() → parser() → ParsedTransaction[]
 *                                              + dateOffset
 */

import { ParsedTransaction } from "../types/transaction";
import { detectFormat, OCRFormat } from "./detector";
import { parseShopee } from "./shopee";

export interface ParseResult {
  /** Detected format */
  format: OCRFormat;
  /** Parsed transactions (income/expense) */
  transactions: ParsedTransaction[];
  /** Date offset from OCR header: 0=today, -1=yesterday, etc. */
  dateOffset: number;
  /** Detection confidence */
  confidence: "high" | "medium";
}

/**
 * Try to parse OCR text using local regex parsers.
 *
 * @param cleanedText - OCR text after noise removal
 * @returns ParseResult if successful, null if format unknown or 0 transactions
 */
export function tryParseOCR(cleanedText: string): ParseResult | null {
  const detection = detectFormat(cleanedText);

  if (detection.format === "unknown") {
    return null;
  }

  let transactions: ParsedTransaction[] = [];

  switch (detection.format) {
    case "shopee":
      transactions = parseShopee(cleanedText);
      break;

    // Future parsers:
    // case "grab":
    //   transactions = parseGrab(cleanedText);
    //   break;

    default:
      // Format detected but no parser implemented yet
      return null;
  }

  // If parser found nothing, fall back to AI
  if (transactions.length === 0) {
    return null;
  }

  // Detect date from OCR text header
  const dateOffset = detectDateOffset(cleanedText);

  // Apply date offset to all transactions
  if (dateOffset !== 0) {
    transactions = transactions.map((t) => ({
      ...t,
      date_offset: dateOffset,
    }));
  }

  return {
    format: detection.format,
    transactions,
    dateOffset,
    confidence: detection.confidence,
  };
}

/**
 * Detect date offset from OCR text header.
 *
 * Shopee screenshots typically start with:
 *   "09 Feb 2026 ~"
 *
 * Compares to current date (WIB) to calculate offset.
 *   "09 Feb 2026" when today is "10 Feb 2026" → -1
 *   "10 Feb 2026" when today is "10 Feb 2026" → 0
 *
 * Returns 0 if no date found or date is in the future.
 */
export function detectDateOffset(text: string): number {
  // Match: "09 Feb 2026" or "9 Feb 2026"
  const dateMatch = text.match(
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i
  );
  if (!dateMatch) return 0;

  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const day = parseInt(dateMatch[1]);
  const month = months[dateMatch[2].toLowerCase()];
  const year = parseInt(dateMatch[3]);

  if (month === undefined) return 0;

  const ocrDate = new Date(Date.UTC(year, month, day));

  // Get today in WIB (UTC+7)
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(Date.now() + WIB_OFFSET_MS);
  const todayWIB = new Date(
    Date.UTC(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth(), nowWIB.getUTCDate())
  );

  const diffMs = ocrDate.getTime() - todayWIB.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  // Only accept past dates (0 to -30 days)
  return diffDays <= 0 && diffDays >= -30 ? diffDays : 0;
}
