/**
 * Input Classifier — Pre-pipeline routing
 *
 * Classifies user input to determine which pipeline path to take:
 * - CLEAN: Already has explicit amounts (Rp/angka jelas) → skip NLU
 * - QUERY: Simple read queries (rekap, daftar, target) → skip NLU
 * - SLANG: Contains Indonesian money slang → needs NLU normalization
 * - EDIT: Edit/delete commands → needs NLU for item name preservation
 * - COMPLEX: Multi-line, mixed, or ambiguous → needs full NLU
 *
 * This is a pure regex classifier — zero AI cost, <1ms execution.
 */

export type InputClass = "CLEAN" | "QUERY" | "SLANG" | "EDIT" | "COMPLEX";

/** Slang patterns that need NLU normalization */
const SLANG_PATTERNS = /\b(rb|ribu|jt|juta|ceban|goceng|gocap|seceng|setengah\s*juta|sejuta)\b/i;

/** Query patterns that don't need any normalization */
const QUERY_PATTERNS = /^(rekap|daftar|cek|lihat|target|riwayat)\b/i;

/** Edit/delete patterns that need NLU for item preservation */
const EDIT_PATTERNS = /\b(ubah|edit|hapus|delete|salah|koreksi|yang terakhir|batal|cancel)\b/i;

/** Clean amount pattern: explicit Rp or plain numbers >= 1000 */
const CLEAN_AMOUNT = /(?:rp\.?\s*)?\d{1,3}(?:[.,]\d{3})+|(?:rp\.?\s*)\d{4,}/i;

/** Obligation/goal patterns that may contain slang amounts */
const TARGET_PATTERNS = /^(kewajiban|cicilan|goal|nabung|tabung|set\s)/i;

/**
 * Classify user input for pipeline routing.
 * Returns the input class that determines which stages to run.
 */
export function classifyInput(text: string): InputClass {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Multi-line → always complex (could be mixed slang + clean)
  if (trimmed.includes("\n") && trimmed.split("\n").filter((l) => l.trim()).length > 1) {
    // Exception: multi-line but ALL lines have clean amounts
    const lines = trimmed.split("\n").filter((l) => l.trim());
    const allClean = lines.every((l) => CLEAN_AMOUNT.test(l) && !SLANG_PATTERNS.test(l));
    if (allClean) return "CLEAN";
    return "COMPLEX";
  }

  // Edit/delete commands → needs NLU for item name preservation
  if (EDIT_PATTERNS.test(lower)) {
    return "EDIT";
  }

  // Simple query commands → skip NLU entirely
  if (QUERY_PATTERNS.test(lower)) {
    return "QUERY";
  }

  // Check for slang → needs NLU
  if (SLANG_PATTERNS.test(lower)) {
    return "SLANG";
  }

  // Target/obligation patterns with slang check
  if (TARGET_PATTERNS.test(lower)) {
    // If has slang amounts, needs NLU
    if (SLANG_PATTERNS.test(lower)) return "SLANG";
    // If clean amounts or no amounts, can skip
    return "CLEAN";
  }

  // Has explicit Rp amounts → clean, skip NLU
  if (CLEAN_AMOUNT.test(trimmed)) {
    return "CLEAN";
  }

  // Default: might contain context-dependent slang we didn't catch
  // Safe to send through NLU
  return "COMPLEX";
}

/**
 * Check if an input class can skip NLU.
 */
export function canSkipNLU(cls: InputClass): boolean {
  return cls === "CLEAN" || cls === "QUERY";
}
