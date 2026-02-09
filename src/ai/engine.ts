/**
 * AI Engine — Thin Orchestrator
 * Single model pipeline: Llama Scout handles everything.
 * No more Qwen NLU stage — slang conversion is in-context via system prompt.
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
        textResponse: "\u23f3 Wah lama banget nih prosesnya. Coba kirim ulang ya bos.",
      };
    }

    console.error("[AI] Pipeline error:", error);
    return {
      toolCalls: [],
      textResponse: "\u26a0\ufe0f Maaf bos, otak gue lagi error. Coba lagi ya.",
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
