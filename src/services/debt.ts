import {
  insertDebt,
  findActiveDebtByPerson,
  findDebtByPersonAllStatus,
  updateDebtRemaining,
  updateDebtNextPayment,
  insertDebtPayment,
  getActiveDebts,
  getDebtPayments,
} from "../db/repository";
import { validateAmount, sanitizeString } from "../utils/validator";
import { getDateFromOffset } from "../utils/date";
import { formatRupiah } from "../utils/formatter";
import { User, ToolCallResult } from "../types/transaction";

/**
 * Resolve due_date from AI arguments.
 * Supports:
 * - Absolute date string: "2026-02-20"
 * - due_date_days offset: 14 → today + 14 days
 * - Recurring day of month: recurring_day = 15 → next 15th
 */
function resolveDueDate(
  args: any
): { dueDate: string | null; nextPaymentDate: string | null } {
  const today = getDateFromOffset(0);

  // 1. Absolute date ("2026-02-20")
  if (args.due_date && /^\d{4}-\d{2}-\d{2}$/.test(args.due_date)) {
    return { dueDate: args.due_date, nextPaymentDate: args.due_date };
  }

  // 2. Offset in days ("jatuh tempo 2 minggu" → due_date_days: 14)
  if (args.due_date_days && typeof args.due_date_days === "number") {
    const d = getDateFromOffset(args.due_date_days);
    return { dueDate: d, nextPaymentDate: d };
  }

  // 3. Recurring day of month ("tiap tanggal 15")
  if (args.recurring_day && typeof args.recurring_day === "number") {
    const day = Math.min(28, Math.max(1, args.recurring_day));
    const [y, m, d] = today.split("-").map(Number);
    let nextMonth = m;
    let nextYear = y;

    // If today's date already passed the recurring day, move to next month
    if (d >= day) {
      nextMonth = m + 1;
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear = y + 1;
      }
    }

    const nextPayDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // For tenor-based debts, calculate final due date
    if (args.tenor_months) {
      let finalMonth = m + args.tenor_months;
      let finalYear = y;
      while (finalMonth > 12) {
        finalMonth -= 12;
        finalYear++;
      }
      const finalDueDate = `${finalYear}-${String(finalMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { dueDate: finalDueDate, nextPaymentDate: nextPayDate };
    }

    return { dueDate: nextPayDate, nextPaymentDate: nextPayDate };
  }

  return { dueDate: null, nextPaymentDate: null };
}

/**
 * Calculate interest and total amount
 */
function calculateInterest(
  principal: number,
  rate: number,
  type: string,
  tenorMonths: number | null
): { totalWithInterest: number; installmentAmount: number | null } {
  if (type === "none" || rate <= 0) {
    if (tenorMonths && tenorMonths > 0) {
      return {
        totalWithInterest: principal,
        installmentAmount: Math.round(principal / tenorMonths),
      };
    }
    return { totalWithInterest: principal, installmentAmount: null };
  }

  if (type === "flat") {
    const months = tenorMonths || 1;
    const totalInterest = Math.round(principal * rate * months);
    const total = principal + totalInterest;
    const installment = Math.round(total / months);
    return { totalWithInterest: total, installmentAmount: installment };
  }

  if (type === "daily") {
    const days = (tenorMonths || 1) * 30;
    const totalInterest = Math.round(principal * rate * days);
    const total = principal + totalInterest;
    return { totalWithInterest: total, installmentAmount: null };
  }

  return { totalWithInterest: principal, installmentAmount: null };
}

/**
 * Calculate next payment date after a payment is made
 */
function calculateNextPaymentDate(
  currentNext: string | null,
  freq: string
): string | null {
  if (!currentNext) return null;

  const [y, m, d] = currentNext.split("-").map(Number);
  const date = new Date(y, m - 1, d);

  switch (freq) {
    case "daily":
      date.setDate(date.getDate() + 1);
      break;
    case "weekly":
      date.setDate(date.getDate() + 7);
      break;
    case "monthly":
    default:
      date.setMonth(date.getMonth() + 1);
      break;
  }

  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, "0");
  const nd = String(date.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

/**
 * Get overdue status for a debt
 */
export function getDebtStatus(
  dueDate: string | null,
  nextPaymentDate: string | null,
  today: string
): { status: string; daysLeft: number; isOverdue: boolean } {
  const checkDate = nextPaymentDate || dueDate;
  if (!checkDate) return { status: "no_due", daysLeft: 0, isOverdue: false };

  const dueMs = new Date(checkDate).getTime();
  const todayMs = new Date(today).getTime();
  const diffDays = Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: "overdue", daysLeft: diffDays, isOverdue: true };
  } else if (diffDays <= 3) {
    return { status: "urgent", daysLeft: diffDays, isOverdue: false };
  } else if (diffDays <= 7) {
    return { status: "soon", daysLeft: diffDays, isOverdue: false };
  }
  return { status: "ok", daysLeft: diffDays, isOverdue: false };
}

export async function recordDebt(
  db: D1Database,
  user: User,
  args: any,
  sourceText: string
): Promise<ToolCallResult> {
  const amount = validateAmount(args.amount);
  if (!amount) {
    return { type: "clarification", data: null, message: "Jumlah hutang tidak valid." };
  }

  // ============================================
  // DEDUP GUARD: Prevent duplicate debt from AI calling record_debt twice
  // Check if there's an active debt to same person with same amount
  // created within last 60 seconds
  // ============================================
  const personName = sanitizeString(args.person_name);
  const existingDebt = await findActiveDebtByPerson(db, user.id, personName);

  if (existingDebt) {
    const nowUnix = Math.floor(Date.now() / 1000);
    const createdAt = (existingDebt as any).created_at;
    const ageSeconds = nowUnix - createdAt;

    // Same person, same amount, created < 60 seconds ago = duplicate
    if (existingDebt.amount === amount && ageSeconds < 60) {
      console.warn(
        `[Debt] DEDUP: Skipping duplicate debt to "${personName}" (${amount}), created ${ageSeconds}s ago`
      );
      // Return as if recorded (user sees success, but no duplicate in DB)
      const today = getDateFromOffset(0);
      const { dueDate, nextPaymentDate } = resolveDueDate(args);
      const dueDateStatus = getDebtStatus(dueDate, nextPaymentDate, today);

      return {
        type: "debt_recorded",
        data: {
          type: args.type,
          person_name: args.person_name,
          amount,
          remaining: existingDebt.remaining,
          due_date: existingDebt.due_date,
          due_status: dueDateStatus,
          interest_rate: existingDebt.interest_rate,
          interest_type: existingDebt.interest_type,
          tenor_months: existingDebt.tenor_months,
          installment_amount: existingDebt.installment_amount,
          installment_freq: existingDebt.installment_freq,
          total_with_interest: existingDebt.total_with_interest,
        },
      };
    }
  }

  // Resolve due date
  const { dueDate, nextPaymentDate } = resolveDueDate(args);

  // Interest
  const interestRate = args.interest_rate || 0;
  const interestType = args.interest_type || "none";
  const tenorMonths = args.tenor_months || null;
  const installmentFreq = args.installment_freq || "monthly";

  // Calculate totals
  const { totalWithInterest, installmentAmount } = calculateInterest(
    amount, interestRate, interestType, tenorMonths
  );

  // Remaining = user bisa input sisa hutang langsung (hutang lama)
  const remaining = args.remaining ? validateAmount(args.remaining) || totalWithInterest : totalWithInterest;

  // Custom installment amount from user overrides calculated
  const finalInstallment = args.installment_amount
    ? validateAmount(args.installment_amount) || installmentAmount
    : installmentAmount;

  await insertDebt(
    db,
    user.id,
    args.type,
    personName,
    amount,
    remaining,
    args.note ? sanitizeString(args.note) : null,
    sourceText,
    dueDate,
    interestRate,
    interestType,
    tenorMonths,
    finalInstallment,
    installmentFreq,
    nextPaymentDate,
    totalWithInterest
  );

  const today = getDateFromOffset(0);
  const dueDateStatus = getDebtStatus(dueDate, nextPaymentDate, today);

  return {
    type: "debt_recorded",
    data: {
      type: args.type,
      person_name: args.person_name,
      amount,
      remaining,
      due_date: dueDate,
      due_status: dueDateStatus,
      interest_rate: interestRate,
      interest_type: interestType,
      tenor_months: tenorMonths,
      installment_amount: finalInstallment,
      installment_freq: installmentFreq,
      total_with_interest: totalWithInterest,
    },
  };
}

export async function payDebt(
  db: D1Database,
  user: User,
  args: { person_name: string; amount: number },
  sourceText: string
): Promise<ToolCallResult> {
  const amount = validateAmount(args.amount);
  if (!amount) {
    return { type: "clarification", data: null, message: "Jumlah pembayaran tidak valid." };
  }

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

  // Update next payment date
  if (debt.next_payment_date && newRemaining > 0) {
    const nextDate = calculateNextPaymentDate(
      debt.next_payment_date,
      debt.installment_freq || "monthly"
    );
    await updateDebtNextPayment(db, debt.id, nextDate);
  }

  // Count payments made
  const payments = await getDebtPayments(db, debt.id);
  const paymentCount = payments.results.length;
  const totalPaid = payments.results.reduce((s: number, p: any) => s + p.amount, 0);

  const today = getDateFromOffset(0);
  const nextPayDate = debt.next_payment_date
    ? calculateNextPaymentDate(debt.next_payment_date, debt.installment_freq || "monthly")
    : null;

  return {
    type: "debt_paid",
    data: {
      person_name: args.person_name,
      paid: amount,
      remaining: newRemaining,
      payment_number: paymentCount,
      total_paid: totalPaid,
      installment_amount: debt.installment_amount,
      next_payment_date: newRemaining > 0 ? nextPayDate : null,
      tenor_months: debt.tenor_months,
    },
  };
}

export async function getDebtsList(
  db: D1Database,
  user: User,
  args: { type: string }
): Promise<ToolCallResult> {
  const result = await getActiveDebts(db, user.id, args.type);
  const today = getDateFromOffset(0);

  // Enrich each debt with status info
  const debts = (result.results as any[]).map((d) => {
    const status = getDebtStatus(d.due_date, d.next_payment_date, today);
    return { ...d, due_status: status };
  });

  // Sort: overdue first, then by days left
  debts.sort((a, b) => {
    if (a.due_status.isOverdue && !b.due_status.isOverdue) return -1;
    if (!a.due_status.isOverdue && b.due_status.isOverdue) return 1;
    return a.due_status.daysLeft - b.due_status.daysLeft;
  });

  return {
    type: "debts_list",
    data: { debts },
  };
}

export async function getDebtHistory(
  db: D1Database,
  user: User,
  args: { person_name: string }
): Promise<ToolCallResult> {
  // First try active debt
  let debt = await findActiveDebtByPerson(db, user.id, args.person_name);

  // If no active debt, try ALL statuses (including settled)
  // so user can still see payment history of paid-off debts
  if (!debt) {
    debt = await findDebtByPersonAllStatus(db, user.id, args.person_name) as any;
  }

  if (!debt) {
    return {
      type: "clarification",
      data: null,
      message: `Tidak ditemukan hutang/piutang ke "${args.person_name}".`,
    };
  }

  const payments = await getDebtPayments(db, debt.id);
  const totalPaid = payments.results.reduce((s: number, p: any) => s + p.amount, 0);
  const today = getDateFromOffset(0);
  const dueStatus = getDebtStatus(debt.due_date, debt.next_payment_date, today);

  return {
    type: "debt_history" as any,
    data: {
      person_name: debt.person_name,
      type: debt.type,
      amount: debt.amount,
      remaining: debt.remaining,
      total_paid: totalPaid,
      due_date: debt.due_date,
      due_status: dueStatus,
      next_payment_date: debt.next_payment_date,
      installment_amount: debt.installment_amount,
      payments: payments.results,
      status: (debt as any).status || "active",
    },
  };
}
