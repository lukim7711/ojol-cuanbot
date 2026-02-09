/**
 * AI Engine — Thin Orchestrator
 * Single model pipeline: Llama Scout handles everything.
 * No more Qwen NLU stage — slang conversion is in-context via system prompt.
 *
 * Phase 3: Added daily AI call tracking via KV.
 */

import { Env } from "../config/env";
import { AIResult, ConversationMessage, stripThinkingTags } from "./parser";
import { isCasualChat, validateToolCalls } from "./validator";
import { executeWithLlama, chatWithLlama } from "./executor";

// Re-export types and functions used by other modules
export type { AIResult, ConversationMessage } from "./parser";
export { isCasualChat, validateToolCalls } from "./validator";

/** AI pipeline timeout — prevents hung Workers AI calls from blocking the entire request */
const AI_PIPELINE_TIMEOUT_MS = 15_000; // 15 seconds

/** Daily AI call soft limit per user */
const DAILY_AI_CALL_LIMIT = 200;

/**
 * Check and increment daily AI call count for a user.
 * Uses KV with TTL that expires at end of day (max 24h).
 * Returns true if the user has exceeded the daily limit.
 *
 * Fail-open: if KV errors, allow the request.
 */
async function isDailyLimitExceeded(
  kv: KVNamespace,
  userId: number
): Promise<boolean> {
  const key = `ai_daily:${userId}`;

  try {
    const current = await kv.get<number>(key, "json");

    if (current === null) {
      // First call today — set counter with 24h TTL
      await kv.put(key, "1", { expirationTtl: 86400 });
      return false;
    }

    if (current >= DAILY_AI_CALL_LIMIT) {
      console.warn(
        `[AI] User ${userId} exceeded daily AI call limit (${DAILY_AI_CALL_LIMIT})`
      );
      return true;
    }

    // Increment (keep existing TTL by not setting a new one —
    // KV put without expirationTtl on existing key preserves nothing,
    // so we set a safe 24h TTL each time)
    await kv.put(key, JSON.stringify(current + 1), { expirationTtl: 86400 });
    return false;
  } catch (error) {
    // Fail-open
    console.error("[AI] Daily limit KV error, failing open:", error);
    return false;
  }
}

/**
 * MAIN ENTRY POINT — Single Model Pipeline
 * Llama Scout handles slang conversion + function calling in one call.
 */
export async function runAI(
  env: Env,
  userId: number,
  userText: string,
  conversationHistory: ConversationMessage[] = []
): Promise<AIResult> {
  console.log(`[AI] Pipeline start for: "${userText}"`);

  // ============================================
  // PHASE 3: Daily AI call limit check
  // ============================================
  try {
    if (await isDailyLimitExceeded(env.RATE_LIMIT, userId)) {
      return {
        toolCalls: [],
        textResponse:
          "⚠️ Bos, hari ini udah banyak banget pesan ke AI (200+). " +
          "Istirahat dulu ya, besok lanjut lagi! \n\n" +
          "💡 Sementara bisa pakai command langsung:\n" +
          "/rekap — Rekap keuangan\n" +
          "/target — Cek target harian\n" +
          "/hutang — Daftar hutang",
      };
    }
  } catch (_) {
    // Fail-open: if check fails, continue
  }

  try {
    return await withTimeout(
      runPipeline(env, userId, userText, conversationHistory),
      AI_PIPELINE_TIMEOUT_MS
    );
  } catch (error) {
    if (error instanceof Error && error.message === "AI_PIPELINE_TIMEOUT") {
      console.error(`[AI] Pipeline timed out after ${AI_PIPELINE_TIMEOUT_MS}ms for: "${userText}"`);
      return {
        toolCalls: [],
        textResponse: "⏳ Wah lama banget nih prosesnya. Coba kirim ulang ya bos.",
      };
    }

    console.error("[AI] Pipeline error:", error);
    return {
      toolCalls: [],
      textResponse: "⚠️ Maaf bos, otak gue lagi error. Coba lagi ya.",
    };
  }
}

/**
 * Core pipeline — single model routing.
 *
 * Decision tree:
 *   1. Casual chat? → Llama chat mode (no tools)
 *   2. Financial input? → Llama FC mode (with tools + slang table)
 *   3. FC fails? → Retry once with enhanced hint
 */
async function runPipeline(
  env: Env,
  userId: number,
  userText: string,
  conversationHistory: ConversationMessage[]
): Promise<AIResult> {
  // ============================================
  // CASUAL CHAT → Llama chat mode (no tools)
  // ============================================
  if (isCasualChat(userText)) {
    console.log("[AI] Casual chat detected. Llama chat mode.");
    return await chatWithLlama(env, userText, conversationHistory);
  }

  // ============================================
  // FINANCIAL INPUT → Llama FC (single call)
  // Slang conversion handled via system prompt
  // ============================================
  console.log("[AI] Financial input. Single Llama FC call.");

  let result = await executeWithLlama(
    env,
    userText,
    userText,
    conversationHistory
  );

  result = validateToolCalls(result);

  // ============================================
  // RETRY: If first attempt produced nothing
  // ============================================
  if (result.toolCalls.length === 0 && !result.textResponse) {
    console.warn("[AI] First attempt produced no output. Retrying with hint.");

    result = await executeWithLlama(
      env,
      userText,
      userText,
      conversationHistory,
      true // enhanced mode — adds explicit hint
    );

    result = validateToolCalls(result);

    if (result.toolCalls.length === 0 && !result.textResponse) {
      console.warn("[AI] Retry also failed. Sending fallback.");
      result.textResponse =
        'Maaf bos, gue kurang paham. Coba ulangi ya, contoh: <i>makan 25rb, dapet 59rb</i>';
    } else {
      console.log(`[AI] Retry succeeded: ${result.toolCalls.length} tool calls`);
    }
  }

  console.log(
    `[AI] Pipeline done: ${result.toolCalls.length} tool calls, text: ${result.textResponse ? "yes" : "no"}`
  );

  return result;
}

/**
 * Promise timeout wrapper.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("AI_PIPELINE_TIMEOUT"));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
