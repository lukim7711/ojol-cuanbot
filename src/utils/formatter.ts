import { ToolCallResult } from "../types/transaction";

export function formatRupiah(amount: number): string {
  return "Rp" + amount.toLocaleString("id-ID");
}

function progressBar(percent: number): string {
  const filled = Math.min(10, Math.round(percent / 10));
  const empty = 10 - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function formatDueStatus(dueStatus: any, dueDate: string | null): string {
  if (!dueDate || !dueStatus) return "";
  if (dueStatus.isOverdue) {
    return `\n         \u26a0\ufe0f <b>TELAT ${Math.abs(dueStatus.daysLeft)} HARI</b>`;
  }
  if (dueStatus.status === "urgent") {
    return `\n         \u23f3 <b>${dueStatus.daysLeft} hari lagi!</b>`;
  }
  if (dueStatus.status === "soon") {
    return `\n         \ud83d\udcc5 ${dueStatus.daysLeft} hari lagi`;
  }
  return `\n         \ud83d\udcc5 ${dueStatus.daysLeft} hari lagi`;
}

export function formatTargetProgress(target: any): string {
  if (!target || target.totalTarget <= 0) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");

  const pct = target.progressPercent;
  const bar = progressBar(pct);

  if (pct >= 100) {
    const surplus = target.todayIncome - target.totalTarget;
    lines.push(`\ud83c\udf89 <b>TARGET TERCAPAI!</b>`);
    lines.push(`${bar} ${pct}%`);
    lines.push(`\ud83d\udcb5 Surplus: ${formatRupiah(surplus)}`);
    lines.push(`Mantap bos, istirahat yang cukup ya! \ud83d\ude0e`);
  } else {
    lines.push(`\ud83c\udfaf Progress: ${formatRupiah(target.todayIncome)} / ${formatRupiah(target.totalTarget)} (${pct}%)`);
    lines.push(`${bar}`);
    lines.push(`\u23f3 Kurang ${formatRupiah(target.remaining)} lagi`);
    if (pct >= 70) {
      lines.push(`Dikit lagi bos! \ud83d\udd25`);
    } else if (pct >= 40) {
      lines.push(`Ayo bos semangat! \ud83d\udcaa`);
    }
  }

  return lines.join("\n");
}

export function formatReply(
  results: ToolCallResult[],
  aiText: string | null
): string {
  if (results.length === 0 && aiText) {
    return aiText;
  }

  const lines: string[] = [];

  for (const r of results) {
    switch (r.type) {
      case "transactions_recorded":
        if (r.data && r.data.length > 0) {
          lines.push("\u2705 <b>Tercatat!</b>");
          for (const t of r.data) {
            const icon = t.type === "income" ? "\ud83d\udcb0" : "\ud83d\udcb8";
            const label = t.type === "income" ? "Pemasukan" : "Pengeluaran";
            lines.push(`${icon} ${label}: ${formatRupiah(t.amount)} \u2014 <i>${t.description}</i>`);
          }
        } else {
          lines.push("\u26a0\ufe0f Hmm, gue nggak bisa parsing transaksinya. Coba ketik ulang ya, contoh: <i>makan 25rb, bensin 30rb</i>");
        }
        if (r.message) {
          lines.push(r.message);
        }
        break;

      case "debt_recorded": {
        const d = r.data;
        const dIcon = d.type === "hutang" ? "\ud83d\udd34" : "\ud83d\udfe2";
        const dLabel = d.type === "hutang" ? "Hutang ke" : "Piutang dari";
        lines.push(`${dIcon} ${dLabel} <b>${d.person_name}</b>: ${formatRupiah(d.amount)}`);

        // Show remaining if different from amount (hutang lama)
        if (d.remaining && d.remaining !== d.amount && d.remaining !== d.total_with_interest) {
          lines.push(`   \u21b3 Sisa: ${formatRupiah(d.remaining)}`);
        }

        // Interest info
        if (d.interest_type && d.interest_type !== "none" && d.interest_rate > 0) {
          const ratePercent = (d.interest_rate * 100).toFixed(1);
          const typeLabel = d.interest_type === "flat" ? "flat" : "harian";
          lines.push(`   \ud83d\udcc8 Bunga: ${ratePercent}%/${d.interest_type === "daily" ? "hari" : "bulan"} (${typeLabel})`);
          if (d.total_with_interest && d.total_with_interest !== d.amount) {
            lines.push(`   \ud83d\udcb5 Total bayar: ${formatRupiah(d.total_with_interest)}`);
          }
        }

        // Tenor + installment
        if (d.tenor_months) {
          lines.push(`   \ud83d\udcc5 Tenor: ${d.tenor_months} bulan`);
        }
        if (d.installment_amount) {
          const freqLabel = d.installment_freq === "daily" ? "hari" : d.installment_freq === "weekly" ? "minggu" : "bulan";
          lines.push(`   \ud83d\udcb3 Cicilan: ${formatRupiah(d.installment_amount)}/${freqLabel}`);
        }

        // Due date
        if (d.due_date) {
          lines.push(`   \ud83d\udcc5 Jatuh tempo: ${formatDateDisplay(d.due_date)}${formatDueStatus(d.due_status, d.due_date)}`);
        }
        break;
      }

      case "debt_paid": {
        const p = r.data;
        lines.push(`\ud83d\udcb3 Bayar hutang ke <b>${p.person_name}</b>: ${formatRupiah(p.paid)}`);
        if (p.remaining > 0) {
          lines.push(`   \u21b3 Sisa hutang: ${formatRupiah(p.remaining)}`);
          if (p.payment_number && p.tenor_months) {
            const sisaCicilan = p.tenor_months - p.payment_number;
            if (sisaCicilan > 0) {
              lines.push(`   \ud83d\udccc Cicilan ke-${p.payment_number}, sisa ${sisaCicilan} cicilan lagi`);
            }
          }
          if (p.next_payment_date) {
            lines.push(`   \ud83d\udcc5 Cicilan berikut: ${p.installment_amount ? formatRupiah(p.installment_amount) + " " : ""}(${formatDateDisplay(p.next_payment_date)})`);
          }
        } else {
          lines.push("   \u21b3 \ud83c\udf89 Lunas!");
          if (p.payment_number) {
            lines.push(`   \ud83d\udcca Total ${p.payment_number}x pembayaran, total ${formatRupiah(p.total_paid)}`);
          }
        }
        break;
      }

      case "summary":
        lines.push(`\ud83d\udcca <b>Rekap ${r.data.periodLabel}</b>`);
        lines.push(`\ud83d\udcb0 Pemasukan: ${formatRupiah(r.data.totalIncome)}`);
        lines.push(`\ud83d\udcb8 Pengeluaran: ${formatRupiah(r.data.totalExpense)}`);
        lines.push(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
        const net = r.data.totalIncome - r.data.totalExpense;
        const netIcon = net >= 0 ? "\ud83d\udcc8" : "\ud83d\udcc9";
        lines.push(`${netIcon} Bersih: ${formatRupiah(net)}`);
        if (r.data.details && r.data.details.length > 0) {
          lines.push("");
          for (const d of r.data.details) {
            lines.push(`  \u2022 ${d.description}: ${formatRupiah(d.amount)}`);
          }
        }
        break;

      case "debts_list": {
        const debts = r.data.debts;
        if (debts.length === 0) {
          lines.push("\u2728 Tidak ada hutang/piutang aktif!");
        } else {
          lines.push("\ud83d\udccb <b>Daftar Hutang/Piutang Aktif:</b>");
          for (const d of debts) {
            const icon = d.type === "hutang" ? "\ud83d\udd34" : "\ud83d\udfe2";
            const label = d.type === "hutang" ? "Hutang ke" : "Piutang dari";
            let line = `${icon} ${label} <b>${d.person_name}</b>: ${formatRupiah(d.remaining)} / ${formatRupiah(d.amount)}`;

            // Due date info
            if (d.due_date) {
              line += `\n      \ud83d\udcc5 ${formatDateDisplay(d.due_date)}`;
              if (d.due_status) {
                if (d.due_status.isOverdue) {
                  line += ` \u26a0\ufe0f <b>TELAT ${Math.abs(d.due_status.daysLeft)} HARI</b>`;
                } else if (d.due_status.status === "urgent") {
                  line += ` \u23f3 <b>${d.due_status.daysLeft} hari lagi!</b>`;
                } else {
                  line += ` (${d.due_status.daysLeft} hari lagi)`;
                }
              }
            }

            // Installment info
            if (d.installment_amount && d.next_payment_date) {
              line += `\n      \ud83d\udcb3 Cicilan: ${formatRupiah(d.installment_amount)} (next: ${formatDateDisplay(d.next_payment_date)})`;
            }

            lines.push(line);
          }
        }
        break;
      }

      case "debt_history" as any: {
        const h = r.data;
        lines.push(`\ud83d\udcca <b>Riwayat Hutang ke ${h.person_name}</b>`);
        lines.push(`\ud83d\udccc Pokok: ${formatRupiah(h.amount)}`);
        lines.push(`\ud83d\udcb0 Total dibayar: ${formatRupiah(h.total_paid)}`);
        lines.push(`\ud83d\udccc Sisa: ${formatRupiah(h.remaining)}`);

        if (h.due_date) {
          let dueLine = `\ud83d\udcc5 Jatuh tempo: ${formatDateDisplay(h.due_date)}`;
          if (h.due_status?.isOverdue) {
            dueLine += ` \u26a0\ufe0f TELAT ${Math.abs(h.due_status.daysLeft)} hari`;
          } else if (h.due_status) {
            dueLine += ` (${h.due_status.daysLeft} hari lagi)`;
          }
          lines.push(dueLine);
        }

        if (h.next_payment_date && h.installment_amount) {
          lines.push(`\ud83d\udcb3 Cicilan berikut: ${formatRupiah(h.installment_amount)} (${formatDateDisplay(h.next_payment_date)})`);
        }

        lines.push("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
        if (h.payments && h.payments.length > 0) {
          lines.push("Riwayat pembayaran:");
          for (let i = 0; i < h.payments.length; i++) {
            const p = h.payments[i];
            const date = new Date(p.paid_at * 1000);
            const dateStr = `${date.getDate()}/${date.getMonth() + 1}`;
            lines.push(`  ${i + 1}. ${dateStr} \u2014 ${formatRupiah(p.amount)}`);
          }
        } else {
          lines.push("Belum ada pembayaran.");
        }
        break;
      }

      case "daily_target" as any: {
        const t = r.data;
        if (t.totalTarget <= 0) {
          lines.push("\ud83c\udfaf Belum ada data untuk hitung target.");
          lines.push("Coba set dulu: kewajiban, tabungan, atau goal.");
          lines.push("Contoh: <i>cicilan gopay 50rb per hari</i>");
          break;
        }
        lines.push(`\ud83c\udfaf <b>Target Hari Ini: ${formatRupiah(t.totalTarget)}</b>`);
        lines.push("");
        lines.push("Rincian:");
        for (const o of t.obligations) {
          lines.push(`\u251c \ud83d\udcb3 ${o.name}: ${formatRupiah(o.dailyAmount)}`);
        }
        for (const d of t.debtInstallments) {
          const icon = d.isOverdue ? "\u26a0\ufe0f" : d.isUrgent ? "\u23f3" : "\ud83d\udd34";
          lines.push(`\u251c ${icon} ${d.name}: ${formatRupiah(d.dailyAmount)}`);
        }
        if (t.avgOperational > 0) {
          lines.push(`\u251c \u26fd Operasional (estimasi): ${formatRupiah(t.avgOperational)}`);
        }
        if (t.dailySaving > 0) {
          lines.push(`\u251c \ud83d\udcb0 Tabungan harian: ${formatRupiah(t.dailySaving)}`);
        }
        for (const g of t.goals) {
          lines.push(`\u251c \ud83c\udfaf ${g.name}: ${formatRupiah(g.dailyAmount)}`);
        }
        lines.push(`\u2514 \ud83d\udee1\ufe0f Buffer 10%: ${formatRupiah(t.buffer)}`);
        lines.push("");
        const pct = t.progressPercent;
        const bar = progressBar(pct);
        if (pct >= 100) {
          lines.push(`\ud83c\udf89 <b>TARGET TERCAPAI!</b> ${bar} ${pct}%`);
          const surplus = t.todayIncome - t.totalTarget;
          lines.push(`\ud83d\udcb5 Surplus: ${formatRupiah(surplus)}`);
        } else {
          lines.push(`\ud83d\udcca Progress: ${formatRupiah(t.todayIncome)} / ${formatRupiah(t.totalTarget)} (${pct}%)`);
          lines.push(bar);
          if (t.remaining > 0) {
            lines.push(`\u23f3 Kurang ${formatRupiah(t.remaining)} lagi. Semangat bos! \ud83d\udcaa`);
          }
        }
        break;
      }

      case "obligation_set" as any:
        lines.push(`\ud83d\udcb3 <b>Kewajiban tercatat!</b>`);
        lines.push(`\ud83d\udccc ${r.data.name}: ${formatRupiah(r.data.amount)}/${r.data.frequency}`);
        lines.push(`Ini akan masuk hitungan target harian lo.`);
        break;

      case "goal_set" as any:
        lines.push(`\ud83c\udfaf <b>Goal tercatat!</b>`);
        lines.push(`\ud83c\udff7\ufe0f ${r.data.name}: ${formatRupiah(r.data.target_amount)}`);
        lines.push(`\ud83d\udcc5 Deadline: ${r.data.deadline_days} hari \u2192 ${formatRupiah(r.data.daily)}/hari`);
        lines.push(`Ini akan masuk hitungan target harian lo.`);
        break;

      case "saving_set" as any:
        lines.push(`\ud83d\udcb0 <b>Tabungan harian diset!</b>`);
        lines.push(`\ud83d\udccc Minimal nabung: ${formatRupiah(r.data.daily_saving)}/hari`);
        break;

      case "edited":
        lines.push(`\u270f\ufe0f ${r.message}`);
        break;

      case "clarification":
        lines.push(`\ud83e\udd14 ${r.message}`);
        break;
    }
  }

  const reply = lines.join("\n");

  if (!reply) {
    if (aiText) return aiText;
    return "\u2705 Pesan diterima! Coba ketik ulang dengan format: <i>makan 25rb, dapet 59rb</i>";
  }

  return reply;
}
