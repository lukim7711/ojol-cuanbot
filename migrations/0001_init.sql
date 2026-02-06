-- 1. USERS
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  timezone TEXT DEFAULT 'Asia/Jakarta',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_users_telegram ON users(telegram_id);

-- 2. CATEGORIES (pre-seeded)
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  name TEXT NOT NULL,
  icon TEXT
);
CREATE UNIQUE INDEX idx_cat_type_name ON categories(type, name);

-- 3. TRANSACTIONS
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  category_id INTEGER REFERENCES categories(id),
  amount INTEGER NOT NULL,
  description TEXT,
  source_text TEXT,
  trx_date TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_trx_user_date ON transactions(user_id, trx_date);
CREATE INDEX idx_trx_user_type ON transactions(user_id, type);

-- 4. DEBTS
CREATE TABLE debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('hutang','piutang')),
  person_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','settled')),
  note TEXT,
  source_text TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  settled_at INTEGER
);
CREATE INDEX idx_debts_user_status ON debts(user_id, status);
CREATE INDEX idx_debts_person ON debts(user_id, person_name COLLATE NOCASE);

-- 5. DEBT_PAYMENTS
CREATE TABLE debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL REFERENCES debts(id),
  amount INTEGER NOT NULL,
  source_text TEXT,
  paid_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_dp_debt ON debt_payments(debt_id);

-- 6. CONVERSATION_LOGS
CREATE TABLE conversation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_conv_user_time ON conversation_logs(user_id, created_at);

-- SEED: Default categories
INSERT INTO categories (type, name, icon) VALUES
  ('income', 'orderan', '🏍️'),
  ('income', 'bonus', '🎁'),
  ('income', 'tip', '💝'),
  ('income', 'lainnya', '💰'),
  ('expense', 'makan', '🍜'),
  ('expense', 'bensin', '⛽'),
  ('expense', 'servis', '🔧'),
  ('expense', 'pulsa', '📱'),
  ('expense', 'rokok', '🚬'),
  ('expense', 'parkir', '🅿️'),
  ('expense', 'lainnya', '💸');
