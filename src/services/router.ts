import { recordTransactions } from "./transaction";
import { recordDebt, payDebt, getDebtsList } from "./debt";
import { getSummary } from "./summary";
import { editOrDeleteTransaction } from "./edit";
import { User, ToolCallResult } from "../types/transaction";
// Tambahkan import
import { editDebt } from "./edit-debt";

export async function processToolCalls(
  db: D1Database,
  user: User,
  toolCalls: Array<{ name: string; arguments: any }>,
  sourceText: string
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];

  for (const call of toolCalls) {
    switch (call.name) {
      case "record_transactions":
        results.push(
          await recordTransactions(db, user, call.arguments, sourceText)
        );
        break;

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
        results.push(
          await editOrDeleteTransaction(db, user, call.arguments)
        );
        break;

      case "ask_clarification":
        results.push({
          type: "clarification",
          data: null,
          message: call.arguments.message,
        });
        break;

      case "edit_debt":
        results.push(await editDebt(db, user, call.arguments));
        break;

      default:
        // Unknown tool — ignore
        break;
    }
  }

  return results;
}
