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
import { formatSummary } from "../utils/formatter";

/**
 * Handle /rekap command — show today's summary
 */
export async function handleRekap(ctx: Context, env: Env): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply("⚠️ User ID tidak ditemukan.");
    return;
  }

  try {
    console.log(`[Cmd] /rekap from user ${userId}`);

    // Get user object
    const user = await getOrCreateUser(env.DB, userId, ctx.from?.first_name);

    // Call service with correct signature
    const result = await getSummary(env.DB, user, { period: "today" });

    // Format response
    const response = formatSummary(result.data, "today");

    await ctx.reply(response, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[Cmd] /rekap error:", error);
    await ctx.reply(
      "⚠️ Gagal ambil rekap. Coba lagi ya bos."
    );
  }
}
