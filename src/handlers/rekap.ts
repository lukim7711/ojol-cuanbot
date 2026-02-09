/**
 * Rekap Command Handler (Zero-Token Shortcut)
 *
 * Handles /rekap command by directly querying summary service
 * without invoking AI pipeline. Saves ~42 neurons per request.
 */

import { Context } from "grammy";
import { Env } from "../config/env";
import { createRepository } from "../db/repository";
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

    const repo = createRepository(env.DB);
    const summary = await getSummary(repo, userId, "today");

    const response = formatSummary(summary, "today");

    await ctx.reply(response, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[Cmd] /rekap error:", error);
    await ctx.reply(
      "⚠️ Gagal ambil rekap. Coba lagi ya bos."
    );
  }
}
