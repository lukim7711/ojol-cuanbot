import {
  insertDebt,
  findActiveDebtByPerson,
  updateDebtRemaining,
  insertDebtPayment,
  getActiveDebts,
} from "../db/repository";
import { validateAmount, sanitizeString } from "../utils/validator";
import { User, ParsedDebt, ParsedDebtPayment, ToolCallResult } from "../types/transaction";

export async function recordDebt(
  db: D1Database,
  user: User,
  args: ParsedDebt,
  sourceText: string
): Promise<ToolCallResult> {
  const amount = validateAmount(args.amount);
  if (!amount) {
    return { type: "clarification", data: null, message: "Jumlah hutang tidak valid." };
  }

  await insertDebt(
    db,
    user.id,
    args.type,
    sanitizeString(args.person_name),
    amount,
    args.note ? sanitizeString(args.note) : null,
    sourceText
  );

  return {
    type: "debt_recorded",
    data: {
      type: args.type,
      person_name: args.person_name,
      amount,
    },
  };
}

export async function payDebt(
  db: D1Database,
  user: User,
  args: ParsedDebtPayment,
  sourceText: string
): Promise<ToolCallResult> {
  const amount = validateAmount(args.amount);
  if (!amount) {
    return { type: "clarification", data: null, message: "Jumlah pembayaran tidak valid." };
  }

  // Cari hutang aktif ke orang tersebut
  const debt = await findActiveDebtByPerson(db, user.id, args.person_name);

  if (!debt) {
    return {
      type: "clarification",
      data: null,
      message: `Tidak ditemukan hutang aktif ke "${args.person_name}". Cek lagi nama orangnya ya.`,
    };
  }

  const newRemaining = Math.max(0, debt.remaining - amount);
  await updateDebtRemaining(db, debt.id, newRemaining);
  await insertDebtPayment(db, debt.id, amount, sourceText);

  return {
    type: "debt_paid",
    data: {
      person_name: args.person_name,
      paid: amount,
      remaining: newRemaining,
    },
  };
}

export async function getDebtsList(
  db: D1Database,
  user: User,
  args: { type: string }
): Promise<ToolCallResult> {
  const result = await getActiveDebts(db, user.id, args.type);

  return {
    type: "debts_list",
    data: { debts: result.results },
  };
}
