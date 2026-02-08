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

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// Model constant — single place to change
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Strip <think>...</think> tags (safety — Llama doesn't use them,
 * but kept for compatibility if model is swapped back)
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
 * Get current date in WIB (UTC+7)
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

/**
 * Detect truly casual messages that should NOT have tool calls.
 * Intentionally NARROW — when in doubt, let the AI decide.
 * This is NOT a regex financial detector — it only excludes greetings/thanks.
 *
 * Word limit: <=4 words. All genuine casual greetings are <=3 words.
 * Anything longer likely contains financial context mixed in.
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

  // Only match short messages (<=4 words) that are clearly casual
  if (lower.split(/\s+/).length > 4) return false;

  return casualPatterns.some((p) => p.test(lower));
}

/**
 * Parse raw AI response into structured AIResult
 */
function parseAIResponse(response: any): AIResult {
  const toolCalls: AIResult["toolCalls"] = [];
  let textResponse: string | null = null;

  let rawToolCalls: any[] = [];

  // Format A: OpenAI-compatible (choices[0].message.tool_calls)
  const choiceMessage = response.choices?.[0]?.message;
  if (choiceMessage?.tool_calls && Array.isArray(choiceMessage.tool_calls)) {
    rawToolCalls = choiceMessage.tool_calls;
    console.log(
      `[AI] Found ${rawToolCalls.length} tool_calls via choices[0].message.tool_calls`
    );
  }
  // Format B: Legacy Workers AI
  else if (response.tool_calls && Array.isArray(response.tool_calls)) {
    rawToolCalls = response.tool_calls;
    console.log(
      `[AI] Found ${rawToolCalls.length} tool_calls via response.tool_calls`
    );
  }

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

  let rawText =
    choiceMessage?.content ?? response.response ?? response.content ?? null;

  if (rawText && typeof rawText === "string") {
    textResponse = stripThinkingTags(rawText) || null;
  }

  return { toolCalls, textResponse };
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

  console.log(`[AI] Sending to ${AI_MODEL}, user text:`, userText);

  // ============================================
  // STEP 1: Determine tool_choice strategy
  // ============================================
  const casual = isCasualChat(userText);
  const toolChoice = casual ? "auto" : "auto";
  // Note: We use "auto" for both, but on retry we escalate to "required"
  // This lets the AI naturally handle casual chat vs financial input

  console.log(`[AI] Strategy: casual=${casual}, tool_choice=${toolChoice}`);

  // ============================================
  // STEP 2: First AI call
  // ============================================
  const response = (await env.AI.run(AI_MODEL as any, {
    messages,
    tools: TOOLS as any,
    tool_choice: toolChoice,
  })) as any;

  console.log("[AI] Raw response keys:", Object.keys(response));

  let result = parseAIResponse(response);

  // ============================================
  // STEP 3: Smart retry with tool_choice: "required"
  // Only if: not casual + AI returned 0 tool calls
  // No regex — purely based on AI's own behavior
  // ============================================
  if (result.toolCalls.length === 0 && !casual) {
    console.warn(
      `[AI] 0 tool calls for non-casual input: "${userText}". Retrying with tool_choice=required...`
    );

    const retryMessages = [
      { role: "system" as const, content: buildSystemPrompt(currentDate) },
      ...conversationHistory,
      {
        role: "user" as const,
        content: `[SYSTEM: Kamu WAJIB memanggil salah satu tool/function yang tersedia untuk memproses pesan ini. Analisis pesan berikut dan panggil tool yang paling sesuai.]\n\n${userText}`,
      },
    ];

    const retryResponse = (await env.AI.run(AI_MODEL as any, {
      messages: retryMessages,
      tools: TOOLS as any,
      tool_choice: "required",
    })) as any;

    console.log("[AI] Retry response keys:", Object.keys(retryResponse));

    const retryResult = parseAIResponse(retryResponse);

    if (retryResult.toolCalls.length > 0) {
      console.log(
        `[AI] Retry successful: got ${retryResult.toolCalls.length} tool calls`
      );
      result = retryResult;
    } else {
      console.warn("[AI] Retry also returned 0 tool calls. Keeping original.");
      // If AI truly can't figure out a tool, keep original text response
      // This handles edge cases where user sends something ambiguous
    }
  }

  if (result.toolCalls.length === 0 && !result.textResponse) {
    console.warn("[AI] No tool_calls and no text response!");
    result.textResponse = "Maaf bos, gue kurang paham. Coba ulangi ya.";
  }

  console.log(
    `[AI] Parsed: ${result.toolCalls.length} tool calls, text: ${result.textResponse ? "yes" : "no"}`
  );

  return result;
}
