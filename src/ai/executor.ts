/**
 * Executor Stage — Llama Scout Model
 * Stage 2: Reliable function calling based on normalized input.
 * Uses tool_choice "required" — all messages here MUST produce a tool call.
 */

import { Env } from "../config/env";
import { TOOLS } from "./tools";
import { buildExecutorPrompt } from "./prompt";
import { AIResult, ConversationMessage, parseAIResponse } from "./parser";
import { getWIBDateString } from "./utils";

const LLAMA_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

/**
 * Stage 2: Llama Scout Executor — reliable function calling
 * Uses tool_choice "required" directly because:
 * 1. Casual chat is already filtered before reaching this stage
 * 2. Scout 17B ignores "auto" ~90% of the time (wastes a retry)
 * 3. Every message here MUST produce a tool call
 */
export async function executeWithLlama(
  env: Env,
  normalizedText: string,
  originalText: string,
  conversationHistory: ConversationMessage[]
): Promise<AIResult> {
  const currentDate = getWIBDateString();

  const messages = [
    { role: "system" as const, content: buildExecutorPrompt(currentDate) },
    ...conversationHistory,
    {
      role: "user" as const,
      content: `[Pesan asli: "${originalText}"]\n\n${normalizedText}`,
    },
  ];

  console.log(`[FC] Sending to Llama Scout: "${normalizedText}"`);

  const response = (await env.AI.run(LLAMA_MODEL as any, {
    messages,
    tools: TOOLS as any,
    tool_choice: "required",
  })) as any;

  console.log("[FC] Response keys:", Object.keys(response));

  const result = parseAIResponse(response);

  if (result.toolCalls.length === 0) {
    console.warn("[FC] 0 tool calls even with tool_choice=required.");
  } else {
    console.log(
      `[FC] Success: ${result.toolCalls.length} tool call(s) on first attempt`
    );
  }

  return result;
}
