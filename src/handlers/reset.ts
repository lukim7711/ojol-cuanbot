import { Context } from "grammy";
import { Env } from "../config/env";
import { findUserByTelegram, resetAllUserData } from "../db/repository";

/**
 * Pending reset confirmations.
 * Key: telegram user ID, Value: expiry timestamp (ms).
 *
 * NOTE: In-memory — acceptable here because reset is rare & manual.
 * Worst case if Worker instance changes: user just has to /reset again.
 */
const pendingResets = new Map<string, number>();
const CONFIRM_WINDOW_MS = 60_000; // 60 seconds

/**
 * /reset — Step 1: Ask for confirmation.
 * Does NOT delete anything yet.
 */
export async function handleReset(ctx: Context, env: Env) {
  if (!ctx.from) return;

  const telegramId = String(ctx.from.id);
  const user = await findUserByTelegram(env.DB, telegramId);

  if (!user) {
    await ctx.reply("⚠️ Lo belum terdaftar. Kirim /start dulu.", {
      parse_mode: "HTML",
    });
    return;
  }

  // Set pending confirmation with expiry
  pendingResets.set(telegramId, Date.now() + CONFIRM_WINDOW_MS);

  // Cleanup old entries
  cleanupPendingResets();

  await ctx.reply(
    "⚠️ <b>YAKIN mau hapus SEMUA data keuangan lo?</b>\n\n" +
      "Data yang akan dihapus:\n" +
      "  💰 Semua transaksi\n" +
      "  🔴 Semua hutang/piutang\n" +
      "  💳 Semua riwayat pembayaran\n" +
      "  📋 Semua kewajiban & goal\n" +
      "  💬 Semua chat history\n\n" +
      "❗ <b>Aksi ini TIDAK BISA dibatalkan.</b>\n\n" +
      "Ketik /confirm_reset dalam 60 detik untuk konfirmasi.",
    { parse_mode: "HTML" }
  );
}

/**
 * /confirm_reset — Step 2: Actually delete data.
 * Only works if /reset was called within the last 60 seconds.
 */
export async function handleConfirmReset(ctx: Context, env: Env) {
  if (!ctx.from) return;

  const telegramId = String(ctx.from.id);

  // Check if there's a pending reset
  const expiry = pendingResets.get(telegramId);
  if (!expiry || Date.now() > expiry) {
    pendingResets.delete(telegramId);
    await ctx.reply(
      "❌ Tidak ada permintaan reset aktif.\n" +
        "Ketik /reset dulu kalau mau hapus data.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Clear the pending flag
  pendingResets.delete(telegramId);

  const user = await findUserByTelegram(env.DB, telegramId);
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

/**
 * Remove expired pending resets to prevent memory leak.
 */
function cleanupPendingResets(): void {
  const now = Date.now();
  for (const [id, expiry] of pendingResets.entries()) {
    if (now > expiry) {
      pendingResets.delete(id);
    }
  }
}
