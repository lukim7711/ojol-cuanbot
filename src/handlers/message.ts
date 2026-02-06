import { Context } from "grammy";
import { Env } from "../config/env";
import { runAI } from "../ai/engine";
import { getOrCreateUser } from "../services/user";
import { processToolCalls } from "../services/router";
import { getRecentConversation, saveConversation } from "../db/repository";
import { formatReply } from "../utils/formatter";

export async function handleMessage(
  ctx: Context,
  env: Env,
  override?: string
) {
  const text = override ?? ctx.message?.text;
  if (!text || !ctx.from) return;

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

    // 7. Kirim reply
    await ctx.reply(reply, { parse_mode: "HTML" });

    // 8. Simpan reply bot
    await saveConversation(env.DB, user.id, "assistant", reply);
  } catch (error) {
    console.error("Handler error:", error);
    await ctx.reply("⚠️ Waduh, ada error nih. Coba lagi ya.");
  }
}
