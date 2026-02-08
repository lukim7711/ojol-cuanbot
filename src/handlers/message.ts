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
 */
const processedMessages = new Set<string>();
const MAX_PROCESSED_CACHE = 1000;

function getMessageKey(chatId: number | undefined, messageId: number | undefined): string | null {
  if (!chatId || !messageId) return null;
  return `${chatId}:${messageId}`;
}

function cleanupProcessedCache(): void {
  if (processedMessages.size > MAX_PROCESSED_CACHE) {
    const entries = Array.from(processedMessages);
    const removeCount = Math.floor(entries.length / 2);
    for (let i = 0; i < removeCount; i++) {
      processedMessages.delete(entries[i]);
    }
    console.log(`[Dedup] Cleaned cache: removed ${removeCount}, remaining ${processedMessages.size}`);
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
  // IDEMPOTENCY GUARD
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

    // 2. Get recent conversation (3 messages) for context
    //    3 turns is sufficient — edits reference 1-2 messages back max.
    //    Reduced from 6 to save ~200 tokens per request.
    const history = await getRecentConversation(env.DB, user.id, 3);
    const conversationHistory = history.map((h: any) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    }));

    // 3. Save user message
    await saveConversation(env.DB, user.id, "user", text);

    // 4. Run AI engine
    const aiResult = await runAI(env, user.id, text, conversationHistory);

    // 5. Process tool calls
    const results = await processToolCalls(
      env.DB,
      user,
      aiResult.toolCalls,
      text
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
