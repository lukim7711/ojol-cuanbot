import { Context } from "grammy";
import { Env } from "../config/env";
import { getOrCreateUser } from "../services/user";

export async function handleStart(ctx: Context, env: Env) {
  if (!ctx.from) return;

  const user = await getOrCreateUser(
    env.DB,
    String(ctx.from.id),
    ctx.from.first_name ?? "Driver"
  );

  const msg = `🏍️ <b>Halo ${user.display_name}! Gue CuanBot.</b>

Gue bakal bantu lo ngatur keuangan harian sebagai driver ojol.

<b>Cara pakainya gampang — tinggal chat biasa aja:</b>

💰 <i>"Hari ini dapet 120rb, makan 25rb, bensin 30rb"</i>
🔴 <i>"Minjem duit ke Budi 200rb"</i>
💳 <i>"Bayar hutang ke Budi 100rb"</i>
📊 <i>"Rekap hari ini"</i> atau <i>"Laporan bulan ini"</i>
📋 <i>"Hutang gue masih berapa?"</i>
✏️ <i>"Yang makan tadi salah, harusnya 20rb"</i>

Gue ngerti bahasa lo, jadi santai aja ngetiknya! 🤙`;

  await ctx.reply(msg, { parse_mode: "HTML" });
}
