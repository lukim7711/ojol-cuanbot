import { User } from "../types/transaction";

// ── USER ──
export async function findUserByTelegram(db: D1Database, telegramId: string) {
  return db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .bind(telegramId)
    .first<User>();
}

export async function createUser(
  db: D1Database,
  telegramId: string,
  displayName: string
) {
  return db
    .prepare(
      "INSERT INTO users (telegram_id, display_name) VALUES (?, ?) RETURNING *"
    )
    .bind(telegramId, displayName)
    .first<User>();
}

// ── TRANSACTIONS ──
export async function insertTransaction(
  db: D1Database,
  userId: number,
  type: string,
  categoryId: number | null,
  amount: number,
  description: string,
  sourceText: string,
  trxDate: string
) {
  return db
    .prepare(
      `INSERT INTO transactions (user_id, type, category_id, amount, description, source_text, trx_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(userId, type, categoryId, amount, description, sourceText, trxDate)
    .run();
}

export async function findCategoryByName(
  db: D1Database,
  type: string,
  name: string
) {
  return db
    .prepare("SELECT id FROM categories WHERE type = ? AND name = ?")
    .bind(type, name)
    .first<{ id: number }>();
}

// ── DEBTS ──
export async function insertDebt(
  db: D1Database,
  userId: number,
  type: string,
  personName: string,
  amount: number,
  remaining: number,
  note: string | null,
  sourceText: string,
  dueDate: string | null,
  interestRate: number,
  interestType: string,
  tenorMonths: number | null,
  installmentAmount: number | null,
  installmentFreq: string,
  nextPaymentDate: string | null,
  totalWithInterest: number | null
) {
  return db
    .prepare(
      `INSERT INTO debts (user_id, type, person_name, amount, remaining, note, source_text,
       due_date, interest_rate, interest_type, tenor_months, installment_amount,
       installment_freq, next_payment_date, total_with_interest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      userId, type, personName, amount, remaining, note, sourceText,
      dueDate, interestRate, interestType, tenorMonths, installmentAmount,
      installmentFreq, nextPaymentDate, totalWithInterest
    )
    .run();
}

export async function findActiveDebtByPerson(
  db: D1Database,
  userId: number,
  personName: string
) {
  return db
    .prepare(
      `SELECT * FROM debts 
       WHERE user_id = ? AND person_name = ? COLLATE NOCASE AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(userId, personName)
    .first<{
      id: number;
      type: string;
      person_name: string;
      remaining: number;
      amount: number;
      due_date: string | null;
      interest_rate: number;
      interest_type: string;
      tenor_months: number | null;
      installment_amount: number | null;
      installment_freq: string;
      next_payment_date: string | null;
      total_with_interest: number | null;
    }>();
}

export async function updateDebtRemaining(
  db: D1Database,
  debtId: number,
  newRemaining: number
) {
  const status = newRemaining <= 0 ? "settled" : "active";
  const settledAt = newRemaining <= 0 ? Math.floor(Date.now() / 1000) : null;

  return db
    .prepare(
      `UPDATE debts SET remaining = ?, status = ?, settled_at = ? WHERE id = ?`
    )
    .bind(newRemaining, status, settledAt, debtId)
    .run();
}

export async function updateDebtNextPayment(
  db: D1Database,
  debtId: number,
  nextPaymentDate: string | null
) {
  return db
    .prepare(`UPDATE debts SET next_payment_date = ? WHERE id = ?`)
    .bind(nextPaymentDate, debtId)
    .run();
}

export async function insertDebtPayment(
  db: D1Database,
  debtId: number,
  amount: number,
  sourceText: string
) {
  return db
    .prepare(
      "INSERT INTO debt_payments (debt_id, amount, source_text) VALUES (?, ?, ?)"
    )
    .bind(debtId, amount, sourceText)
    .run();
}

export async function getDebtPayments(
  db: D1Database,
  debtId: number
) {
  return db
    .prepare(
      `SELECT amount, paid_at FROM debt_payments WHERE debt_id = ? ORDER BY paid_at ASC`
    )
    .bind(debtId)
    .all<{ amount: number; paid_at: number }>();
}

// ── SUMMARY ──
export async function getTransactionsByDateRange(
  db: D1Database,
  userId: number,
  startDate: string,
  endDate: string
) {
  return db
    .prepare(
      `SELECT type, category_id, amount, description, trx_date
       FROM transactions
       WHERE user_id = ? AND trx_date BETWEEN ? AND ?
       ORDER BY trx_date, created_at`
    )
    .bind(userId, startDate, endDate)
    .all();
}

export async function getActiveDebts(
  db: D1Database,
  userId: number,
  type?: string
) {
  const query =
    type && type !== "all"
      ? `SELECT * FROM debts WHERE user_id = ? AND status = 'active' AND type = ? ORDER BY created_at`
      : `SELECT * FROM debts WHERE user_id = ? AND status = 'active' ORDER BY type, created_at`;

  const stmt =
    type && type !== "all"
      ? db.prepare(query).bind(userId, type)
      : db.prepare(query).bind(userId);

  return stmt.all();
}

// ── CONVERSATION LOGS ──
export async function getRecentConversation(
  db: D1Database,
  userId: number,
  limit = 6
) {
  const result = await db
    .prepare(
      `SELECT role, content FROM conversation_logs 
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .bind(userId, limit)
    .all<{ role: string; content: string }>();

  return result.results.reverse();
}

export async function saveConversation(
  db: D1Database,
  userId: number,
  role: string,
  content: string
) {
  return db
    .prepare(
      "INSERT INTO conversation_logs (user_id, role, content) VALUES (?, ?, ?)"
    )
    .bind(userId, role, content)
    .run();
}

// ── EDIT/DELETE ──
export async function findRecentTransactionByDescription(
  db: D1Database,
  userId: number,
  target: string
) {
  return db
    .prepare(
      `SELECT id, amount, description FROM transactions 
       WHERE user_id = ? AND description LIKE ? 
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(userId, `%${target}%`)
    .first<{ id: number; amount: number; description: string }>();
}

export async function updateTransactionAmount(
  db: D1Database,
  trxId: number,
  newAmount: number
) {
  return db
    .prepare("UPDATE transactions SET amount = ? WHERE id = ?")
    .bind(newAmount, trxId)
    .run();
}

export async function deleteTransaction(db: D1Database, trxId: number) {
  return db.prepare("DELETE FROM transactions WHERE id = ?").bind(trxId).run();
}
