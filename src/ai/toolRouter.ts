/**
 * Tool Router — Fase F Dynamic Tool Selection
 *
 * Regex-based pre-filter that selects relevant tool subsets
 * based on keywords in user message. This reduces the number
 * of tool schemas sent to the GPU (from 15 → 4-5 per request).
 *
 * IMPORTANT: This does NOT replace AI intent detection.
 * AI still decides which specific tool to call.
 * This only narrows the "menu" the AI reads.
 *
 * Fallback: if no pattern matches, ALL 15 tools are sent (safe default).
 */

import {
  TOOLS,
  TRANSACTION_TOOLS,
  DEBT_TOOLS,
  QUERY_TOOLS,
  EDIT_TOOLS,
  SETTING_TOOLS,
} from "./tools";

type ToolDef = (typeof TOOLS)[number];

/**
 * Keyword patterns for each tool group.
 * Order matters — first match wins.
 * Patterns are intentionally broad to avoid false negatives.
 */
const ROUTE_PATTERNS: Array<{
  pattern: RegExp;
  tools: readonly ToolDef[];
  label: string;
}> = [
  // QUERY — check first because "rekap" / "daftar" are unambiguous
  {
    pattern:
      /\b(rekap|ringkasan|summary|daftar|list|riwayat|histor|target|berapa)\b/i,
    tools: QUERY_TOOLS,
    label: "QUERY",
  },
  // EDIT/DELETE — "ubah", "edit", "hapus", "selesai", "batal"
  {
    pattern:
      /\b(ubah|edit|ganti|hapus|delete|hilang|selesai|batal|cancel|koreksi|salah|harusnya)\b/i,
    tools: EDIT_TOOLS,
    label: "EDIT",
  },
  // SETTING — "cicilan", "kewajiban", "goal", "nabung", "target beli"
  {
    pattern:
      /\b(cicilan|kewajiban|obligation|goal|nabung|saving|tabung)\b/i,
    tools: SETTING_TOOLS,
    label: "SETTING",
  },
  // DEBT — "hutang", "piutang", "minjem", "pinjam", "bayar" (with person context)
  {
    pattern:
      /\b(hutang|piutang|utang|minjem|pinjam|pinjem|ngutang|bayar|nyicil|lunas)\b/i,
    tools: DEBT_TOOLS,
    label: "DEBT",
  },
  // TRANSACTION — default for financial input (most common ~80%)
  // Matches: any number/amount pattern, slang money, or common categories
  {
    pattern:
      /\b(\d+|rb|ribu|jt|juta|goceng|gocap|ceban|seceng|makan|bensin|rokok|parkir|servis|pulsa|orderan|bonus|tip|gaji|dapet|dapat)\b/i,
    tools: TRANSACTION_TOOLS,
    label: "TRANSACTION",
  },
];

/**
 * Select the most relevant tool subset for a user message.
 * Returns ALL_TOOLS as fallback if no pattern matches.
 */
export function selectToolsForMessage(
  userText: string
): { tools: readonly ToolDef[]; label: string } {
  const text = userText.toLowerCase().trim();

  for (const route of ROUTE_PATTERNS) {
    if (route.pattern.test(text)) {
      console.log(
        `[ToolRouter] Matched: ${route.label} (${route.tools.length} tools)`
      );
      return { tools: route.tools, label: route.label };
    }
  }

  // Fallback: no match → send all tools (same as before Fase F)
  console.log(
    `[ToolRouter] No match, fallback: ALL (${TOOLS.length} tools)`
  );
  return { tools: TOOLS, label: "ALL" };
}
