import { Env } from "../config/env";
import { TOOLS } from "./tools";
import { buildSystemPrompt } from "./prompt";

export interface AIResult {
  toolCalls: Array<{
    name: string;
    arguments: any;
  }>;
  textResponse: string | null;
}

interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Strip <think>...</think> tags yang ditambahkan Qwen3 thinking mode
 */
function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Parse arguments dari tool call — bisa string (JSON) atau object
 */
function parseToolArguments(args: any): any {
  if (typeof args === "object" && args !== null) {
    return args;
  }

  if (typeof args === "string") {
    let cleaned = stripThinkingTags(args);
    if (!cleaned) return {};

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (_) {}
      }
      console.error("[AI] Failed to parse tool arguments:", cleaned);
      return {};
    }
  }

  return {};
}

/**
 * Get current date in WIB (UTC+7) — properly calculated
 */
function getWIBDateString(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const wib = new Date(utcMs + 7 * 60 * 60 * 1000);
  const year = wib.getFullYear();
  const month = String(wib.getMonth() + 1).padStart(2, "0");
  const day = String(wib.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function runAI(
  env: Env,
  userId: number,
  userText: string,
  conversationHistory: ConversationMessage[] = []
): Promise<AIResult> {
  const currentDate = getWIBDateString();

  const messages = [
    { role: "system" as const, content: buildSystemPrompt(currentDate) },
    ...conversationHistory,
    { role: "user" as const, content: userText },
  ];

  console.log("[AI] Sending to Qwen3, user text:", userText);

  const response = (await env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8" as any, {
    messages,
    tools: TOOLS as any,
  })) as any;

  console.log("[AI] Raw response keys:", Object.keys(response));

  const toolCalls: AIResult["toolCalls"] = [];
  let textResponse: string | null = null;

  // ============================================
  // 1. Extract tool_calls dari berbagai format
  // ============================================
  let rawToolCalls: any[] = [];

  // Coba Format A dulu (OpenAI-compatible)
  const choiceMessage = response.choices?.[0]?.message;
  if (choiceMessage?.tool_calls && Array.isArray(choiceMessage.tool_calls)) {
    rawToolCalls = choiceMessage.tool_calls;
    console.log(`[AI] Found ${rawToolCalls.length} tool_calls via choices[0].message.tool_calls`);
  }
  // Fallback Format B (legacy)
  else if (response.tool_calls && Array.isArray(response.tool_calls)) {
    rawToolCalls = response.tool_calls;
    console.log(`[AI] Found ${rawToolCalls.length} tool_calls via response.tool_calls`);
  }

  // Parse setiap tool call
  for (const tc of rawToolCalls) {
    const name = tc.function?.name ?? tc.name;
    const rawArgs = tc.function?.arguments ?? tc.arguments;

    if (!name) {
      console.warn("[AI] Tool call without name:", JSON.stringify(tc));
      continue;
    }

    const parsedArgs = parseToolArguments(rawArgs);
    console.log(`[AI] Tool call: ${name}`, JSON.stringify(parsedArgs));

    toolCalls.push({ name, arguments: parsedArgs });
  }

  // ============================================
  // 2. Extract text response
  // ============================================
  let rawText = choiceMessage?.content
    ?? response.response
    ?? response.content
    ?? null;

  if (rawText && typeof rawText === "string") {
    textResponse = stripThinkingTags(rawText) || null;
  }

  if (toolCalls.length === 0 && !textResponse) {
    console.warn("[AI] No tool_calls and no text response!");
  }

  console.log(`[AI] Parsed: ${toolCalls.length} tool calls, text: ${textResponse ? 'yes' : 'no'}`);

  return { toolCalls, textResponse };
}
