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
  const lowerTarget = target.toLowerCase().trim();

  // ── Layer 0: Explicit "last" from FC ──
  // FC sends target="last" when user says "yang terakhir salah"
  // and NLU normalizes to "koreksi data terakhir".
  // Check this FIRST before keyword matching.
  if (isReferringToLastTransaction(lowerTarget)) {
    const last = await findLastTransaction(db, userId);
    if (last) return last;
    // If no last transaction found, fall through to other layers
  }

  // Layer 1: Cari berdasarkan deskripsi (LIKE match)
  // "makan di bu tami" → LIKE '%makan%bu%tami%'
  const keywords = lowerTarget
    .split(/\s+/)
    .filter((w) => w.length > 2); // buang kata pendek

  if (keywords.length > 0) {
    const likePattern = `%${keywords.join("%")}%`;
    const byDesc = await findTransactionByDescription(db, userId, likePattern);
    if (byDesc) return byDesc;
  }

  // Layer 2: Cari berdasarkan kategori
  // target mungkin cuma "makan" atau "bensin"
  const byCat = await findTransactionByCategory(db, userId, lowerTarget);
  if (byCat) return byCat;

  // Layer 3: Cari berdasarkan source_text asli
  // Kadang AI kasih target yang mirip kalimat asli user
  const bySource = await findTransactionBySourceText(db, userId, lowerTarget);
  if (bySource) return bySource;

  return null;
}

/**
 * Check if target refers to the last/most recent transaction.
 * Matches both Indonesian patterns and the literal "last" from FC.
 */
function isReferringToLastTransaction(target: string): boolean {
  return /^last$|terakhir|barusan|tadi|baru aja|yang tadi|data terakhir/.test(target);
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
