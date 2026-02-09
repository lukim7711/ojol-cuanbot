/**
 * Target Command Handler (Zero-Token Shortcut)
 *
 * Handles /target command by directly querying target service
 * without invoking AI pipeline. Saves ~42 neurons per request.
 */

import { Context } from "grammy";
import { Env } from "../config/env";
import { createRepository } from "../db/repository";
import { getDailyTarget } from "../services/target";
import { formatDailyTarget } from "../utils/formatter";

/**
 * Handle /target command — show today's financial target
 */
export async function handleTarget(ctx: Context, env: Env): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply("⚠️ User ID tidak ditemukan.");
    return;
  }

  try {
    console.log(`[Cmd] /target from user ${userId}`);

    const repo = createRepository(env.DB);
    const targetData = await getDailyTarget(repo, userId);

    const response = formatDailyTarget(targetData);

    await ctx.reply(response, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[Cmd] /target error:", error);
    await ctx.reply(
      "⚠️ Gagal ambil target. Coba lagi ya bos."
    );
  }
}
