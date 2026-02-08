import { Context } from "grammy";
import { Env } from "../config/env";
import { runAI } from "../ai/engine";
import { getOrCreateUser } from "../services/user";
import { processToolCalls } from "../services/router";
import { getRecentConversation, saveConversation } from "../db/repository";
import { formatReply } from "../utils/formatter";

/**
 * In-memory set to track recently processed Telegram message IDs.
 * Prevents duplicate processing when Telegram retries webhook
 * after timeout (Worker processed the message but ctx.reply() timed out).
 *
 * Note: This is per-isolate, not global. But sufficient because
 * Telegram retries hit the same worker within seconds.
 * Max 1000 entries with auto-cleanup to prevent memory leak.
 */
const processedMessages = new Set<string>();
const MAX_PROCESSED_CACHE = 1000;

function getMessageKey(chatId: number | undefined, messageId: number | undefined): string | null {
  if (!chatId || !messageId) return null;
  return `${chatId}:${messageId}`;
}

function cleanupProcessedCache(): void {
  if (processedMessages.size > MAX_PROCESSED_CACHE) {
    // Remove oldest half
    const entries = Array.from(processedMessages);
    const removeCount = Math.floor(entries.length / 2);
    for (let i = 0; i < removeCount; i++) {
      processedMessages.delete(entries[i]);
    }
    console.log(`[Dedup] Cleaned cache: removed ${removeCount}, remaining ${processedMessages.size}`);
  }
}

export async function handleMessage(
  ctx: Context,
  env: Env,
  override?: string
) {
  const text = override ?? ctx.message?.text;
  if (!text || !ctx.from) return;

  // ============================================
  // IDEMPOTENCY GUARD: Skip duplicate webhook calls
  // Telegram retries when our response is slow (>10s)
  // ============================================
  const messageKey = getMessageKey(ctx.chat?.id, ctx.message?.message_id);
  if (messageKey) {
    if (processedMessages.has(messageKey)) {
      console.warn(`[Dedup] Skipping duplicate message: ${messageKey}`);
      return;
    }
    processedMessages.add(messageKey);
    cleanupProcessedCache();
  }

  try {
    const telegramId = String(ctx.from.id);
    const displayName = ctx.from.first_name ?? "Driver";

    // 1. Get or create user
    const user = await getOrCreateUser(env.DB, telegramId, displayName);

    // 2. Ambil 6 chat terakhir sebagai konteks
    const history = await getRecentConversation(env.DB, user.id, 6);
    const conversationHistory = history.map((h: any) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    }));

    // 3. Simpan pesan user
    await saveConversation(env.DB, user.id, "user", text);

    // 4. Kirim ke AI engine
    const aiResult = await runAI(env, user.id, text, conversationHistory);

    // 5. Proses tool calls
    const results = await processToolCalls(
      env.DB,
      user,
      aiResult.toolCalls,
      text
    );

    // 6. Format reply
    const reply = formatReply(results, aiResult.textResponse);

    // 7. Kirim reply (guard: jangan kirim jika kosong)
    if (reply && reply.trim().length > 0) {
      await ctx.reply(reply, { parse_mode: "HTML" });

      // 8. Simpan reply bot
      await saveConversation(env.DB, user.id, "assistant", reply);
    } else {
      console.warn("[Bot] Empty reply, skipping sendMessage");
    }
  } catch (error) {
    console.error("[Bot] Handler error:", error);
    try {
      await ctx.reply("\u26a0\ufe0f Waduh, ada error nih. Coba lagi ya.");
    } catch (_) {
      // Jika bahkan error reply gagal, abaikan
    }
  }
}
