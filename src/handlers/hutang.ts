/**
 * Hutang Command Handler (Zero-Token Shortcut)
 *
 * Handles /hutang command by directly querying debt service
 * without invoking AI pipeline. Saves ~42 neurons per request.
 */

import { Context } from "grammy";
import { Env } from "../config/env";
import { getOrCreateUser } from "../services/user";
import { getDebts } from "../services/debt";
import { formatDebtList } from "../utils/formatter";

/**
 * Handle /hutang command — show all debts and receivables
 */
export async function handleHutang(ctx: Context, env: Env): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply("⚠️ User ID tidak ditemukan.");
    return;
  }

  try {
    console.log(`[Cmd] /hutang from user ${userId}`);

    // Get user object
    const user = await getOrCreateUser(env.DB, userId, ctx.from?.first_name);

    // Query both hutang and piutang
    const hutangResult = await getDebts(env.DB, user, { type: "hutang" });
    const piutangResult = await getDebts(env.DB, user, { type: "piutang" });

    // Format combined list
    const hutangFormatted = formatDebtList(hutangResult.data, "hutang");
    const piutangFormatted = formatDebtList(piutangResult.data, "piutang");

    const response = `<b>💸 Daftar Hutang & Piutang</b>\n\n${hutangFormatted}\n\n${piutangFormatted}`;

    await ctx.reply(response, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[Cmd] /hutang error:", error);
    await ctx.reply(
      "⚠️ Gagal ambil daftar hutang. Coba lagi ya bos."
    );
  }
}
