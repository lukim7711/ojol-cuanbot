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

  for (const t of args.transactions) {
    const amount = validateAmount(t.amount);
    if (!amount) continue; // skip invalid

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

  return { type: "transactions_recorded", data: recorded };
}
