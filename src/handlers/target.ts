/**
 * Target Command Handler (Zero-Token Shortcut)
 *
 * Handles /target command by directly querying target service
 * without invoking AI pipeline. Saves ~42 neurons per request.
 */

import { Context } from "grammy";
import { Env } from "../config/env";
import { getOrCreateUser } from "../services/user";
import { getDailyTarget } from "../services/target";
import { formatReply } from "../utils/formatter";

/**
 * Handle /target command — show today's financial target
 */
export async function handleTarget(ctx: Context, env: Env): Promise<void> {
  if (!ctx.from) {
    await ctx.reply("⚠️ User ID tidak ditemukan.");
    return;
  }

  try {
    const telegramId = String(ctx.from.id);
    console.log(`[Cmd] /target from user ${telegramId}`);

    const user = await getOrCreateUser(env.DB, telegramId, ctx.from.first_name ?? "Driver");
    const result = await getDailyTarget(env.DB, user, {});

    // Use formatReply to format the result (matches AI pipeline behavior)
    const response = formatReply([result], null);

    await ctx.reply(response, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[Cmd] /target error:", error);
    await ctx.reply(
      "⚠️ Gagal ambil target. Coba lagi ya bos."
    );
  }
}
