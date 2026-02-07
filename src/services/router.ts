import { recordTransactions } from "./transaction";
import { recordDebt, payDebt, getDebtsList, getDebtHistory } from "./debt";
import { getSummary } from "./summary";
import { editOrDeleteTransaction } from "./edit";
import { User, ToolCallResult } from "../types/transaction";
import { editDebt } from "./edit-debt";
import {
  getDailyTarget,
  setObligation,
  setGoal,
  setSaving,
  editObligation,
  editGoal,
  getIncomeProgress,
} from "./target";
import { formatTargetProgress } from "../utils/formatter";

export async function processToolCalls(
  db: D1Database,
  user: User,
  toolCalls: Array<{ name: string; arguments: any }>,
  sourceText: string
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];
  let hasIncome = false;

  for (const call of toolCalls) {
    switch (call.name) {
      case "record_transactions": {
        const result = await recordTransactions(db, user, call.arguments, sourceText);
        results.push(result);
        if (result.data && result.data.some((t: any) => t.type === "income")) {
          hasIncome = true;
        }
        break;
      }

      case "record_debt":
        results.push(await recordDebt(db, user, call.arguments, sourceText));
        break;

      case "pay_debt":
        results.push(await payDebt(db, user, call.arguments, sourceText));
        break;

      case "get_summary":
        results.push(await getSummary(db, user, call.arguments));
        break;

      case "get_debts":
        results.push(await getDebtsList(db, user, call.arguments));
        break;

      case "edit_transaction":
        results.push(await editOrDeleteTransaction(db, user, call.arguments));
        break;

      case "ask_clarification":
        results.push({ type: "clarification", data: null, message: call.arguments.message });
        break;

      case "edit_debt":
        results.push(await editDebt(db, user, call.arguments));
        break;

      case "get_daily_target":
        results.push(await getDailyTarget(db, user));
        break;

      case "set_obligation":
        results.push(await setObligation(db, user, call.arguments, sourceText));
        break;

      case "set_goal":
        results.push(await setGoal(db, user, call.arguments, sourceText));
        break;

      case "set_saving":
        results.push(await setSaving(db, user, call.arguments));
        break;

      case "edit_obligation":
        results.push(await editObligation(db, user, call.arguments));
        break;

      case "edit_goal":
        results.push(await editGoal(db, user, call.arguments));
        break;

      case "get_debt_history":
        results.push(await getDebtHistory(db, user, call.arguments));
        break;

      default:
        break;
    }
  }

  // Auto-append target progress after income
  if (hasIncome) {
    try {
      const progress = await getIncomeProgress(db, user);
      if (progress) {
        const progressText = formatTargetProgress(progress);
        if (progressText) {
          const lastTrx = results.find((r) => r.type === "transactions_recorded");
          if (lastTrx) {
            lastTrx.message = (lastTrx.message || "") + progressText;
          }
        }
      }
    } catch (e) {
      console.error("[Target] Failed to calculate progress:", e);
    }
  }

  return results;
}
