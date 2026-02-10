import { Context } from "grammy";
import { Env } from "../config/env";
import { runAI } from "../ai/engine";
import { getOrCreateUser } from "../services/user";
import { processToolCalls } from "../services/router";
import { getRecentConversation, saveConversation } from "../db/repository";
import { formatReply } from "../utils/formatter";
import { isRateLimited } from "../middleware/rateLimit";
import { sanitizeUserInput, hasInjectionPatterns } from "../middleware/inputGuard";

/**
 * Check if a message was already processed using KV.
 * Prevents duplicate processing when Telegram retries webhook
 * after timeout (Worker processed but ctx.reply() timed out).
 *
 * KV key format: dedup:{chatId}:{messageId}
 * KV TTL: 300 seconds (5 minutes) — auto-cleanup by Cloudflare
 */
const DEDUP_TTL_SECONDS = 300;

async function isDuplicate(
  kv: KVNamespace,
  chatId: number | undefined,
  messageId: number | undefined
): Promise<boolean> {
  if (!chatId || !messageId) return false;

  const key = `dedup:${chatId}:${messageId}`;

  try {
    const existing = await kv.get(key);
    if (existing) return true;

    // Mark as processed with TTL
    await kv.put(key, "1", { expirationTtl: DEDUP_TTL_SECONDS });
    return false;
  } catch (error) {
    // If KV fails, allow the request (fail-open)
    console.error("[Dedup] KV error, failing open:", error);
    return false;
  }
}

/**
 * Build a tool context string to save in conversation history.
 * This helps the AI understand what tools were used previously,
 * so "yang terakhir salah" references the correct tool.
 */
function buildToolContext(toolCalls: Array<{ name: string; arguments: any }>): string {
  if (toolCalls.length === 0) return "";

  const parts = toolCalls.map((tc) => {
    const argSummary = Object.entries(tc.arguments)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    return `${tc.name}(${argSummary})`;
  });

  return `[tools_used: ${parts.join("; ")}]\n`;
}

export async function handleMessage(
  ctx: Context,
  env: Env,
  override?: string
) {
  const text = override ?? ctx.message?.text;
  if (!text || !ctx.from) return;

  // ============================================
  // IDEMPOTENCY GUARD (KV-based)
  // ============================================
  const duplicate = await isDuplicate(
    env.RATE_LIMIT,
    ctx.chat?.id,
    ctx.message?.message_id
  );
  if (duplicate) {
    console.warn(`[Dedup] Skipping duplicate message: ${ctx.chat?.id}:${ctx.message?.message_id}`);
    return;
  }

  // ============================================
  // RATE LIMIT CHECK (KV-based)
  // ============================================
  const telegramId = String(ctx.from.id);
  if (await isRateLimited(env.RATE_LIMIT, telegramId)) {
    try {
      await ctx.reply("⏳ Sabar bos, kebanyakan pesan nih. Tunggu bentar ya.");
    } catch (_) {}
    return;
  }

  // ============================================
  // INPUT GUARD — Prompt injection filter + length limit
  // ============================================
  if (hasInjectionPatterns(text)) {
    console.warn(`[Security] Prompt injection patterns detected from user ${telegramId}`);
  }

  const cleanedText = sanitizeUserInput(text);
  if (!cleanedText) {
    console.warn(`[Security] Input empty after sanitization from user ${telegramId}`);
    try {
      await ctx.reply("🤔 Pesan lo kosong atau nggak valid. Coba ketik ulang ya.");
    } catch (_) {}
    return;
  }

  try {
    const displayName = ctx.from.first_name ?? "Driver";

    // 1. Get or create user
    const user = await getOrCreateUser(env.DB, telegramId, displayName);

    // 2. Get recent conversation (3 messages) for context
    const history = await getRecentConversation(env.DB, user.id, 3);
    const conversationHistory = history.map((h: any) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    }));

    // 3. Save user message (save original, not cleaned — for audit trail)
    await saveConversation(env.DB, user.id, "user", text);

    // 4. Run AI engine (use CLEANED text — stripped of injection patterns)
    const aiResult = await runAI(env, user.id, cleanedText, conversationHistory);

    // 5. Process tool calls (pass KV for delete confirmation)
    const results = await processToolCalls(
      env.DB,
      user,
      aiResult.toolCalls,
      cleanedText,
      env.RATE_LIMIT
    );

    // 6. Format reply
    const reply = formatReply(results, aiResult.textResponse);

    // 7. Send reply
    if (reply && reply.trim().length > 0) {
      await ctx.reply(reply, { parse_mode: "HTML" });

      // 8. Save bot reply WITH tool context
      const toolContext = buildToolContext(aiResult.toolCalls);
      await saveConversation(env.DB, user.id, "assistant", `${toolContext}${reply}`);
    } else {
      console.warn("[Bot] Empty reply, skipping sendMessage");
    }
  } catch (error) {
    console.error("[Bot] Handler error:", error);
    try {
      await ctx.reply("⚠️ Waduh, ada error nih. Coba lagi ya.");
    } catch (_) {
      // If even error reply fails, ignore
    }
  }
}
