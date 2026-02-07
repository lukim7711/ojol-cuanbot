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
import { getDateFromOffset } from "../utils/date";
import { validateAmount } from "../utils/validator";
import { sanitizeString } from "../utils/validator";
import { User, ToolCallResult } from "../types/transaction";

export interface TargetBreakdown {
  obligations: Array<{ name: string; dailyAmount: number }>;
  debtInstallments: Array<{ name: string; dailyAmount: number }>;
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

  // 2. Cicilan hutang aktif (bagi rata sisa hutang / 30 hari default)
  const debtResult = await getActiveDebts(db, user.id);
  const debtInstallments = (debtResult.results as any[]).map((d) => ({
    name: `Hutang ${d.person_name}`,
    dailyAmount: Math.round(d.remaining / 30),
  }));

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

/**
 * Handle get_daily_target tool call
 */
export async function getDailyTarget(
  db: D1Database,
  user: User
): Promise<ToolCallResult> {
  const breakdown = await calculateDailyTarget(db, user);
  return { type: "daily_target" as any, data: breakdown };
}

/**
 * Handle set_obligation tool call
 */
export async function setObligation(
  db: D1Database,
  user: User,
  args: { name: string; amount: number; frequency?: string; note?: string },
  sourceText: string
): Promise<ToolCallResult> {
  const amount = validateAmount(args.amount);
  if (!amount) {
    return {
      type: "clarification",
      data: null,
      message: "Jumlah kewajiban tidak valid. Coba lagi ya bos.",
    };
  }

  const freq = args.frequency || "daily";
  const result = await insertObligation(
    db, user.id,
    sanitizeString(args.name),
    amount,
    freq,
    args.note ? sanitizeString(args.note) : null,
    sourceText
  );

  return {
    type: "obligation_set" as any,
    data: { name: args.name, amount, frequency: freq },
  };
}

/**
 * Handle set_goal tool call
 */
export async function setGoal(
  db: D1Database,
  user: User,
  args: { name: string; target_amount: number; deadline_days?: number },
  sourceText: string
): Promise<ToolCallResult> {
  const amount = validateAmount(args.target_amount);
  if (!amount) {
    return {
      type: "clarification",
      data: null,
      message: "Jumlah target tidak valid. Coba lagi ya bos.",
    };
  }

  const days = args.deadline_days || 30;
  const result = await insertGoal(
    db, user.id,
    sanitizeString(args.name),
    amount,
    days,
    sourceText
  );

  return {
    type: "goal_set" as any,
    data: { name: args.name, target_amount: amount, deadline_days: days, daily: Math.round(amount / days) },
  };
}

/**
 * Handle set_saving tool call
 */
export async function setSaving(
  db: D1Database,
  user: User,
  args: { amount: number }
): Promise<ToolCallResult> {
  const amount = validateAmount(args.amount);
  if (!amount) {
    return {
      type: "clarification",
      data: null,
      message: "Jumlah tabungan tidak valid. Coba lagi ya bos.",
    };
  }

  await upsertUserSetting(db, user.id, "daily_saving", String(amount));

  return {
    type: "saving_set" as any,
    data: { daily_saving: amount },
  };
}

/**
 * Handle edit_obligation tool call
 */
export async function editObligation(
  db: D1Database,
  user: User,
  args: { action: string; name: string; new_amount?: number }
): Promise<ToolCallResult> {
  const obl = await findObligationByName(db, user.id, args.name);
  if (!obl) {
    return {
      type: "clarification",
      data: null,
      message: `Kewajiban "${args.name}" tidak ditemukan. Cek lagi ya bos.`,
    };
  }

  if (args.action === "delete" || args.action === "done") {
    await updateObligationStatus(db, obl.id, "done");
    return {
      type: "edited" as any,
      data: null,
      message: `Kewajiban "${obl.name}" sudah dihapus/selesai.`,
    };
  }

  return { type: "clarification", data: null, message: "Aksi tidak dikenal." };
}

/**
 * Handle edit_goal tool call
 */
export async function editGoal(
  db: D1Database,
  user: User,
  args: { action: string; name: string }
): Promise<ToolCallResult> {
  const goal = await findGoalByName(db, user.id, args.name);
  if (!goal) {
    return {
      type: "clarification",
      data: null,
      message: `Goal "${args.name}" tidak ditemukan. Cek lagi ya bos.`,
    };
  }

  if (args.action === "cancel") {
    await updateGoalStatus(db, goal.id, "cancelled");
    return {
      type: "edited" as any,
      data: null,
      message: `Goal "${goal.name}" sudah dibatalkan.`,
    };
  }

  if (args.action === "done") {
    await updateGoalStatus(db, goal.id, "achieved");
    return {
      type: "edited" as any,
      data: null,
      message: `🎉 Goal "${goal.name}" tercapai!`,
    };
  }

  return { type: "clarification", data: null, message: "Aksi tidak dikenal." };
}

/**
 * Get income progress for auto-display after recording income
 */
export async function getIncomeProgress(
  db: D1Database,
  user: User
): Promise<TargetBreakdown | null> {
  // Only show progress if user has any target components set up
  const oblResult = await getActiveObligations(db, user.id);
  const goalsResult = await getActiveGoals(db, user.id);
  const savingSetting = await getUserSetting(db, user.id, "daily_saving");
  const debtResult = await getActiveDebts(db, user.id);

  const hasComponents =
    oblResult.results.length > 0 ||
    goalsResult.results.length > 0 ||
    (savingSetting && parseInt(savingSetting) > 0) ||
    debtResult.results.length > 0;

  if (!hasComponents) return null;

  return calculateDailyTarget(db, user);
}
