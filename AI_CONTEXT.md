# AI_CONTEXT.md — CuanBot Project Context

> **INSTRUKSI UNTUK AI**: File ini berisi seluruh konteks project CuanBot.
> Ketika user memulai percakapan baru dan meminta kamu membaca file ini,
> gunakan SEMUA informasi di bawah sebagai konteks kerja.
> Selalu update file ini setelah menambah fitur baru atau melakukan perubahan signifikan.

---

## 1. Overview Aplikasi

**CuanBot** adalah bot Telegram AI untuk manajemen keuangan harian driver ojek online Indonesia.

- **Target user**: Driver ojol (Grab, Gojek, Maxim, dll)
- **Platform**: Telegram Bot
- **Interaksi**: Chat natural Bahasa Indonesia (informal, slang, singkatan)
- **Bot username**: @ojol_finance_bot
- **Bot name**: Ojol Finance Assistant

### Value Proposition
Driver ojol bisa catat pemasukan/pengeluaran, hutang, dan target harian cukup dengan chat biasa — tanpa buka app keuangan ribet.

---

## 2. Tech Stack

| Layer | Teknologi | Detail |
|-------|-----------|--------|
| Runtime | Cloudflare Workers | Serverless, edge-deployed, entry: `src/index.ts` |
| Bot Framework | grammY v1.39+ | TypeScript-first, webhook mode |
| AI/NLP | Workers AI (Qwen3-30B-A3B) | OpenAI-compatible, function calling (tool_use) |
| Database | Cloudflare D1 (SQLite) | Binding: `DB`, name: `cuanbot-db` |
| Language | TypeScript strict | tsconfig strict mode |
| Testing | Vitest + @cloudflare/vitest-pool-workers | Workers-compatible test runner |
| CI/CD | GitHub Actions | CI: test on push/PR; CD: auto deploy on push to main |
| Config | wrangler.jsonc | compatibility_date: 2026-02-05 |

### Environment & Secrets
- `DB` — D1 database binding
- `AI` — Workers AI binding
- `TELEGRAM_BOT_TOKEN` — secret
- `AI_API_KEY` — secret
- `BOT_INFO` — JSON string di vars

---

## 3. Arsitektur

```
Telegram → Webhook → Cloudflare Worker
                         |
                    grammY Bot
                         |
                  Message Handler
                         |
                    AI Engine (src/ai/engine.ts)
                    - System prompt (src/ai/prompt.ts)
                    - Tool definitions (src/ai/tools.ts)
                    - Function calling + <think> tag stripping
                         |
                    Service Router (src/services/router.ts)
                    ├── transaction.ts  → record/get transactions
                    ├── debt.ts         → record/pay/list/history debts
                    ├── edit.ts         → edit/delete transactions
                    ├── edit-debt.ts    → edit/delete debts
                    ├── summary.ts      → rekap keuangan
                    ├── target.ts       → smart daily target
                    └── user.ts         → get/create user
                         |
                    Repository Layer (src/db/repository.ts, repository-target.ts)
                         |
                    Cloudflare D1 (SQLite)
```

### Flow per message:
1. User kirim chat di Telegram
2. grammY menerima via webhook
3. `/start` → handler `start.ts` (onboarding); pesan biasa → `message.ts`
4. Message handler kirim ke AI Engine dengan system prompt + conversation history
5. AI Engine memanggil Workers AI, parse response (strip `<think>` tags dari Qwen3), extract tool calls
6. Router mengeksekusi tool call → service → repository → D1
7. Result diformat oleh `formatter.ts` → dikirim balik ke user

---

## 4. Struktur Folder

```
ojol-cuanbot/
├── src/
│   ├── index.ts              # CF Worker entry, webhook route, health check
│   ├── bot.ts                # grammY bot instance setup
│   ├── ai/
│   │   ├── engine.ts         # Workers AI wrapper, response parsing, <think> strip
│   │   ├── prompt.ts         # System prompt lengkap (rules, examples)
│   │   └── tools.ts          # AI tool/function definitions
│   ├── config/
│   │   └── env.ts            # Env type definitions
│   ├── db/
│   │   ├── repository.ts     # Core queries (users, transactions, debts, conversation)
│   │   └── repository-target.ts  # Target queries (obligations, goals, settings)
│   ├── handlers/
│   │   ├── start.ts          # /start command handler (onboarding)
│   │   └── message.ts        # Telegram message → AI → response pipeline
│   ├── services/
│   │   ├── router.ts         # Tool call dispatcher
│   │   ├── transaction.ts    # Income/expense recording
│   │   ├── debt.ts           # Hutang: record, pay, list, history, interest, overdue
│   │   ├── edit.ts           # Edit/delete transactions
│   │   ├── edit-debt.ts      # Edit/delete debts
│   │   ├── summary.ts        # Rekap: today, yesterday, this_week, this_month
│   │   ├── target.ts         # Smart daily target calculation
│   │   └── user.ts           # Get or create user
│   ├── types/
│   │   ├── transaction.ts    # User, ParsedTransaction, ToolCallResult, etc.
│   │   └── ai-response.ts    # ToolCall, AIResult interfaces
│   └── utils/
│       ├── formatter.ts      # Telegram HTML response builder (14KB, handles all result types)
│       ├── date.ts           # Date utils (WIB timezone, offset, range)
│       └── validator.ts      # Amount validation, HTML string sanitization
├── migrations/
│   ├── 0001_init.sql         # users, transactions, categories, debts, debt_payments, conversation_logs
│   ├── 0002_smart_target.sql # obligations, goals, user_settings
│   └── 0003_smart_debt.sql   # ALTER debts: +8 columns (due_date, interest, installment)
├── test/
│   ├── index.spec.ts         # Worker entry point tests (3 tests)
│   ├── env.d.ts              # Test environment type declarations
│   ├── tsconfig.json         # Test-specific tsconfig
│   ├── services/
│   │   ├── transaction.spec.ts  # Transaction recording tests (15 tests)
│   │   ├── debt.spec.ts         # Smart debt tests (~12 tests)
│   │   ├── router.spec.ts       # Tool call dispatch tests (11 tests)
│   │   └── target.spec.ts       # Smart target calculation tests
│   └── utils/
│       ├── validator.spec.ts    # validateAmount + sanitizeString (19 tests)
│       ├── date.spec.ts         # getDateFromOffset + getDateRange (12 tests)
│       └── formatter.spec.ts    # formatRupiah + formatReply (19 tests)
├── .github/workflows/
│   ├── ci.yml                # CI: test on push/PR to main
│   └── deploy.yml            # CD: auto deploy on push to main
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── vitest.config.mts
└── worker-configuration.d.ts
```

---

## 5. Database Schema (Lengkap)

### Migration 0001: Core
```sql
-- users: Telegram user mapping
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  timezone TEXT DEFAULT 'Asia/Jakarta',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- categories: Pre-seeded income/expense categories
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  name TEXT NOT NULL,
  icon TEXT
);
-- Seeded: orderan, bonus, tip, lainnya (income), makan, bensin, servis, pulsa, rokok, parkir, lainnya (expense)

-- transactions: All income & expense records
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  category_id INTEGER REFERENCES categories(id),
  amount INTEGER NOT NULL,
  description TEXT,
  source_text TEXT,
  trx_date TEXT NOT NULL,  -- format: YYYY-MM-DD
  created_at INTEGER DEFAULT (unixepoch())
);

-- debts: Hutang & piutang (enhanced with smart debt columns)
CREATE TABLE debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('hutang','piutang')),
  person_name TEXT NOT NULL,
  amount INTEGER NOT NULL,          -- pokok
  remaining INTEGER NOT NULL,       -- sisa (bisa < amount untuk hutang lama)
  status TEXT DEFAULT 'active',
  note TEXT,
  source_text TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  settled_at INTEGER,
  -- Smart Debt columns (migration 0003)
  due_date TEXT,                    -- YYYY-MM-DD, final due date
  interest_rate REAL DEFAULT 0,     -- decimal (0.02 = 2%)
  interest_type TEXT DEFAULT 'none', -- 'none', 'flat', 'daily'
  tenor_months INTEGER,             -- jumlah bulan cicilan
  installment_amount INTEGER,       -- nominal per cicilan
  installment_freq TEXT DEFAULT 'monthly', -- 'daily', 'weekly', 'monthly'
  next_payment_date TEXT,           -- YYYY-MM-DD, tanggal cicilan berikutnya
  total_with_interest INTEGER       -- total bayar (pokok + bunga)
);

-- debt_payments: Riwayat pembayaran per hutang
CREATE TABLE debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL REFERENCES debts(id),
  amount INTEGER NOT NULL,
  source_text TEXT,
  paid_at INTEGER DEFAULT (unixepoch())
);

-- conversation_logs: Chat history untuk AI context
CREATE TABLE conversation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);
```

### Migration 0002: Smart Target
```sql
-- obligations: Kewajiban tetap (cicilan, kontrakan, iuran)
CREATE TABLE obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK(frequency IN ('daily','weekly','monthly')),
  status TEXT DEFAULT 'active',
  note TEXT,
  source_text TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- goals: Target nabung untuk beli sesuatu
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  target_amount INTEGER NOT NULL,
  saved_amount INTEGER NOT NULL DEFAULT 0,
  deadline_days INTEGER,
  status TEXT DEFAULT 'active',
  source_text TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- user_settings: Key-value settings (daily_saving, dll)
CREATE TABLE user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);
```

---

## 6. Fitur — Status Implementasi

### ✅ DONE (Production)

#### 6.1 Catat Transaksi (NLP)
- Input natural: "dapet 120rb, makan 25rb, bensin 30rb"
- Parsing: rb/ribu, k, jt/juta, ceban, goceng, gocap, seceng, setengah
- Kategori otomatis: orderan, makan, bensin, dll
- Date offset: hari ini, kemarin, 2 hari lalu
- Multi transaksi dalam 1 pesan
- Auto-progress bar setelah catat income
- Service: `src/services/transaction.ts`

#### 6.2 Hutang & Piutang (Smart Debt)
- Catat hutang/piutang ke seseorang
- **Jatuh tempo**: tanggal absolut, offset hari, tanggal berulang (recurring_day)
- **Bunga**: flat (per bulan), daily (per hari)
- **Cicilan & tenor**: auto-calculate cicilan, tracking payment number
- **Hutang lama**: input hutang yang sudah berjalan (amount vs remaining berbeda)
- **Overdue detection**: TELAT X HARI, urgent (≤3 hari), soon (≤7 hari)
- **Bayar hutang**: auto-update remaining, next_payment_date
- **Riwayat pembayaran**: list semua payment per hutang
- **List hutang**: sorted by urgency (overdue → urgent → normal)
- Service: `src/services/debt.ts`

#### 6.3 Smart Daily Target
- Komponen: obligations + debt installments + avg operational + savings + goals + buffer 10%
- **Obligations**: kewajiban tetap (cicilan gopay, kontrakan, dll) — daily/weekly/monthly
- **Debt integration**: hutang overdue = full amount, hutang cicilan = dibagi per hari
- **Avg operational**: rata-rata pengeluaran 7 hari terakhir
- **Savings**: tabungan harian minimum
- **Goals**: target nabung dibagi sisa hari
- **Progress bar**: otomatis muncul setiap catat income
- Service: `src/services/target.ts`

#### 6.4 Rekap Keuangan
- Period: today, yesterday, this_week, this_month
- Total income, expense, net
- Detail per transaksi
- Service: `src/services/summary.ts`

#### 6.5 Edit & Hapus
- Edit transaksi (ubah jumlah/deskripsi)
- Hapus transaksi
- Edit hutang
- Service: `src/services/edit.ts`, `src/services/edit-debt.ts`

#### 6.6 /start Command
- Onboarding flow untuk user baru
- Auto-create user di database
- Handler: `src/handlers/start.ts`

#### 6.7 AI Engine
- Workers AI (Qwen3-30B-A3B) wrapper
- `<think>` tag stripping (Qwen3 quirk)
- Robust argument parsing (string → object)
- OpenAI-compatible API format
- Engine: `src/ai/engine.ts`

#### 6.8 CI/CD
- **CI**: GitHub Actions — test on push/PR to main (`.github/workflows/ci.yml`)
- **CD**: GitHub Actions — auto deploy to Cloudflare Workers on push to main (`.github/workflows/deploy.yml`)

### 🔲 PLANNED (Roadmap)

- [ ] Potongan platform otomatis (Grab 20%, Gojek 20%, ShopeeFood 20%)
- [ ] Multi-user support (isolasi data per telegram user)
- [ ] Notifikasi/reminder jatuh tempo hutang (scheduled worker)
- [ ] Export data (PDF/CSV rekap bulanan)
- [ ] Dashboard web dengan grafik (analytics)
- [ ] `/help` command — panduan lengkap penggunaan
- [ ] `/reset` command — clear conversation history
- [ ] `/rekap` command — shortcut rekap hari ini
- [ ] `/target` command — shortcut lihat target harian

---

## 7. AI Tools (Function Definitions)

Tool yang tersedia untuk AI di `src/ai/tools.ts`:

| Tool Name | Fungsi | Key Args |
|-----------|--------|----------|
| `record_transactions` | Catat income/expense | `transactions[]`: {type, amount, category, description, date_offset} |
| `record_debt` | Catat hutang/piutang baru | `type, person_name, amount, remaining?, due_date?, due_date_days?, recurring_day?, interest_rate?, interest_type?, tenor_months?, installment_amount?, installment_freq?` |
| `pay_debt` | Bayar hutang | `person_name, amount` |
| `get_debts` | List hutang aktif | `type`: "hutang"/"piutang"/"all" |
| `get_debt_history` | Riwayat pembayaran hutang | `person_name` |
| `get_summary` | Rekap keuangan | `period`: "today"/"yesterday"/"this_week"/"this_month" |
| `set_obligation` | Set kewajiban tetap | `name, amount, frequency` |
| `edit_obligation` | Edit/hapus kewajiban | `name, action`: "update"/"done" |
| `set_goal` | Set goal nabung | `name, target_amount, deadline_days` |
| `edit_goal` | Edit/batal goal | `name, action`: "update"/"cancel" |
| `set_saving` | Set tabungan harian | `daily_saving` |
| `get_daily_target` | Hitung target harian | (no args) |
| `edit_transaction` | Edit/hapus transaksi | `description, action, new_amount?` |
| `edit_debt` | Edit hutang | `person_name, action, new_amount?` |
| `ask_clarification` | Minta klarifikasi | `question` |

---

## 8. Coding Conventions

### Pattern yang digunakan:
- **Repository pattern**: DB queries di `src/db/repository.ts` dan `repository-target.ts`
- **Service layer**: Business logic di `src/services/*.ts`
- **Router pattern**: Tool call dispatch di `src/services/router.ts`
- **Formatter**: Semua response formatting di `src/utils/formatter.ts` (Telegram HTML)
- **ToolCallResult**: Semua service return `{ type, data, message? }`

### Konvensi:
- Amount selalu dalam INTEGER (Rupiah penuh, bukan desimal)
- Tanggal format: `YYYY-MM-DD` (string)
- Timestamp: `unixepoch()` (integer)
- Interest rate: decimal (0.02 = 2%)
- Bahasa response: Indonesia informal, panggil user "bos" atau "bro"
- Telegram format: HTML (`<b>`, `<i>`, emoji unicode)

### Branching:
- `main` — production, auto-deploy
- `feat/*` — fitur baru
- `hotfix/*` — perbaikan cepat
- Merge method: squash merge

---

## 9. Keputusan Desain Penting

### Kenapa Workers AI (bukan OpenAI langsung)?
- Gratis (included di CF Workers)
- Latency rendah (same edge network)
- Tidak perlu manage API key eksternal untuk AI

### Kenapa Qwen3-30B-A3B (bukan model lain)?
- MoE architecture: hanya 3B param aktif per query → latensi cepat
- Harga sangat murah ($0.051/M input, $0.335/M output)
- Function calling native
- Multilingual kuat (termasuk Bahasa Indonesia informal)
- **Catatan**: Qwen3 kadang mengembalikan `<think>` tags dalam tool call arguments — `engine.ts` sudah handle ini

### Kenapa D1 (bukan Postgres/Supabase)?
- Zero-config, gratis
- SQLite = simple, cukup untuk single-bot use case
- Integrated dengan Workers ecosystem

### Kenapa grammY (bukan node-telegram-bot-api)?
- TypeScript-first
- Native support untuk Cloudflare Workers (webhook mode)
- Middleware architecture yang clean

### Kenapa amount INTEGER (bukan REAL)?
- Menghindari floating point errors
- Rupiah tidak punya desimal yang berarti
- Kalkulasi lebih presisi

### Kenapa conversation_logs?
- AI butuh context dari chat sebelumnya
- Disimpan di D1, di-load per user saat request
- Dibatasi 6 pesan terakhir untuk hemat token

---

## 10. Known Issues & Quirks

| Issue | Detail | Workaround |
|-------|--------|------------|
| Qwen3 `<think>` tags | Model kadang wrap arguments dalam `<think>...</think>` | `engine.ts` strips tags before JSON.parse |
| Empty reply | Jika AI return tool calls tanpa text, formatter bisa return empty string | `formatter.ts` has "Diproses!" fallback |
| BOT_INFO must be valid JSON | `wrangler.jsonc` vars `BOT_INFO` harus valid JSON string | Set via `npx wrangler secret put` atau update vars |
| D1 migration manual | Migrations tidak auto-run, harus manual via wrangler CLI | `npx wrangler d1 migrations apply cuanbot-db` |

---

## 11. Test Coverage

| Test File | Tests | What it covers |
|-----------|-------|----------------|
| `test/index.spec.ts` | 3 | Worker entry point (GET health, POST webhook, other methods) |
| `test/utils/validator.spec.ts` | 19 | `validateAmount` (boundaries, edge cases), `sanitizeString` (XSS, truncation) |
| `test/utils/date.spec.ts` | 12 | `getDateFromOffset`, `getDateRange` (today, yesterday, this_week, this_month) |
| `test/utils/formatter.spec.ts` | 19 | `formatRupiah`, `formatReply` (all ToolCallResult types) |
| `test/services/router.spec.ts` | 11 | All tool routes, multi tool calls, unknown tool, empty calls |
| `test/services/debt.spec.ts` | ~12 | Interest calc, overdue detection, next payment, debt history |
| `test/services/target.spec.ts` | varies | Smart target calculation |
| `test/services/transaction.spec.ts` | 15 | Recording, validation, skip invalid, date offset, category lookup |
| **Total** | **~91+** | **All pass** |

### Belum ada test (Tahap 2 roadmap):
- `src/services/edit.ts`
- `src/services/edit-debt.ts`
- `src/services/summary.ts`
- `src/services/user.ts`
- `src/ai/engine.ts`

---

## 12. Changelog (Keputusan & Milestone)

| Tanggal | Event | Detail |
|---------|-------|--------|
| 2026-02-06 | Initial setup | CF Worker + grammY + D1, basic transaction recording |
| 2026-02-06 | Hutang/piutang v1 | Basic debt recording, payment, listing |
| 2026-02-06 | Edit/delete | Edit & delete transactions and debts |
| 2026-02-06 | Summary/rekap | Today, yesterday, this_week, this_month |
| 2026-02-07 | Smart target v1 | Obligations, goals, savings, progress bar |
| 2026-02-07 | Auto-progress | Progress bar otomatis setiap catat income |
| 2026-02-07 | Smart debt v1 | Due date, interest, installments, overdue, history |
| 2026-02-07 | Hotfix display | Fix sisa/total display, recurring_day logic, target tool enforcement |
| 2026-02-07 | Test suite v1 | 5 test files, 64 tests all pass (PR #2) |
| 2026-02-07 | Validator bugfix | Fix double-escaping in sanitizeString |
| 2026-02-07 | AI response fix | Fix empty reply, robust parsing, `<think>` tag strip (PR #3, #4) |
| 2026-02-07 | Smart debt deploy | Migration 0003, full smart debt features (PR #10) |
| 2026-02-08 | Documentation | README.md + AI_CONTEXT.md |
| 2026-02-08 | Tahap 1 cleanup | Add transaction test, remove stubs, update AI_CONTEXT.md |

---

## 13. Instruksi untuk AI (Workflow)

### Ketika diminta MENAMBAH FITUR BARU:
1. Baca section 6 (fitur) untuk cek apakah sudah ada
2. Buat branch `feat/<nama-fitur>` dari `main`
3. Jika butuh schema baru → buat migration file `migrations/0004_*.sql` dst
4. Implementasi: repository → service → tools → prompt → formatter → router
5. Tambah test jika logic complex
6. Push, buat PR, minta user review
7. Setelah merge, **UPDATE file AI_CONTEXT.md ini** (section 4, 6, 11, 12)

### Ketika diminta MEMPERBAIKI BUG:
1. Buat branch `hotfix/<deskripsi>`
2. Fix di file yang relevan
3. Push, buat PR, merge
4. Update AI_CONTEXT.md jika ada perubahan signifikan

### Ketika diminta REFACTOR:
1. Buat branch `refactor/<scope>`
2. Jangan ubah behavior, hanya struktur
3. Pastikan test masih pass

### Urutan file yang perlu diubah saat tambah fitur:
```
1. migrations/0004_xxx.sql        (jika butuh table/column baru)
2. src/db/repository.ts           (query baru)
3. src/services/<feature>.ts      (business logic)
4. src/ai/tools.ts                (tool definition baru)
5. src/ai/prompt.ts               (instruksi untuk AI)
6. src/services/router.ts         (dispatch tool call baru)
7. src/utils/formatter.ts         (format response)
8. src/types/transaction.ts       (type baru jika perlu)
9. test/services/<feature>.spec.ts (unit test)
10. AI_CONTEXT.md                 (update dokumentasi)
```

---

## 14. Cara Pakai File Ini di Page Baru

Ketika memulai percakapan baru, user cukup bilang:

> "Baca file `AI_CONTEXT.md` di repo `lukim7711/ojol-cuanbot` branch `main`, lalu lanjutkan dari situ. Saya mau [tambah fitur X / fix bug Y / dll]."

AI akan membaca file ini dan langsung punya konteks lengkap tanpa perlu mengulang dari awal.

---

*Last updated: 2026-02-08 — Tahap 1 cleanup*
