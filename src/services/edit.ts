import {
  findTransactionByDescription,
  findTransactionByCategory,
  findTransactionBySourceText,
  findLastTransaction,
  updateTransactionAmount,
  deleteTransaction,
  FoundTransaction,
} from "../db/repository";
import { validateAmount } from "../utils/validator";
import { formatRupiah } from "../utils/formatter";
import { User, ToolCallResult } from "../types/transaction";

interface EditArgs {
  action: "edit" | "delete";
  target: string;           // deskripsi transaksi yang dimaksud user
  new_amount?: number;      // jumlah baru (hanya untuk edit)
  new_category?: string;    // kategori baru (opsional)
}

export async function editOrDeleteTransaction(
  db: D1Database,
  user: User,
  args: EditArgs
): Promise<ToolCallResult> {
  const { action, target } = args;

  // ── Step 1: Cari transaksi yang dimaksud ──
  const transaction = await resolveTarget(db, user.id, target);

  if (!transaction) {
    return {
      type: "clarification",
      data: null,
      message:
        `Gue gak nemu transaksi "${target}" di catatan lo. ` +
        `Coba sebutin lebih spesifik ya, misalnya "yang makan 25rb tadi".`,
    };
  }

  // ── Step 2: Eksekusi action ──
  if (action === "delete") {
    return handleDelete(db, transaction);
  }

  if (action === "edit") {
    return handleEdit(db, transaction, args);
  }

  return {
    type: "clarification",
    data: null,
    message: "Mau diapain nih? Bilang 'edit' atau 'hapus' ya.",
  };
}

// ─────────────────────────────────────────────────
// RESOLVE TARGET: Multi-layer matching strategy
// ─────────────────────────────────────────────────

async function resolveTarget(
  db: D1Database,
  userId: number,
  target: string
): Promise<FoundTransaction | null> {
  // Layer 1: Cari berdasarkan deskripsi (LIKE match)
  // "makan di bu tami" → LIKE '%makan%bu%tami%'
  const keywords = target
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2); // buang kata pendek

  if (keywords.length > 0) {
    const likePattern = `%${keywords.join("%")}%`;
    const byDesc = await findTransactionByDescription(db, userId, likePattern);
    if (byDesc) return byDesc;
  }

  // Layer 2: Cari berdasarkan kategori
  // target mungkin cuma "makan" atau "bensin"
  const byCat = await findTransactionByCategory(db, userId, target.toLowerCase().trim());
  if (byCat) return byCat;

  // Layer 3: Cari berdasarkan source_text asli
  // Kadang AI kasih target yang mirip kalimat asli user
  const bySource = await findTransactionBySourceText(db, userId, target.toLowerCase());
  if (bySource) return bySource;

  // Layer 4: Fallback — ambil transaksi paling terakhir
  // Cocok untuk kasus "yang terakhir salah" / "yang barusan"
  const isReferringToLast =
    /terakhir|barusan|tadi|baru aja|yang tadi/.test(target.toLowerCase());

  if (isReferringToLast) {
    const last = await findLastTransaction(db, userId);
    if (last) return last;
  }

  return null;
}

// ─────────────────────────────────────────────────
// HANDLE DELETE
// ─────────────────────────────────────────────────

async function handleDelete(
  db: D1Database,
  trx: FoundTransaction
): Promise<ToolCallResult> {
  await deleteTransaction(db, trx.id);

  const label = trx.type === "income" ? "Pemasukan" : "Pengeluaran";

  return {
    type: "edited",
    data: { deleted: trx },
    message:
      `🗑️ Dihapus: ${label} ${formatRupiah(trx.amount)}` +
      (trx.description ? ` — ${trx.description}` : ""),
  };
}

// ─────────────────────────────────────────────────
// HANDLE EDIT
// ─────────────────────────────────────────────────

async function handleEdit(
  db: D1Database,
  trx: FoundTransaction,
  args: EditArgs
): Promise<ToolCallResult> {
  // Validasi amount baru
  if (!args.new_amount) {
    return {
      type: "clarification",
      data: null,
      message:
        `Ketemu transaksi "${trx.description}" (${formatRupiah(trx.amount)}). ` +
        `Mau diubah jadi berapa?`,
    };
  }

  const newAmount = validateAmount(args.new_amount);
  if (!newAmount) {
    return {
      type: "clarification",
      data: null,
      message: "Jumlah barunya gak valid. Coba tulis ulang ya.",
    };
  }

  const oldAmount = trx.amount;
  await updateTransactionAmount(db, trx.id, newAmount);

  return {
    type: "edited",
    data: {
      old: { amount: oldAmount, description: trx.description },
      new: { amount: newAmount },
    },
    message:
      `✏️ Diubah: "${trx.description}"\n` +
      `   ${formatRupiah(oldAmount)} → ${formatRupiah(newAmount)}`,
  };
}
