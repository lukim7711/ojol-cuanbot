/**
 * AI Engine — Thin Orchestrator
 * Coordinates the tiered pipeline:
 *   Fast path: classifier → skip NLU → Llama Scout FC
 *   Full path: Qwen NLU → Llama Scout FC
 * All heavy logic lives in dedicated modules (nlu, executor, parser, validator, classifier).
 */

import { Env } from "../config/env";
import { AIResult, ConversationMessage } from "./parser";
import { isCasualChat, validateToolCalls } from "./validator";
import { normalizeWithQwen, handleCasualChat } from "./nlu";
import { executeWithLlama } from "./executor";
import { classifyInput, canSkipNLU } from "./classifier";

// Re-export types and functions used by other modules
export type { AIResult, ConversationMessage } from "./parser";
export { isCasualChat, validateToolCalls } from "./validator";

/** AI pipeline timeout — prevents hung Workers AI calls from blocking the entire request */
const AI_PIPELINE_TIMEOUT_MS = 15_000; // 15 seconds

/**
 * MAIN ENTRY POINT — Tiered Model Pipeline
 * Wrapped with timeout and structured error handling.
 */
export async function runAI(
  env: Env,
  userId: number,
  userText: string,
  conversationHistory: ConversationMessage[] = []
): Promise<AIResult> {
  console.log(`[AI] Pipeline start for: "${userText}"`);

  try {
    // Wrap entire pipeline with timeout
    return await withTimeout(
      runPipeline(env, userId, userText, conversationHistory),
      AI_PIPELINE_TIMEOUT_MS
    );
  } catch (error) {
    // Structured error handling — never let AI errors crash the handler
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
 * Core pipeline logic — with tiered routing.
 *
 * Routing decision tree:
 *   1. Casual chat? → Single Qwen call (cheapest)
 *   2. CLEAN/QUERY? → Skip NLU, direct to Llama FC (save ~800-1200 tokens)
 *   3. SLANG/EDIT/COMPLEX? → Full pipeline: Qwen NLU → Llama FC
 */
async function runPipeline(
  env: Env,
  userId: number,
  userText: string,
  conversationHistory: ConversationMessage[]
): Promise<AIResult> {
  // ============================================
  // TIER 0: Casual chat → single Qwen call
  // ============================================
  if (isCasualChat(userText)) {
    console.log("[AI] Casual chat detected. Single Qwen call.");
    return await handleCasualChat(env, userText, conversationHistory);
  }

  // ============================================
  // CLASSIFY: Determine pipeline tier
  // ============================================
  const inputClass = classifyInput(userText);
  console.log(`[AI] Classified: "${userText}" → ${inputClass}`);

  // ============================================
  // TIER 1: CLEAN/QUERY → skip NLU, direct FC
  // Saves ~800-1200 tokens per request
  // ============================================
  if (canSkipNLU(inputClass)) {
    console.log(`[AI] Tier 1: Skipping NLU (${inputClass}). Direct to Llama FC.`);

    let result = await executeWithLlama(
      env,
      userText,     // pass original text directly (already clean)
      userText,
      conversationHistory
    );

    result = validateToolCalls(result);

    // Fallback check
    if (result.toolCalls.length === 0 && !result.textResponse) {
      // Classification might have been wrong — fall through to full pipeline
      console.warn(`[AI] Tier 1 produced no output for ${inputClass}. Falling back to full pipeline.`);
      return runFullPipeline(env, userText, conversationHistory);
    }

    console.log(
      `[AI] Pipeline done (Tier 1/${inputClass}): ${result.toolCalls.length} tool calls, text: ${result.textResponse ? "yes" : "no"}`
    );

    return result;
  }

  // ============================================
  // TIER 2: SLANG/EDIT/COMPLEX → full pipeline
  // ============================================
  console.log(`[AI] Tier 2: Full pipeline (${inputClass}). Qwen NLU → Llama FC.`);
  return runFullPipeline(env, userText, conversationHistory);
}

/**
 * Full dual-model pipeline: Qwen NLU → Llama Scout FC
 */
async function runFullPipeline(
  env: Env,
  userText: string,
  conversationHistory: ConversationMessage[]
): Promise<AIResult> {
  // Stage 1: Qwen normalizes Indonesian slang (NO history — current msg only)
  const normalized = await normalizeWithQwen(env, userText);

  // Stage 2: Llama Scout executes function calling (WITH history for edit context)
  let result = await executeWithLlama(
    env,
    normalized,
    userText,
    conversationHistory
  );

  // Stage 3: Validate — prevent runaway arrays, bad amounts
  result = validateToolCalls(result);

  // Fallback: if pipeline produced nothing
  if (result.toolCalls.length === 0 && !result.textResponse) {
    console.warn("[AI] Pipeline produced no output. Sending fallback.");
    result.textResponse =
      'Maaf bos, gue kurang paham. Coba ulangi ya, contoh: <i>makan 25rb, dapet 59rb</i>';
  }

  console.log(
    `[AI] Pipeline done (Tier 2): ${result.toolCalls.length} tool calls, text: ${result.textResponse ? "yes" : "no"}`
  );

  return result;
}

/**
 * Promise timeout wrapper.
 * Rejects with AI_PIPELINE_TIMEOUT if promise doesn't resolve within ms.
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
