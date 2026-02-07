import {
  insertTransaction,
  findCategoryByName,
} from "../db/repository";
import { getDateFromOffset } from "../utils/date";
import { validateAmount, sanitizeString } from "../utils/validator";
import { User, ParsedTransaction, ToolCallResult } from "../types/transaction";

export async function recordTransactions(
  db: D1Database,
  user: User,
  args: { transactions: ParsedTransaction[] },
  sourceText: string
): Promise<ToolCallResult> {
  const recorded: any[] = [];
  const skipped: string[] = [];

  for (const t of args.transactions) {
    const amount = validateAmount(t.amount);
    if (!amount) {
      // Jangan silent skip — catat yang gagal
      skipped.push(t.description || "transaksi tidak dikenal");
      console.warn(
        `[Transaction] Skipped invalid amount: ${t.amount} for "${t.description}"`
      );
      continue;
    }

    const trxDate = getDateFromOffset(t.date_offset ?? 0);

    // Cari category ID
    const cat = await findCategoryByName(db, t.type, t.category);
    const categoryId = cat?.id ?? null; // null → "lainnya" fallback

    await insertTransaction(
      db,
      user.id,
      t.type,
      categoryId,
      amount,
      sanitizeString(t.description),
      sourceText,
      trxDate
    );

    recorded.push({
      type: t.type,
      amount,
      category: t.category,
      description: t.description,
    });
  }

  // Tambahkan info skipped jika ada
  const result: ToolCallResult = { type: "transactions_recorded", data: recorded };
  if (skipped.length > 0) {
    result.message = `⚠️ ${skipped.length} transaksi gagal diproses: ${skipped.join(", ")}`;
  }

  return result;
}
