// ── OBLIGATIONS ──
export async function insertObligation(
  db: D1Database,
  userId: number,
  name: string,
  amount: number,
  frequency: string,
  note: string | null,
  sourceText: string
) {
  return db
    .prepare(
      `INSERT INTO obligations (user_id, name, amount, frequency, note, source_text)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(userId, name, amount, frequency, note, sourceText)
    .first();
}

export async function getActiveObligations(db: D1Database, userId: number) {
  return db
    .prepare(
      `SELECT * FROM obligations WHERE user_id = ? AND status = 'active' ORDER BY created_at`
    )
    .bind(userId)
    .all();
}

export async function updateObligationStatus(
  db: D1Database,
  obligationId: number,
  status: string
) {
  return db
    .prepare(`UPDATE obligations SET status = ?, updated_at = unixepoch() WHERE id = ?`)
    .bind(status, obligationId)
    .run();
}

export async function findObligationByName(
  db: D1Database,
  userId: number,
  name: string
) {
  return db
    .prepare(
      `SELECT * FROM obligations 
       WHERE user_id = ? AND name LIKE ? COLLATE NOCASE AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(userId, `%${name}%`)
    .first<{ id: number; name: string; amount: number; frequency: string }>();
}

// ── GOALS ──
export async function insertGoal(
  db: D1Database,
  userId: number,
  name: string,
  targetAmount: number,
  deadlineDays: number | null,
  sourceText: string
) {
  return db
    .prepare(
      `INSERT INTO goals (user_id, name, target_amount, deadline_days, source_text)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(userId, name, targetAmount, deadlineDays, sourceText)
    .first();
}

export async function getActiveGoals(db: D1Database, userId: number) {
  return db
    .prepare(
      `SELECT * FROM goals WHERE user_id = ? AND status = 'active' ORDER BY created_at`
    )
    .bind(userId)
    .all();
}

export async function updateGoalSaved(
  db: D1Database,
  goalId: number,
  addAmount: number
) {
  return db
    .prepare(
      `UPDATE goals SET saved_amount = saved_amount + ?, updated_at = unixepoch() WHERE id = ?`
    )
    .bind(addAmount, goalId)
    .run();
}

export async function updateGoalStatus(
  db: D1Database,
  goalId: number,
  status: string
) {
  return db
    .prepare(`UPDATE goals SET status = ?, updated_at = unixepoch() WHERE id = ?`)
    .bind(status, goalId)
    .run();
}

export async function findGoalByName(
  db: D1Database,
  userId: number,
  name: string
) {
  return db
    .prepare(
      `SELECT * FROM goals 
       WHERE user_id = ? AND name LIKE ? COLLATE NOCASE AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(userId, `%${name}%`)
    .first<{ id: number; name: string; target_amount: number; saved_amount: number; deadline_days: number | null }>();
}

// ── USER SETTINGS ──
export async function getUserSetting(
  db: D1Database,
  userId: number,
  key: string
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = ?`
    )
    .bind(userId, key)
    .first<{ setting_value: string }>();
  return row?.setting_value ?? null;
}

export async function upsertUserSetting(
  db: D1Database,
  userId: number,
  key: string,
  value: string
) {
  return db
    .prepare(
      `INSERT INTO user_settings (user_id, setting_key, setting_value)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, setting_key) DO UPDATE SET setting_value = ?, updated_at = unixepoch()`
    )
    .bind(userId, key, value, value)
    .run();
}

// ── HELPER: Get average daily expense (last 7 days) ──
export async function getAverageDailyExpense(
  db: D1Database,
  userId: number,
  startDate: string,
  endDate: string
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(DISTINCT trx_date) as days
       FROM transactions
       WHERE user_id = ? AND type = 'expense' AND trx_date BETWEEN ? AND ?`
    )
    .bind(userId, startDate, endDate)
    .first<{ total: number; days: number }>();

  if (!result || result.days === 0) return 0;
  return Math.round(result.total / result.days);
}

// ── HELPER: Get today's total income ──
export async function getTodayIncome(
  db: D1Database,
  userId: number,
  todayDate: string
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE user_id = ? AND type = 'income' AND trx_date = ?`
    )
    .bind(userId, todayDate)
    .first<{ total: number }>();

  return result?.total ?? 0;
}
