/**
 * Hutang Command Handler (Zero-Token Shortcut)
 *
 * Handles /hutang command by directly querying debt service
 * without invoking AI pipeline. Saves ~42 neurons per request.
 */

import { Context } from "grammy";
import { Env } from "../config/env";
import { getOrCreateUser } from "../services/user";
import { getDebtsList } from "../services/debt";
import { formatReply } from "../utils/formatter";

/**
 * Handle /hutang command — show all debts and receivables
 */
export async function handleHutang(ctx: Context, env: Env): Promise<void> {
  if (!ctx.from) {
    await ctx.reply("⚠️ User ID tidak ditemukan.");
    return;
  }

  try {
    const telegramId = String(ctx.from.id);
    console.log(`[Cmd] /hutang from user ${telegramId}`);

    const user = await getOrCreateUser(env.DB, telegramId, ctx.from.first_name ?? "Driver");

    // Query all debts (type: "all" returns both hutang and piutang)
    const result = await getDebtsList(env.DB, user, { type: "all" });

    // Use formatReply to format the result (matches AI pipeline behavior)
    const response = formatReply([result], null);

    await ctx.reply(response, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[Cmd] /hutang error:", error);
    await ctx.reply(
      "⚠️ Gagal ambil daftar hutang. Coba lagi ya bos."
    );
  }
}
