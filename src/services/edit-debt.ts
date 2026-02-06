import {
  findActiveDebtByPerson,
  updateDebtRemaining,
} from "../db/repository";
import { validateAmount } from "../utils/validator";
import { formatRupiah } from "../utils/formatter";
import { User, ToolCallResult } from "../types/transaction";

interface EditDebtArgs {
  action: "edit" | "delete";
  person_name: string;
  new_amount?: number;
}

export async function editDebt(
  db: D1Database,
  user: User,
  args: EditDebtArgs
): Promise<ToolCallResult> {
  const debt = await findActiveDebtByPerson(db, user.id, args.person_name);

  if (!debt) {
    return {
      type: "clarification",
      data: null,
      message: `Gak nemu hutang aktif ke "${args.person_name}". Cek lagi namanya ya.`,
    };
  }

  if (args.action === "delete") {
    // Soft delete: set status = settled
    await db
      .prepare(
        `UPDATE debts SET status = 'settled', settled_at = unixepoch() WHERE id = ?`
      )
      .bind(debt.id)
      .run();

    return {
      type: "edited",
      data: { deleted_debt: debt },
      message: `🗑️ Hutang ke ${args.person_name} (${formatRupiah(debt.amount)}) dihapus.`,
    };
  }

  if (args.action === "edit" && args.new_amount) {
    const newAmount = validateAmount(args.new_amount);
    if (!newAmount) {
      return {
        type: "clarification",
        data: null,
        message: "Jumlah barunya gak valid.",
      };
    }

    // Hitung selisih untuk adjust remaining
    const diff = newAmount - debt.amount;
    const newRemaining = Math.max(0, debt.remaining + diff);

    await db
      .prepare(`UPDATE debts SET amount = ?, remaining = ? WHERE id = ?`)
      .bind(newAmount, newRemaining, debt.id)
      .run();

    return {
      type: "edited",
      data: {
        person_name: args.person_name,
        old_amount: debt.amount,
        new_amount: newAmount,
        new_remaining: newRemaining,
      },
      message:
        `✏️ Hutang ke ${args.person_name} diubah:\n` +
        `   ${formatRupiah(debt.amount)} → ${formatRupiah(newAmount)}\n` +
        `   Sisa: ${formatRupiah(newRemaining)}`,
    };
  }

  return {
    type: "clarification",
    data: null,
    message: `Mau diapain hutang ke ${args.person_name}?`,
  };
}
