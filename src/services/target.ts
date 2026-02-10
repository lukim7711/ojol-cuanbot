import {
  getActiveObligations,
  getActiveGoals,
  getUserSetting,
  getAverageDailyExpense,
  getTodayIncome,
  insertObligation,
  insertGoal,
  upsertUserSetting,
  findObligationByName,
  updateObligationStatus,
  findGoalByName,
  updateGoalStatus,
} from "../db/repository-target";
import { getActiveDebts } from "../db/repository";
import { getDebtStatus } from "./debt";
import { getDateFromOffset } from "../utils/date";
import { validateAmount } from "../utils/validator";
import { sanitizeString } from "../utils/validator";
import { User, ToolCallResult } from "../types/transaction";

export interface TargetBreakdown {
  obligations: Array<{ name: string; dailyAmount: number }>;
  debtInstallments: Array<{ name: string; dailyAmount: number; isOverdue: boolean; isUrgent: boolean }>;
  avgOperational: number;
  dailySaving: number;
  goals: Array<{ name: string; dailyAmount: number }>;
  buffer: number;
  totalTarget: number;
  todayIncome: number;
  remaining: number;
  progressPercent: number;
}

/**
 * Hitung target harian berdasarkan semua komponen
 */
export async function calculateDailyTarget(
  db: D1Database,
  user: User
): Promise<TargetBreakdown> {
  const today = getDateFromOffset(0);

  // 1. Kewajiban tetap
  const oblResult = await getActiveObligations(db, user.id);
  const obligations = (oblResult.results as any[]).map((o) => {
    let dailyAmount = o.amount;
    if (o.frequency === "weekly") dailyAmount = Math.round(o.amount / 7);
    if (o.frequency === "monthly") dailyAmount = Math.round(o.amount / 30);
    return { name: o.name, dailyAmount };
  });

  // 2. Cicilan hutang aktif — smart prioritization
  const debtResult = await getActiveDebts(db, user.id);
  const debtInstallments = (debtResult.results as any[]).map((d) => {
    const status = getDebtStatus(d.due_date, d.next_payment_date, today);

    let dailyAmount: number;
    if (d.installment_amount) {
      // User sudah set cicilan → bagi per hari sesuai frekuensi
      if (d.installment_freq === "daily") {
        dailyAmount = d.installment_amount;
      } else if (d.installment_freq === "weekly") {
        dailyAmount = Math.round(d.installment_amount / 7);
      } else {
        dailyAmount = Math.round(d.installment_amount / 30);
      }
    } else if (d.due_date) {
      // Ada jatuh tempo → bagi sisa hutang per sisa hari
      const daysLeft = Math.max(1, status.daysLeft);
      dailyAmount = Math.round(d.remaining / daysLeft);
    } else {
      // Default: bagi rata 30 hari
      dailyAmount = Math.round(d.remaining / 30);
    }

    // Overdue: tambah urgency — harus bayar HARI INI
    if (status.isOverdue) {
      dailyAmount = d.installment_amount || d.remaining;
    }

    const label = d.type === "hutang" ? `Hutang ${d.person_name}` : `Piutang ${d.person_name}`;

    return {
      name: status.isOverdue
        ? `${label} (⚠️ TELAT ${Math.abs(status.daysLeft)} hari!)`
        : status.status === "urgent"
        ? `${label} (⏳ ${status.daysLeft} hari lagi)`
        : label,
      dailyAmount,
      isOverdue: status.isOverdue,
      isUrgent: status.status === "urgent",
    };
  });

  // 3. Rata-rata operasional 7 hari terakhir
  const weekAgo = getDateFromOffset(-7);
  const avgOperational = await getAverageDailyExpense(db, user.id, weekAgo, today);

  // 4. Tabungan harian
  const savingSetting = await getUserSetting(db, user.id, "daily_saving");
  const dailySaving = savingSetting ? parseInt(savingSetting, 10) : 0;

  // 5. Goals
  const goalsResult = await getActiveGoals(db, user.id);
  const goals = (goalsResult.results as any[]).map((g) => {
    const remaining = g.target_amount - g.saved_amount;
    const days = g.deadline_days || 30;
    return {
      name: g.name,
      dailyAmount: Math.max(0, Math.round(remaining / days)),
    };
  });

  // 6. Hitung total
  const oblTotal = obligations.reduce((s, o) => s + o.dailyAmount, 0);
  const debtTotal = debtInstallments.reduce((s, d) => s + d.dailyAmount, 0);
  const goalsTotal = goals.reduce((s, g) => s + g.dailyAmount, 0);
  const subtotal = oblTotal + debtTotal + avgOperational + dailySaving + goalsTotal;
  const buffer = Math.round(subtotal * 0.1);
  const totalTarget = subtotal + buffer;

  // 7. Progress hari ini
  const todayIncome = await getTodayIncome(db, user.id, today);
  const remaining = Math.max(0, totalTarget - todayIncome);
  const progressPercent = totalTarget > 0 ? Math.round((todayIncome / totalTarget) * 100) : 0;

  return {
    obligations,
    debtInstallments,
    avgOperational,
    dailySaving,
    goals,
    buffer,
    totalTarget,
    todayIncome,
    remaining,
    progressPercent,
  };
}

export async function getDailyTarget(
  db: D1Database,
  user: User
): Promise<ToolCallResult> {
  const breakdown = await calculateDailyTarget(db, user);
  return { type: "daily_target" as any, data: breakdown };
}

export async function setObligation(
  db: D1Database,
  user: User,
  args: { name: string; amount: number; frequency?: string; note?: string },
  sourceText: string
): Promise<ToolCallResult> {
  const amount = validateAmount(args.amount);
  if (!amount) {
    return { type: "clarification", data: null, message: "Jumlah kewajiban tidak valid. Coba lagi ya bos." };
  }

  const freq = args.frequency || "daily";
  await insertObligation(db, user.id, sanitizeString(args.name), amount, freq, args.note ? sanitizeString(args.note) : null, sourceText);

  return { type: "obligation_set" as any, data: { name: args.name, amount, frequency: freq } };
}

export async function setGoal(
  db: D1Database,
  user: User,
  args: { name: string; target_amount: number; deadline_days?: number },
  sourceText: string
): Promise<ToolCallResult> {
  const amount = validateAmount(args.target_amount);
  if (!amount) {
    return { type: "clarification", data: null, message: "Jumlah target tidak valid. Coba lagi ya bos." };
  }

  const days = args.deadline_days || 30;
  await insertGoal(db, user.id, sanitizeString(args.name), amount, days, sourceText);

  return { type: "goal_set" as any, data: { name: args.name, target_amount: amount, deadline_days: days, daily: Math.round(amount / days) } };
}

export async function setSaving(
  db: D1Database,
  user: User,
  args: { amount: number }
): Promise<ToolCallResult> {
  const amount = validateAmount(args.amount);
  if (!amount) {
    return { type: "clarification", data: null, message: "Jumlah tabungan tidak valid. Coba lagi ya bos." };
  }

  await upsertUserSetting(db, user.id, "daily_saving", String(amount));
  return { type: "saving_set" as any, data: { daily_saving: amount } };
}

/**
 * Tokenize obligation name and try fuzzy match.
 * E.g. "kewajiban gopay" → tries "kewajiban gopay", "kewajiban", "gopay"
 */
async function findObligationFuzzy(
  db: D1Database,
  userId: number,
  name: string
): Promise<{ id: number; name: string; amount: number; frequency: string } | null> {
  // 1. Try exact LIKE match first (existing behavior)
  const exact = await findObligationByName(db, userId, name);
  if (exact) return exact;

  // 2. Tokenize and try each word
  const tokens = name
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3) // skip tiny words like "ke", "di"
    .filter((t) => !["kewajiban", "cicilan", "bayar", "hapus", "selesai", "done"].includes(t)); // skip generic verbs

  for (const token of tokens) {
    const found = await findObligationByName(db, userId, token);
    if (found) return found;
  }

  return null;
}

export async function editObligation(
  db: D1Database,
  user: User,
  args: { action: string; name: string }
): Promise<ToolCallResult> {
  const obl = await findObligationFuzzy(db, user.id, args.name);
  if (!obl) {
    return { type: "clarification", data: null, message: `Kewajiban "${args.name}" tidak ditemukan. Cek lagi ya bos.` };
  }

  if (args.action === "delete" || args.action === "done") {
    await updateObligationStatus(db, obl.id, "done");
    return { type: "edited" as any, data: null, message: `Kewajiban "${obl.name}" sudah dihapus/selesai.` };
  }

  return { type: "clarification", data: null, message: "Aksi tidak dikenal." };
}

/**
 * Tokenize goal name and try fuzzy match.
 */
async function findGoalFuzzy(
  db: D1Database,
  userId: number,
  name: string
): Promise<{ id: number; name: string; target_amount: number; saved_amount: number; deadline_days: number | null } | null> {
  const exact = await findGoalByName(db, userId, name);
  if (exact) return exact;

  const tokens = name
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .filter((t) => !["goal", "target", "batal", "batalkan", "hapus", "cancel"].includes(t));

  for (const token of tokens) {
    const found = await findGoalByName(db, userId, token);
    if (found) return found;
  }

  return null;
}

export async function editGoal(
  db: D1Database,
  user: User,
  args: { action: string; name: string }
): Promise<ToolCallResult> {
  const goal = await findGoalFuzzy(db, user.id, args.name);
  if (!goal) {
    return { type: "clarification", data: null, message: `Goal "${args.name}" tidak ditemukan. Cek lagi ya bos.` };
  }

  if (args.action === "cancel") {
    await updateGoalStatus(db, goal.id, "cancelled");
    return { type: "edited" as any, data: null, message: `Goal "${goal.name}" sudah dibatalkan.` };
  }

  if (args.action === "done") {
    await updateGoalStatus(db, goal.id, "achieved");
    return { type: "edited" as any, data: null, message: `🎉 Goal "${goal.name}" tercapai!` };
  }

  return { type: "clarification", data: null, message: "Aksi tidak dikenal." };
}

/**
 * Get income progress against daily target.
 * Called after recording income to show auto-appended progress.
 *
 * Bug 7 fix: Previously ran 4 queries to check hasComponents,
 * then called calculateDailyTarget which ran the same 4 queries again
 * (10 total, 4 duplicates). Now calls calculateDailyTarget once (6 queries)
 * and checks the result.
 *
 * Trade-off: Users without any target components now run 6 queries
 * instead of 4 (early exit). But this path is rare — users who record
 * income almost always have obligations/goals set up.
 */
export async function getIncomeProgress(
  db: D1Database,
  user: User
): Promise<TargetBreakdown | null> {
  const breakdown = await calculateDailyTarget(db, user);

  // Check if user has any target components set up
  const hasComponents =
    breakdown.obligations.length > 0 ||
    breakdown.goals.length > 0 ||
    breakdown.dailySaving > 0 ||
    breakdown.debtInstallments.length > 0;

  if (!hasComponents) return null;

  return breakdown;
}
