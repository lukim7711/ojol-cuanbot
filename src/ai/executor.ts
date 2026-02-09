/**
 * Executor — Llama Scout Model (Single Model)
 * Handles BOTH slang conversion AND function calling in one call.
 * Also handles casual chat in non-tool mode.
 */

import { Env } from "../config/env";
import { TOOLS } from "./tools";
import { buildUnifiedPrompt, buildCasualChatPrompt } from "./prompt";
import { AIResult, ConversationMessage, parseAIResponse, stripThinkingTags } from "./parser";
import { getWIBDateString } from "./utils";

const LLAMA_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

/**
 * Execute function calling with Llama Scout.
 * Input is RAW user text (slang included) — slang table in system prompt handles conversion.
 *
 * @param enhanced - If true, adds explicit conversion hint for retry attempts
 */
export async function executeWithLlama(
  env: Env,
  normalizedText: string,
  originalText: string,
  conversationHistory: ConversationMessage[],
  enhanced: boolean = false
): Promise<AIResult> {
  const currentDate = getWIBDateString();

  const userContent = enhanced
    ? `PENTING: Konversi slang uang dulu (rb=×1000, goceng=5000, gocap=50000, ceban=10000, seceng=1000, jt=×1000000), lalu panggil tool yang sesuai.\n\n"${originalText}"`
    : originalText;

  const messages = [
    { role: "system" as const, content: buildUnifiedPrompt(currentDate) },
    ...conversationHistory,
    { role: "user" as const, content: userContent },
  ];

  console.log(`[FC] Sending to Llama Scout: "${originalText}"${enhanced ? " (enhanced retry)" : ""}`);

  const response = (await env.AI.run(LLAMA_MODEL as any, {
    messages,
    tools: TOOLS as any,
    tool_choice: "required",
  })) as any;

  console.log("[FC] Response keys:", Object.keys(response));

  const result = parseAIResponse(response);

  if (result.toolCalls.length === 0) {
    console.warn(`[FC] 0 tool calls${enhanced ? " even on retry" : ""}. tool_choice=required.`);
  } else {
    console.log(
      `[FC] Success: ${result.toolCalls.length} tool call(s)${enhanced ? " on retry" : " on first attempt"}`
    );
  }

  return result;
}

/**
 * Chat mode with Llama Scout — for casual/non-financial messages.
 * No tools, just conversational response.
 */
export async function chatWithLlama(
  env: Env,
  userText: string,
  conversationHistory: ConversationMessage[]
): Promise<AIResult> {
  const messages = [
    { role: "system" as const, content: buildCasualChatPrompt() },
    ...conversationHistory,
    { role: "user" as const, content: userText },
  ];

  console.log(`[Chat] Sending to Llama Scout: "${userText}"`);

  const response = (await env.AI.run(LLAMA_MODEL as any, {
    messages,
  })) as any;

  let text =
    response.choices?.[0]?.message?.content ??
    response.response ??
    response.content ??
    "Halo bos! Ada yang bisa gue bantu? \ud83d\ude0e";

  if (typeof text === "string") {
    text = stripThinkingTags(text);
  }

  return { toolCalls: [], textResponse: text || "Halo bos! \ud83d\ude0e" };
}
