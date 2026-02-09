/**
 * AI Validation & Detection
 * Validates tool calls (amounts, array sizes, dedup) and detects
 * casual chat / financial input / action queries.
 *
 * Phase 3: Added delete limiter — max 1 delete operation per request.
 */

import { AIResult } from "./parser";

/**
 * Detect truly casual messages that should NOT enter the pipeline.
 * Intentionally NARROW — <=4 words + greeting pattern only.
 */
export function isCasualChat(text: string): boolean {
  const casualPatterns = [
    /^(halo|hai|hey|hi|yo|woi)\b/i,
    /^(pagi|siang|sore|malam|met\s)/i,
    /^(makasih|thanks|thank|terima\s*kasih)/i,
    /^(ok|oke|okey|sip|siap|mantap|good|nice)\b/i,
    /^(bye|dadah|sampai\s*jumpa)/i,
    /^(lagi\s+apa|apa\s+kabar|gimana)/i,
    /^(lu\s+siapa|kamu\s+siapa|lo\s+bisa\s+apa)/i,
  ];

  const lower = text.toLowerCase().trim();
  if (lower.split(/\s+/).length > 4) return false;

  return casualPatterns.some((p) => p.test(lower));
}

/**
 * Validate and sanitize tool calls — defense against runaway arrays
 * and excessive delete operations.
 */
export function validateToolCalls(result: AIResult): AIResult {
  const MAX_TRANSACTIONS = 10;
  const MIN_AMOUNT = 1;
  const MAX_AMOUNT = 100_000_000; // 100 juta
  const MAX_DELETES_PER_REQUEST = 1;

  // ============================================
  // PHASE 3: Count and limit delete operations
  // ============================================
  let deleteCount = 0;

  for (const tc of result.toolCalls) {
    // Guard: ensure transactions is an array (Llama sometimes returns string)
    if (tc.name === "record_transactions" && tc.arguments.transactions) {
      let txns = tc.arguments.transactions;

      // Safety: parse if still a string after deepParseArguments
      if (typeof txns === "string") {
        try {
          txns = JSON.parse(txns);
          tc.arguments.transactions = txns;
          console.log(
            "[Validate] Parsed transactions from string to array"
          );
        } catch (_) {
          console.error(
            "[Validate] Cannot parse transactions string. Clearing."
          );
          tc.arguments.transactions = [];
          continue;
        }
      }

      // Guard: must be array
      if (!Array.isArray(txns)) {
        console.error(
          "[Validate] transactions is not an array:",
          typeof txns
        );
        tc.arguments.transactions = [];
        continue;
      }

      // Guard: limit array size
      if (txns.length > MAX_TRANSACTIONS) {
        console.warn(
          `[Validate] Runaway array detected: ${txns.length} items. Truncating to ${MAX_TRANSACTIONS}.`
        );
        tc.arguments.transactions = txns.slice(0, MAX_TRANSACTIONS);
      }

      // Validate each transaction amount
      tc.arguments.transactions = tc.arguments.transactions.filter(
        (t: any) => {
          const amount = Number(t.amount);
          if (isNaN(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
            console.warn(
              `[Validate] Invalid amount ${t.amount} for "${t.description}". Skipping.`
            );
            return false;
          }
          return true;
        }
      );
    }

    // Guard: validate debt/payment amounts
    if (
      ["record_debt", "pay_debt", "edit_debt"].includes(tc.name) &&
      tc.arguments.amount !== undefined
    ) {
      const amount = Number(tc.arguments.amount);
      if (isNaN(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
        console.warn(
          `[Validate] Invalid debt/payment amount: ${tc.arguments.amount}. Removing tool call.`
        );
        tc.arguments._invalid = true;
      }
    }

    // ============================================
    // PHASE 3: Track delete operations
    // ============================================
    if (
      (tc.name === "edit_transaction" || tc.name === "edit_debt") &&
      tc.arguments.action === "delete"
    ) {
      deleteCount++;
      if (deleteCount > MAX_DELETES_PER_REQUEST) {
        console.warn(
          `[Validate] Max ${MAX_DELETES_PER_REQUEST} delete per request. Dropping extra delete: ${tc.name}(${tc.arguments.target || tc.arguments.person_name})`
        );
        tc.arguments._invalid = true;
      }
    }
  }

  // Remove tool calls marked as invalid
  result.toolCalls = result.toolCalls.filter((tc) => {
    if (tc.arguments._invalid) {
      console.warn(`[Validate] Removing invalid tool call: ${tc.name}`);
      return false;
    }
    return true;
  });

  // Deduplicate: if same tool called multiple times, keep only first
  const seen = new Set<string>();
  result.toolCalls = result.toolCalls.filter((tc) => {
    const key = tc.name;
    if (seen.has(key)) {
      console.warn(`[Validate] Duplicate tool call: ${key}. Removing.`);
      return false;
    }
    seen.add(key);
    return true;
  });

  return result;
}
