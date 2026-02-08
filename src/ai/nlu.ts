/**
 * NLU Stage — Qwen Model
 * Stage 1: Normalize Indonesian slang → formal text with explicit numbers.
 * Stage 0 (fast path): Handle casual chat with single Qwen call.
 */

import { Env } from "../config/env";
import { buildNLUPrompt } from "./prompt";
import { AIResult, ConversationMessage, stripThinkingTags } from "./parser";
import { getWIBDateString } from "./utils";

const QWEN_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

/**
 * Stage 1: Qwen NLU — normalize slang to formal Indonesian
 * NO conversation history — only normalize current message
 */
export async function normalizeWithQwen(
  env: Env,
  userText: string
): Promise<string> {
  const currentDate = getWIBDateString();

  const messages = [
    { role: "system" as const, content: buildNLUPrompt(currentDate) },
    { role: "user" as const, content: userText },
  ];

  console.log(`[NLU] Sending to Qwen: "${userText}"`);

  const response = (await env.AI.run(QWEN_MODEL as any, {
    messages,
  })) as any;

  let normalized =
    response.choices?.[0]?.message?.content ??
    response.response ??
    response.content ??
    userText;

  if (typeof normalized === "string") {
    normalized = stripThinkingTags(normalized);
  }

  if (!normalized || normalized.length < 2) {
    console.warn("[NLU] Empty response from Qwen. Using original text.");
    normalized = userText;
  }

  console.log(`[NLU] Normalized: "${userText}" → "${normalized}"`);
  return normalized;
}

/**
 * Stage 0 (fast path): Casual chat handler — single Qwen call, no pipeline
 */
export async function handleCasualChat(
  env: Env,
  userText: string,
  conversationHistory: ConversationMessage[]
): Promise<AIResult> {
  const messages = [
    {
      role: "system" as const,
      content:
        'Kamu CuanBot, asisten keuangan driver ojol. Bahasa santai/gaul Jakarta. Panggil user "bos". Balas singkat dan friendly.',
    },
    ...conversationHistory,
    { role: "user" as const, content: userText },
  ];

  const response = (await env.AI.run(QWEN_MODEL as any, {
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
