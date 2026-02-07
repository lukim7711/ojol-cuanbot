import { ToolCallResult } from "../types/transaction";

/**
 * Format angka ke Rupiah: 59000 → "Rp59.000"
 */
export function formatRupiah(amount: number): string {
  return "Rp" + amount.toLocaleString("id-ID");
}

/**
 * Build progress bar visual
 */
function progressBar(percent: number): string {
  const filled = Math.min(10, Math.round(percent / 10));
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

/**
 * Format target progress line (dipakai setelah catat income)
 */
export function formatTargetProgress(target: any): string {
  if (!target || target.totalTarget <= 0) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push("━━━━━━━━━━━━━━");

  const pct = target.progressPercent;
  const bar = progressBar(pct);

  if (pct >= 100) {
    const surplus = target.todayIncome - target.totalTarget;
    lines.push(`🎉 <b>TARGET TERCAPAI!</b>`);
    lines.push(`${bar} ${pct}%`);
    lines.push(`💵 Surplus: ${formatRupiah(surplus)}`);
    lines.push(`Mantap bos, istirahat yang cukup ya! 😎`);
  } else {
    lines.push(`🎯 Progress: ${formatRupiah(target.todayIncome)} / ${formatRupiah(target.totalTarget)} (${pct}%)`);
    lines.push(`${bar}`);
    lines.push(`⏳ Kurang ${formatRupiah(target.remaining)} lagi`);
    if (pct >= 70) {
      lines.push(`Dikit lagi bos! 🔥`);
    } else if (pct >= 40) {
      lines.push(`Ayo bos semangat! 💪`);
    }
  }

  return lines.join("\n");
}

/**
 * Buat reply message dari hasil tool calls
 */
export function formatReply(
  results: ToolCallResult[],
  aiText: string | null
): string {
  // Jika tidak ada tool call (basa-basi), kembalikan teks AI langsung
  if (results.length === 0 && aiText) {
    return aiText;
  }

  const lines: string[] = [];

  for (const r of results) {
    switch (r.type) {
      case "transactions_recorded":
        if (r.data && r.data.length > 0) {
          lines.push("✅ <b>Tercatat!</b>");
          for (const t of r.data) {
            const icon = t.type === "income" ? "💰" : "💸";
            const label = t.type === "income" ? "Pemasukan" : "Pengeluaran";
            lines.push(
              `${icon} ${label}: ${formatRupiah(t.amount)} — <i>${t.description}</i>`
            );
          }
        } else {
          lines.push("⚠️ Hmm, gue nggak bisa parsing transaksinya. Coba ketik ulang ya, contoh: <i>makan 25rb, bensin 30rb</i>");
        }
        // Warning for skipped transactions
        if (r.message) {
          lines.push(r.message);
        }
        break;

      case "debt_recorded":
        const dIcon = r.data.type === "hutang" ? "🔴" : "🟢";
        const dLabel = r.data.type === "hutang" ? "Hutang ke" : "Piutang dari";
        lines.push(
          `${dIcon} ${dLabel} <b>${r.data.person_name}</b>: ${formatRupiah(r.data.amount)}`
        );
        break;

      case "debt_paid":
        lines.push(
          `💳 Bayar hutang ke <b>${r.data.person_name}</b>: ${formatRupiah(r.data.paid)}`
        );
        if (r.data.remaining > 0) {
          lines.push(`   ↳ Sisa hutang: ${formatRupiah(r.data.remaining)}`);
        } else {
          lines.push("   ↳ 🎉 Lunas!");
        }
        break;

      case "summary":
        lines.push(`📊 <b>Rekap ${r.data.periodLabel}</b>`);
        lines.push(`💰 Pemasukan: ${formatRupiah(r.data.totalIncome)}`);
        lines.push(`💸 Pengeluaran: ${formatRupiah(r.data.totalExpense)}`);
        lines.push(`━━━━━━━━━━━━━━`);
        const net = r.data.totalIncome - r.data.totalExpense;
        const netIcon = net >= 0 ? "📈" : "📉";
        lines.push(`${netIcon} Bersih: ${formatRupiah(net)}`);
        if (r.data.details && r.data.details.length > 0) {
          lines.push("");
          for (const d of r.data.details) {
            lines.push(`  • ${d.description}: ${formatRupiah(d.amount)}`);
          }
        }
        break;

      case "debts_list":
        if (r.data.debts.length === 0) {
          lines.push("✨ Tidak ada hutang/piutang aktif!");
        } else {
          lines.push("📋 <b>Daftar Hutang/Piutang Aktif:</b>");
          for (const d of r.data.debts) {
            const icon = d.type === "hutang" ? "🔴" : "🟢";
            const label = d.type === "hutang" ? "Hutang ke" : "Piutang dari";
            lines.push(
              `${icon} ${label} <b>${d.person_name}</b>: ${formatRupiah(d.remaining)} / ${formatRupiah(d.amount)}`
            );
          }
        }
        break;

      case "daily_target": {
        const t = r.data;
        if (t.totalTarget <= 0) {
          lines.push("🎯 Belum ada data untuk hitung target.");
          lines.push("Coba set dulu: kewajiban, tabungan, atau goal.");
          lines.push("Contoh: <i>cicilan gopay 50rb per hari</i>");
          break;
        }
        lines.push(`🎯 <b>Target Hari Ini: ${formatRupiah(t.totalTarget)}</b>`);
        lines.push("");
        lines.push("Rincian:");
        for (const o of t.obligations) {
          lines.push(`├ 💳 ${o.name}: ${formatRupiah(o.dailyAmount)}`);
        }
        for (const d of t.debtInstallments) {
          lines.push(`├ 🔴 ${d.name}: ${formatRupiah(d.dailyAmount)}`);
        }
        if (t.avgOperational > 0) {
          lines.push(`├ ⛽ Operasional (estimasi): ${formatRupiah(t.avgOperational)}`);
        }
        if (t.dailySaving > 0) {
          lines.push(`├ 💰 Tabungan harian: ${formatRupiah(t.dailySaving)}`);
        }
        for (const g of t.goals) {
          lines.push(`├ 🎯 ${g.name}: ${formatRupiah(g.dailyAmount)}`);
        }
        lines.push(`└ 🛡️ Buffer 10%: ${formatRupiah(t.buffer)}`);
        lines.push("");
        const pct = t.progressPercent;
        const bar = progressBar(pct);
        if (pct >= 100) {
          lines.push(`🎉 <b>TARGET TERCAPAI!</b> ${bar} ${pct}%`);
          const surplus = t.todayIncome - t.totalTarget;
          lines.push(`💵 Surplus: ${formatRupiah(surplus)}`);
        } else {
          lines.push(`📊 Progress: ${formatRupiah(t.todayIncome)} / ${formatRupiah(t.totalTarget)} (${pct}%)`);
          lines.push(bar);
          if (t.remaining > 0) {
            lines.push(`⏳ Kurang ${formatRupiah(t.remaining)} lagi. Semangat bos! 💪`);
          }
        }
        break;
      }

      case "obligation_set":
        lines.push(`💳 <b>Kewajiban tercatat!</b>`);
        lines.push(`📌 ${r.data.name}: ${formatRupiah(r.data.amount)}/${r.data.frequency}`);
        lines.push(`Ini akan masuk hitungan target harian lo.`);
        break;

      case "goal_set":
        lines.push(`🎯 <b>Goal tercatat!</b>`);
        lines.push(`🏷️ ${r.data.name}: ${formatRupiah(r.data.target_amount)}`);
        lines.push(`📅 Deadline: ${r.data.deadline_days} hari → ${formatRupiah(r.data.daily)}/hari`);
        lines.push(`Ini akan masuk hitungan target harian lo.`);
        break;

      case "saving_set":
        lines.push(`💰 <b>Tabungan harian diset!</b>`);
        lines.push(`📌 Minimal nabung: ${formatRupiah(r.data.daily_saving)}/hari`);
        break;

      case "edited":
        lines.push(`✏️ ${r.message}`);
        break;

      case "clarification":
        lines.push(`🤔 ${r.message}`);
        break;
    }
  }

  const reply = lines.join("\n");

  // Fallback: jangan pernah return string kosong
  if (!reply) {
    if (aiText) return aiText;
    return "✅ Pesan diterima! Coba ketik ulang dengan format: <i>makan 25rb, dapet 59rb</i>";
  }

  return reply;
}
