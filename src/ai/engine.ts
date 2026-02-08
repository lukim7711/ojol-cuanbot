import { Env } from "../config/env";
import { TOOLS } from "./tools";
import { buildNLUPrompt, buildExecutorPrompt } from "./prompt";

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

// Dual model constants
const QWEN_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"; // NLU: understands Indonesian slang
const LLAMA_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct"; // FC: reliable function calling (MoE 17B, 16 experts)

/**
 * Strip <think>...</think> tags from Qwen's thinking mode
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
 * Deep-parse any stringified JSON values in tool arguments.
 * Llama sometimes returns {transactions: "[{...}]"} instead of {transactions: [{...}]}
 */
function deepParseArguments(args: any): any {
  if (typeof args !== "object" || args === null) return args;

  const result: any = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      // Try to parse string values that look like JSON arrays or objects
      const trimmed = (value as string).trim();
      if (
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith("{") && trimmed.endsWith("}"))
      ) {
        try {
          result[key] = JSON.parse(trimmed);
          console.log(
            `[AI] Deep-parsed string field "${key}": string → ${Array.isArray(result[key]) ? "array" : "object"}`
          );
          continue;
        } catch (_) {
          // Not valid JSON, keep as string
        }
      }
    }
    result[key] = value;
  }
  return result;
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

    // Parse top-level arguments (string → object)
    let parsedArgs = parseToolArguments(rawArgs);
    // Deep-parse nested string fields (e.g. transactions: "[{...}]" → [{...}])
    parsedArgs = deepParseArguments(parsedArgs);

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

/**
 * Validate and sanitize tool calls — defense against runaway arrays
 */
export function validateToolCalls(result: AIResult): AIResult {
  const MAX_TRANSACTIONS = 10;
  const MIN_AMOUNT = 1;
  const MAX_AMOUNT = 100_000_000; // 100 juta

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
      tc.arguments.amount
    ) {
      const amount = Number(tc.arguments.amount);
      if (isNaN(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
        console.warn(
          `[Validate] Invalid debt amount: ${tc.arguments.amount}. Clamping.`
        );
        tc.arguments.amount = Math.max(
          MIN_AMOUNT,
          Math.min(MAX_AMOUNT, amount || 0)
        );
      }
    }
  }

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

// ============================================================
// STAGE 1: Qwen NLU — normalize slang to formal Indonesian
// NO conversation history — only normalize current message
// ============================================================
async function normalizeWithQwen(
  env: Env,
  userText: string
): Promise<string> {
  const currentDate = getWIBDateString();

  // NLU gets NO conversation history — prevents re-translating old messages
  const messages = [
    { role: "system" as const, content: buildNLUPrompt(currentDate) },
    { role: "user" as const, content: userText },
  ];

  console.log(`[NLU] Sending to Qwen: "${userText}"`);

  const response = (await env.AI.run(QWEN_MODEL as any, {
    messages,
    // NO tools — pure text generation for normalization
  })) as any;

  let normalized =
    response.choices?.[0]?.message?.content ??
    response.response ??
    response.content ??
    userText;

  if (typeof normalized === "string") {
    normalized = stripThinkingTags(normalized);
  }

  // Fallback: if Qwen returns empty/garbage, use original
  if (!normalized || normalized.length < 2) {
    console.warn("[NLU] Empty response from Qwen. Using original text.");
    normalized = userText;
  }

  console.log(`[NLU] Normalized: "${userText}" → "${normalized}"`);
  return normalized;
}

// ============================================================
// STAGE 2: Llama Executor — reliable function calling
// Gets conversation history for edit/context awareness
// ============================================================
async function executeWithLlama(
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

  console.log(`[FC] Sending to Llama: "${normalizedText}"`);

  // First attempt with tool_choice: "auto"
  const response = (await env.AI.run(LLAMA_MODEL as any, {
    messages,
    tools: TOOLS as any,
    tool_choice: "auto",
  })) as any;

  console.log("[FC] Response keys:", Object.keys(response));

  let result = parseAIResponse(response);

  // Retry with "required" if 0 tool calls on non-casual input
  if (result.toolCalls.length === 0) {
    console.warn(
      `[FC] 0 tool calls. Retrying with tool_choice=required...`
    );

    const retryMessages = [
      { role: "system" as const, content: buildExecutorPrompt(currentDate) },
      ...conversationHistory,
      {
        role: "user" as const,
        content: `[INSTRUKSI: Kamu WAJIB memanggil tool. Pesan asli: "${originalText}"]\n\n${normalizedText}`,
      },
    ];

    const retryResponse = (await env.AI.run(LLAMA_MODEL as any, {
      messages: retryMessages,
      tools: TOOLS as any,
      tool_choice: "required",
    })) as any;

    const retryResult = parseAIResponse(retryResponse);
    if (retryResult.toolCalls.length > 0) {
      console.log(
        `[FC] Retry successful: ${retryResult.toolCalls.length} tool calls`
      );
      result = retryResult;
    } else {
      console.warn("[FC] Retry also returned 0 tool calls.");
    }
  }

  return result;
}

// ============================================================
// Casual chat handler — single Qwen call, no pipeline
// ============================================================
async function handleCasualChat(
  env: Env,
  userText: string,
  conversationHistory: ConversationMessage[]
): Promise<AIResult> {
  const messages = [
    {
      role: "system" as const,
      content:
        "Kamu CuanBot, asisten keuangan driver ojol. Bahasa santai/gaul Jakarta. Panggil user \"bos\". Balas singkat dan friendly.",
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

// ============================================================
// MAIN ENTRY POINT — Dual Model Pipeline
// ============================================================
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
  // PIPELINE: Qwen NLU → Llama FC
  // ============================================

  // Stage 1: Qwen normalizes Indonesian slang (NO history — current msg only)
  const normalized = await normalizeWithQwen(env, userText);

  // Stage 2: Llama executes function calling (WITH history for edit context)
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
      "Maaf bos, gue kurang paham. Coba ulangi ya, contoh: <i>makan 25rb, dapet 59rb</i>";
  }

  console.log(
    `[AI] Pipeline done: ${result.toolCalls.length} tool calls, text: ${result.textResponse ? "yes" : "no"}`
  );

  return result;
}
