import { Context } from "grammy";
import { Env } from "../config/env";
import { findUserByTelegram, resetAllUserData } from "../db/repository";

export async function handleReset(ctx: Context, env: Env) {
  if (!ctx.from) return;

  const user = await findUserByTelegram(env.DB, String(ctx.from.id));

  if (!user) {
    await ctx.reply("⚠️ Lo belum terdaftar. Kirim /start dulu.", {
      parse_mode: "HTML",
    });
    return;
  }

  const counts = await resetAllUserData(env.DB, user.id);

  const total =
    counts.transactions +
    counts.debts +
    counts.debt_payments +
    counts.conversation_logs +
    counts.obligations +
    counts.goals +
    counts.user_settings;

  if (total === 0) {
    await ctx.reply("📭 Data lo udah kosong, gak ada yang perlu dihapus.", {
      parse_mode: "HTML",
    });
    return;
  }

  const lines: string[] = ["🗑️ <b>Reset Selesai!</b>\n"];

  if (counts.transactions > 0)
    lines.push(`  💰 ${counts.transactions} transaksi`);
  if (counts.debts > 0)
    lines.push(`  🔴 ${counts.debts} hutang/piutang`);
  if (counts.debt_payments > 0)
    lines.push(`  💳 ${counts.debt_payments} pembayaran hutang`);
  if (counts.obligations > 0)
    lines.push(`  📋 ${counts.obligations} kewajiban`);
  if (counts.goals > 0)
    lines.push(`  🎯 ${counts.goals} goal`);
  if (counts.user_settings > 0)
    lines.push(`  ⚙️ ${counts.user_settings} setting`);
  if (counts.conversation_logs > 0)
    lines.push(`  💬 ${counts.conversation_logs} chat history`);

  lines.push(`\n<b>Total: ${total} data dihapus.</b>`);
  lines.push("\nAkun lo masih aktif — tinggal mulai catat lagi! 🚀");

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
