/**
 * Rekap Command Handler (Zero-Token Shortcut)
 *
 * Handles /rekap command by directly querying summary service
 * without invoking AI pipeline. Saves ~42 neurons per request.
 */

import { Context } from "grammy";
import { Env } from "../config/env";
import { getOrCreateUser } from "../services/user";
import { getSummary } from "../services/summary";
import { formatReply } from "../utils/formatter";

/**
 * Handle /rekap command — show today's summary
 */
export async function handleRekap(ctx: Context, env: Env): Promise<void> {
  if (!ctx.from) {
    await ctx.reply("⚠️ User ID tidak ditemukan.");
    return;
  }

  try {
    const telegramId = String(ctx.from.id);
    console.log(`[Cmd] /rekap from user ${telegramId}`);

    const user = await getOrCreateUser(env.DB, telegramId, ctx.from.first_name ?? "Driver");
    const result = await getSummary(env.DB, user, { period: "today" });

    // Use formatReply to format the result (matches AI pipeline behavior)
    const response = formatReply([result], null);

    await ctx.reply(response, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[Cmd] /rekap error:", error);
    await ctx.reply(
      "⚠️ Gagal ambil rekap. Coba lagi ya bos."
    );
  }
}
