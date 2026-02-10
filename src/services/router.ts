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
import { getPendingDelete, setPendingDelete, clearPendingDelete } from "./deleteConfirm";

/**
 * Whitelist of allowed tool names.
 * Any tool call with a name NOT in this list is silently dropped.
 * This prevents the AI from calling tools that don't exist
 * or were injected through prompt manipulation.
 */
const ALLOWED_TOOLS = new Set([
  "record_transactions",
  "record_debt",
  "pay_debt",
  "get_summary",
  "get_debts",
  "get_debt_history",
  "edit_transaction",
  "ask_clarification",
  "edit_debt",
  "get_daily_target",
  "set_obligation",
  "set_goal",
  "set_saving",
  "edit_obligation",
  "edit_goal",
]);

export async function processToolCalls(
  db: D1Database,
  user: User,
  toolCalls: Array<{ name: string; arguments: any }>,
  sourceText: string,
  kv: KVNamespace
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];
  let hasIncome = false;

  // ============================================
  // CHECK: Is this a confirmation reply? ("ya" / "batal")
  // ============================================
  const lowerSource = sourceText.toLowerCase().trim();
  const pending = await getPendingDelete(kv, String(user.id));

  if (pending) {
    if (lowerSource === "ya" || lowerSource === "iya" || lowerSource === "yes" || lowerSource === "y") {
      // User confirmed — execute the pending delete
      await clearPendingDelete(kv, String(user.id));

      if (pending.type === "transaction") {
        results.push(await editOrDeleteTransaction(db, user, pending.args));
      } else if (pending.type === "debt") {
        results.push(await editDebt(db, user, pending.args));
      }
      return results;
    } else if (lowerSource === "batal" || lowerSource === "cancel" || lowerSource === "tidak" || lowerSource === "no" || lowerSource === "n" || lowerSource === "ga" || lowerSource === "gak" || lowerSource === "nggak") {
      // User cancelled
      await clearPendingDelete(kv, String(user.id));
      results.push({ type: "clarification", data: null, message: "✅ Oke, dibatalin. Data lo aman." });
      return results;
    } else {
      // User sent something else — clear pending and process normally
      await clearPendingDelete(kv, String(user.id));
    }
  }

  for (const call of toolCalls) {
    // ============================================
    // SECURITY: Block unknown/injected tool names
    // ============================================
    if (!ALLOWED_TOOLS.has(call.name)) {
      console.warn(`[Security] Blocked unknown tool call: "${call.name}". Skipping.`);
      continue;
    }

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

      case "edit_transaction": {
        // ============================================
        // DELETE CONFIRMATION: Ask before deleting
        // ============================================
        if (call.arguments.action === "delete") {
          // Store pending delete, ask for confirmation
          await setPendingDelete(kv, String(user.id), {
            type: "transaction",
            args: call.arguments,
            description: call.arguments.target || "transaksi terakhir",
          });
          results.push({
            type: "clarification",
            data: null,
            message: `🗑️ Mau hapus transaksi <b>${call.arguments.target || "terakhir"}</b>?\n\nBalas <b>ya</b> untuk konfirmasi atau <b>batal</b> untuk cancel.`,
          });
        } else {
          // Edit (not delete) — no confirmation needed
          results.push(await editOrDeleteTransaction(db, user, call.arguments));
        }
        break;
      }

      case "ask_clarification":
        results.push({ type: "clarification", data: null, message: call.arguments.message });
        break;

      case "edit_debt": {
        // ============================================
        // DELETE CONFIRMATION: Ask before deleting debt
        // ============================================
        if (call.arguments.action === "delete") {
          await setPendingDelete(kv, String(user.id), {
            type: "debt",
            args: call.arguments,
            description: call.arguments.person_name || "hutang",
          });
          results.push({
            type: "clarification",
            data: null,
            message: `🗑️ Mau hapus hutang <b>${call.arguments.person_name || ""}</b>?\n\nBalas <b>ya</b> untuk konfirmasi atau <b>batal</b> untuk cancel.`,
          });
        } else {
          results.push(await editDebt(db, user, call.arguments));
        }
        break;
      }

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
