import { ToolCallResult } from "../types/transaction";

/**
 * Format angka ke Rupiah: 59000 → "Rp59.000"
 */
export function formatRupiah(amount: number): string {
  return "Rp" + amount.toLocaleString("id-ID");
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
        lines.push("✅ <b>Tercatat!</b>");
        for (const t of r.data) {
          const icon = t.type === "income" ? "💰" : "💸";
          const label = t.type === "income" ? "Pemasukan" : "Pengeluaran";
          lines.push(
            `${icon} ${label}: ${formatRupiah(t.amount)} — <i>${t.description}</i>`
          );
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
  // Telegram API akan reject sendMessage dengan body kosong
  if (!reply) {
    if (aiText) return aiText;
    return "✅ Diproses!";
  }

  return reply;
}
