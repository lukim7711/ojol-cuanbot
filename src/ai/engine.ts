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

/**
 * Detect if AI response text looks like a financial confirmation
 * without having made any tool calls (hallucination)
 */
export function detectHallucinatedResponse(text: string | null): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Patterns that indicate AI "confirmed" a financial action without tool call
  const confirmPatterns = [
    /tercatat/i,
    /dicatat/i,
    /disimpan/i,
    /sudah\s+(di)?catat/i,
    /berhasil\s+(di)?catat/i,
    /berhasil\s+(di)?simpan/i,
  ];

  const hasConfirmation = confirmPatterns.some((p) => p.test(text));
  if (!hasConfirmation) return false;

  // Also check if it contains financial indicators
  const financialPatterns = [
    /rp\.?\s*[\d.,]+/i,
    /\d+\.?\d*\s*(rb|ribu|k|jt|juta)/i,
    /pemasukan/i,
    /pengeluaran/i,
    /income/i,
    /expense/i,
  ];

  return financialPatterns.some((p) => p.test(text));
}

/**
 * Check if user text likely contains financial data that should trigger tool calls
 */
export function looksLikeFinancialInput(text: string): boolean {
  const lower = text.toLowerCase();

  // Must contain a number or slang number
  const hasNumber =
    /\d/.test(text) ||
    /ceban|goceng|gocap|seceng|sejuta|setengah\s*juta/i.test(text);
  if (!hasNumber) return false;

  // Must contain financial context keyword
  const financialKeywords = [
    /dapet/i, /dapat/i, /orderan/i, /bonus/i, /tip/i,
    /makan/i, /bensin/i, /rokok/i, /parkir/i, /pulsa/i,
    /servis/i, /bayar/i, /beli/i, /isi/i, /jajan/i,
    /ngopi/i, /minum/i, /service/i, /ongkos/i,
    /rb\b/i, /ribu/i, /\bk\b/i, /jt/i, /juta/i,
    /minjem/i, /pinjam/i, /hutang/i, /piutang/i,
    /cicilan/i, /kontrakan/i, /nabung/i,
  ];

  return financialKeywords.some((p) => p.test(text));
}

/**
 * Parse raw AI response into structured AIResult
 */
function parseAIResponse(response: any): AIResult {
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
    console.log(
      `[AI] Found ${rawToolCalls.length} tool_calls via choices[0].message.tool_calls`
    );
  }
  // Fallback Format B (legacy)
  else if (response.tool_calls && Array.isArray(response.tool_calls)) {
    rawToolCalls = response.tool_calls;
    console.log(
      `[AI] Found ${rawToolCalls.length} tool_calls via response.tool_calls`
    );
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

  console.log("[AI] Sending to Qwen3, user text:", userText);

  const response = (await env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8" as any, {
    messages,
    tools: TOOLS as any,
  })) as any;

  console.log("[AI] Raw response keys:", Object.keys(response));

  let result = parseAIResponse(response);

  // ============================================
  // GUARD: Detect hallucinated financial response
  // If AI generated "Tercatat!" text without tool calls,
  // AND user text looks like financial input → RETRY once
  // ============================================
  const isHallucination =
    result.toolCalls.length === 0 &&
    detectHallucinatedResponse(result.textResponse) &&
    looksLikeFinancialInput(userText);

  if (isHallucination) {
    console.warn(
      "[AI] HALLUCINATION DETECTED: AI said 'Tercatat' without tool calls. Retrying..."
    );

    // Retry with stronger instruction prepended to user message
    const retryMessages = [
      { role: "system" as const, content: buildSystemPrompt(currentDate) },
      ...conversationHistory,
      {
        role: "user" as const,
        content: `[INSTRUKSI SISTEM: Pesan berikut MENGANDUNG data keuangan. Kamu WAJIB memanggil tool record_transactions atau tool lain yang sesuai. DILARANG membalas dengan teks saja.]\n\n${userText}`,
      },
    ];

    const retryResponse = (await env.AI.run(
      "@cf/qwen/qwen3-30b-a3b-fp8" as any,
      {
        messages: retryMessages,
        tools: TOOLS as any,
      }
    )) as any;

    console.log("[AI] Retry response keys:", Object.keys(retryResponse));

    const retryResult = parseAIResponse(retryResponse);

    if (retryResult.toolCalls.length > 0) {
      console.log(
        `[AI] Retry successful: got ${retryResult.toolCalls.length} tool calls`
      );
      result = retryResult;
    } else {
      console.warn("[AI] Retry also failed. Using original response.");
      // Nullify the hallucinated text to prevent false "Tercatat!" message
      result.textResponse =
        "⚠️ Maaf, gue gagal nyimpen data lo. Coba kirim ulang ya bos.";
    }
  }

  // Additional guard: if no tool calls AND text looks like financial input
  // but AI just gave casual text (not hallucination), still warn
  if (
    result.toolCalls.length === 0 &&
    !isHallucination &&
    looksLikeFinancialInput(userText) &&
    !result.textResponse?.includes("⚠️")
  ) {
    console.warn(
      "[AI] No tool calls for likely financial input:",
      userText
    );
  }

  if (result.toolCalls.length === 0 && !result.textResponse) {
    console.warn("[AI] No tool_calls and no text response!");
  }

  console.log(
    `[AI] Parsed: ${result.toolCalls.length} tool calls, text: ${result.textResponse ? "yes" : "no"}`
  );

  return result;
}
