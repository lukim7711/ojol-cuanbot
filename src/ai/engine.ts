/**
 * AI Engine — Thin Orchestrator
 * Coordinates the dual-model pipeline: Qwen NLU → Llama Scout FC.
 * All heavy logic lives in dedicated modules (nlu, executor, parser, validator).
 */

import { Env } from "../config/env";
import { AIResult, ConversationMessage } from "./parser";
import { isCasualChat, validateToolCalls } from "./validator";
import { normalizeWithQwen, handleCasualChat } from "./nlu";
import { executeWithLlama } from "./executor";

// Re-export types and functions used by other modules
export type { AIResult, ConversationMessage } from "./parser";
export { isCasualChat, validateToolCalls } from "./validator";

/**
 * MAIN ENTRY POINT — Dual Model Pipeline
 */
export async function runAI(
  env: Env,
  userId: number,
  userText: string,
  conversationHistory: ConversationMessage[] = []
): Promise<AIResult> {
  console.log(`[AI] Pipeline start for: "${userText}"`);

  // ============================================
  // FAST PATH: Casual chat → single Qwen call
  // ============================================
  if (isCasualChat(userText)) {
    console.log("[AI] Casual chat detected. Single Qwen call.");
    return await handleCasualChat(env, userText, conversationHistory);
  }

  // ============================================
  // PIPELINE: Qwen NLU → Llama Scout FC
  // ============================================

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
    `[AI] Pipeline done: ${result.toolCalls.length} tool calls, text: ${result.textResponse ? "yes" : "no"}`
  );

  return result;
}
