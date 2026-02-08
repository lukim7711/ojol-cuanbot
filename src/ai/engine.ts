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
 * without having made any tool calls (hallucination).
 * Covers: transactions, debt recording, debt payments, edits, deletes.
 */
export function detectHallucinatedResponse(text: string | null): boolean {
  if (!text) return false;

  // Patterns that indicate AI "confirmed" a financial action without tool call
  const confirmPatterns = [
    /tercatat/i,
    /dicatat/i,
    /disimpan/i,
    /sudah\s+(di)?catat/i,
    /berhasil\s+(di)?catat/i,
    /berhasil\s+(di)?simpan/i,
    /berhasil\s+(di)?bayar/i,
    /lunas/i,
    /hutang.*lunas/i,
    /sisa\s*(hutang)?\s*:?\s*rp/i,
    /bayar.*hutang.*rp/i,
    /pembayaran.*berhasil/i,
    // NEW: Edit/delete/cancel hallucination patterns
    /dihapus/i,
    /diubah/i,
    /dibatalkan/i,
    /diedit/i,
    /sudah\s+(di)?hapus/i,
    /sudah\s+(di)?ubah/i,
    /sudah\s+(di)?batalkan/i,
    /berhasil\s+(di)?hapus/i,
    /berhasil\s+(di)?ubah/i,
    /berhasil\s+(di)?edit/i,
    /berhasil\s+(di)?batalkan/i,
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
    /hutang/i,
    /piutang/i,
    /sisa/i,
    // NEW: Edit/delete context indicators — even without Rp amount
    /transaksi/i,
    /kewajiban/i,
    /goal/i,
    /cicilan/i,
  ];

  return financialPatterns.some((p) => p.test(text));
}

/**
 * Check if user text likely contains financial data that should trigger tool calls.
 * Must have a number + financial context keyword.
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
    /salah/i, /harusnya/i, /ubah/i, /ganti/i, /edit/i,
    /hapus/i, /delete/i, /batal/i,
    /minus/i, /rugi/i, /untung/i,
  ];

  return financialKeywords.some((p) => p.test(text));
}

/**
 * Check if user text is a query/command that should trigger tool calls
 * but does NOT contain numbers (e.g. "daftar piutang", "riwayat hutang Budi").
 */
export function looksLikeActionQuery(text: string): boolean {
  const actionPatterns = [
    // Debt queries
    /daftar\s+(hutang|piutang|semua)/i,
    /list\s+(hutang|piutang)/i,
    /cek\s+(hutang|piutang)/i,
    /lihat\s+(hutang|piutang)/i,
    /riwayat\s+(pembayaran\s+)?(hutang|piutang)/i,
    /\/(hutang|piutang)/i,
    // Target queries
    /target\s+(hari\s+ini|gue|saya|lo)/i,
    /berapa\s+target/i,
    // Rekap
    /rekap/i,
    /\/(rekap|summary)/i,
    // Edit/delete without numbers
    /hapus\s+(hutang|piutang|yang|transaksi|kewajiban|goal)/i,
    /batal(kan)?\s+(goal|hutang|piutang|cicilan|kewajiban)/i,
    /hapus\s+cicilan/i,
    /done\s+cicilan/i,
    /kewajiban.*selesai/i,
    /selesai.*kewajiban/i,
  ];

  return actionPatterns.some((p) => p.test(text));
}

/**
 * Determine if user input should have triggered a tool call.
 * Combines financial input detection AND action query detection.
 */
export function shouldHaveToolCall(text: string): boolean {
  return looksLikeFinancialInput(text) || looksLikeActionQuery(text);
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
  // LAYER 3: Detect hallucinated financial response
  // AI generated confirmation text without tool calls
  // ============================================
  const isHallucination =
    result.toolCalls.length === 0 &&
    detectHallucinatedResponse(result.textResponse);

  // ============================================
  // LAYER 4: No tool calls but input SHOULD have triggered one
  // Covers: financial input, debt queries, target queries, edit commands
  // ============================================
  const shouldRetry =
    result.toolCalls.length === 0 &&
    !isHallucination &&
    shouldHaveToolCall(userText);

  if (isHallucination || shouldRetry) {
    const reason = isHallucination ? "HALLUCINATION" : "MISSING_TOOL_CALL";
    console.warn(
      `[AI] ${reason} DETECTED for: "${userText}". Retrying...`
    );

    // Build retry instruction based on type
    const retryInstruction = isHallucination
      ? `[INSTRUKSI SISTEM: Pesan berikut MENGANDUNG data keuangan. Kamu WAJIB memanggil tool yang sesuai (record_transactions, record_debt, pay_debt, edit_transaction, edit_debt, edit_obligation, edit_goal, dll). DILARANG membalas dengan teks saja. Jika user minta hapus/ubah/batalkan, panggil tool edit yang sesuai.]`
      : `[INSTRUKSI SISTEM: Pesan berikut MEMBUTUHKAN tool call. Analisis ulang dan panggil tool yang sesuai. Jika ada angka + konteks keuangan → record_transactions/record_debt/pay_debt. Jika query hutang/piutang → get_debts/get_debt_history. Jika query target → get_daily_target. Jika edit/hapus → edit_transaction/edit_debt. Jika kewajiban selesai/hapus → edit_obligation. Jika goal batal → edit_goal. DILARANG membalas dengan teks saja.]`;

    const retryMessages = [
      { role: "system" as const, content: buildSystemPrompt(currentDate) },
      ...conversationHistory,
      {
        role: "user" as const,
        content: `${retryInstruction}\n\n${userText}`,
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
      console.warn(`[AI] Retry also failed (${reason}). Using original response.`);
      if (isHallucination) {
        // Nullify the hallucinated text to prevent false confirmation
        result.textResponse =
          "⚠️ Maaf, gue gagal proses data lo. Coba kirim ulang ya bos.";
      }
      // For shouldRetry (non-hallucination), keep original text response
      // as it might be a legitimate clarification from AI
    }
  }

  if (result.toolCalls.length === 0 && !result.textResponse) {
    console.warn("[AI] No tool_calls and no text response!");
  }

  console.log(
    `[AI] Parsed: ${result.toolCalls.length} tool calls, text: ${result.textResponse ? "yes" : "no"}`
  );

  return result;
}
