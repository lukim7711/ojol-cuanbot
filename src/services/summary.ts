import { getTransactionsByDateRange } from "../db/repository";
import { getDateRange } from "../utils/date";
import { User, ToolCallResult } from "../types/transaction";

const PERIOD_LABELS: Record<string, string> = {
  today: "Hari Ini",
  yesterday: "Kemarin",
  this_week: "Minggu Ini",
  this_month: "Bulan Ini",
};

export async function getSummary(
  db: D1Database,
  user: User,
  args: { period: string; custom_start?: string; custom_end?: string }
): Promise<ToolCallResult> {
  let start: string, end: string;

  if (args.period === "custom" && args.custom_start && args.custom_end) {
    start = args.custom_start;
    end = args.custom_end;
  } else {
    const range = getDateRange(args.period);
    start = range.start;
    end = range.end;
  }

  const result = await getTransactionsByDateRange(db, user.id, start, end);
  const rows = result.results as any[];

  let totalIncome = 0;
  let totalExpense = 0;
  const details: any[] = [];

  for (const row of rows) {
    if (row.type === "income") totalIncome += row.amount;
    else totalExpense += row.amount;
    details.push({
      type: row.type,
      amount: row.amount,
      description: row.description,
    });
  }

  return {
    type: "summary",
    data: {
      periodLabel: PERIOD_LABELS[args.period] ?? `${start} s/d ${end}`,
      totalIncome,
      totalExpense,
      details,
    },
  };
}
