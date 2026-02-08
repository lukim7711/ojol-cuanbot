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
| AI/NLP (NLU) | Workers AI — **Qwen3-30B-A3B-FP8** | Stage 1: normalize Indonesian slang → formal text |
| AI/NLP (FC) | Workers AI — **Llama 3.3 70B Instruct FP8** | Stage 2: reliable function calling on normalized text |
| Database | Cloudflare D1 (SQLite) | Binding: `DB`, name: `cuanbot-db` |
| Language | TypeScript strict | tsconfig strict mode |
| Testing | Vitest + @cloudflare/vitest-pool-workers | Workers-compatible test runner |
| CI/CD | GitHub Actions | CI: test on push/PR; CD: auto migrate D1 + deploy on push to main |
| Config | wrangler.jsonc | compatibility_date: 2026-02-05 |

### Environment & Secrets
- `DB` — D1 database binding
- `AI` — Workers AI binding
- `TELEGRAM_BOT_TOKEN` — secret
- `AI_API_KEY` — secret
- `BOT_INFO` — JSON string di vars
- `CLOUDFLARE_API_TOKEN` — GitHub Actions secret (for deploy & migration)
- `CLOUDFLARE_ACCOUNT_ID` — GitHub Actions secret

---

## 3. Arsitektur

### Dual Model Pipeline (Hybrid Architecture)

```
Telegram → Webhook → Cloudflare Worker
                         |
                    grammY Bot
                         |
                  Message Handler
                         |
                    AI Engine (src/ai/engine.ts)
                         |
              ┌──── isCasualChat? ────┐
              │                       │
            YES                      NO
              │                       │
         Single Qwen call      DUAL MODEL PIPELINE
         (casual reply)              │
              │               ┌──────┴──────┐
              │               │             │
              │         Stage 1:        Stage 2:
              │         Qwen NLU        Llama FC
              │      (normalize slang)  (function calling)
              │         No history      With history
              │         No tools        With tools
              │               │             │
              │               └──────┬──────┘
              │                      │
              │               Stage 3: Validation
              │               - deepParseArguments
              │               - maxItems: 10
              │               - amount range check
              │               - deduplicate tool calls
              │                      │
              └──────────────────────┤
                                    │
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

### Why Dual Model?

| Aspek | Qwen3-30B-A3B | Llama 3.3 70B |
|-------|---------------|---------------|
| Indonesian slang | ✅ Paham (goceng, gocap, ceban) | ❌ Gagal total |
| Function calling | ❌ Unreliable | ✅ Sangat reliable |
| Role | NLU / Translator | Executor / Function Caller |

Dengan menggabungkan keduanya: **slang accuracy ~95% + FC reliability ~95% = overall ~90%+**

### Flow per message:
1. User kirim chat di Telegram
2. grammY menerima via webhook
3. `/start` → handler `start.ts` (onboarding); `/reset` → handler `reset.ts`; pesan biasa → `message.ts`
4. `isCasualChat()` check — jika casual (≤4 kata + greeting pattern) → single Qwen call, return
5. **Stage 1 (Qwen NLU)**: Normalize slang → formal text + explicit Rupiah. NO conversation history, NO tools.
6. **Stage 2 (Llama FC)**: Parse normalized text → tool calls. WITH conversation history, WITH tools.
7. **Stage 3 (Validation)**: `deepParseArguments()` (string→array), `validateToolCalls()` (maxItems, amount range, dedup)
8. Router mengeksekusi tool call → service → repository → D1
9. Result diformat oleh `formatter.ts` → dikirim balik ke user

### Token Estimation per Request

| Skenario | Qwen (NLU) | Llama (FC) | Total |
|----------|-----------|-----------|-------|
| Transaksi normal (tanpa history) | ~1.130 | ~2.605 | **~3.735** |
| Transaksi + 5 turn history | ~1.130 | ~3.105 | **~4.235** |
| Casual chat (single Qwen) | ~604 | 0 | **~604** |
| Worst case — retry | ~1.130 | ~5.224 | **~6.354** |

Komponen terbesar: Tools Schema (37.5%), NLU Prompt (26.2%), Executor Prompt (22.5%).

**Estimasi harian**: ~70.000 tokens/user/hari (20 pesan).
**Cloudflare free tier**: ~50-100 request/hari (billing per Neurons, bukan tokens).

### CD Pipeline Flow:
```
push to main → Run Tests → Apply D1 Migrations (--remote) → Deploy Worker
```
- Migration idempotent (D1 tracks via `d1_migrations` table)
- Jika migration gagal → deploy diskip (fail-fast)
- Jika tidak ada migration baru → no-op

---

## 4. Struktur Folder

```
ojol-cuanbot/
├── src/
│   ├── index.ts              # CF Worker entry, webhook route, health check
│   ├── bot.ts                # grammY bot instance setup
│   ├── ai/
│   │   ├── engine.ts         # Dual model pipeline: Qwen NLU → Llama FC → Validation
│   │   │                     #   - isCasualChat() — narrow pattern detection
│   │   │                     #   - normalizeWithQwen() — slang→formal (NO history)
│   │   │                     #   - executeWithLlama() — function calling (WITH history)
│   │   │                     #   - parseAIResponse() — OpenAI & legacy format
│   │   │                     #   - deepParseArguments() — fix Llama string→array
│   │   │                     #   - validateToolCalls() — maxItems, amount range, dedup
│   │   │                     #   - stripThinkingTags() — remove <think> from Qwen
│   │   ├── prompt.ts         # buildNLUPrompt() + buildExecutorPrompt()
│   │   │                     #   - NLU: slang rules, edit/hapus keyword preservation
│   │   │                     #   - Executor: tool mapping, clean target field rules
│   │   └── tools.ts          # 15 AI tool/function definitions (maxItems:10 on transactions)
│   ├── config/
│   │   └── env.ts            # Env type definitions
│   ├── db/
│   │   ├── repository.ts     # All DB queries: users, transactions, debts, conversation, edit/delete lookups
│   │   └── repository-target.ts  # Target queries (obligations, goals, settings)
│   ├── handlers/
│   │   ├── start.ts          # /start command handler (onboarding)
│   │   ├── reset.ts          # /reset command handler (clear all user data)
│   │   └── message.ts        # Telegram message → AI → response pipeline
│   ├── services/
│   │   ├── router.ts         # Tool call dispatcher
│   │   ├── transaction.ts    # Income/expense recording
│   │   ├── debt.ts           # Hutang: record, pay, list, history, interest, overdue
│   │   ├── edit.ts           # Edit/delete transactions (multi-layer search via repository)
│   │   ├── edit-debt.ts      # Edit/delete debts (via repository)
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
│   ├── ai/
│   │   └── engine.spec.ts    # AI engine tests (24 tests: parse, validate, casual, deepParse)
│   ├── services/
│   │   ├── transaction.spec.ts  # Transaction recording tests (15 tests)
│   │   ├── edit.spec.ts         # Edit/delete transaction tests (13 tests)
│   │   ├── edit-debt.spec.ts    # Edit/delete debt tests (8 tests)
│   │   ├── summary.spec.ts      # Summary/rekap tests (7 tests)
│   │   ├── user.spec.ts         # User service tests (5 tests)
│   │   ├── debt.spec.ts         # Smart debt tests (~12 tests)
│   │   ├── router.spec.ts       # Tool call dispatch tests (11 tests)
│   │   └── target.spec.ts       # Smart target calculation tests
│   └── utils/
│       ├── validator.spec.ts    # validateAmount + sanitizeString (19 tests)
│       ├── date.spec.ts         # getDateFromOffset + getDateRange (12 tests)
│       └── formatter.spec.ts    # formatRupiah + formatReply (19 tests)
├── .github/workflows/
│   ├── ci.yml                # CI: test on push/PR to main
│   └── deploy.yml            # CD: test → migrate D1 → deploy (on push to main)
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

#### 6.1 Catat Transaksi (NLP + Dual Model)
- Input natural: "dapet 120rb, makan 25rb, bensin 30rb"
- **Qwen NLU** normalize slang: goceng→Rp5.000, gocap→Rp50.000, ceban→Rp10.000, rb/jt/k
- **Llama FC** parse → reliable tool calls
- Kategori otomatis: orderan, makan, bensin, dll
- Date offset: hari ini, kemarin, 2 hari lalu
- Multi transaksi dalam 1 pesan (maxItems: 10)
- Auto-progress bar setelah catat income
- Validation: amount range Rp1 – Rp100.000.000, deduplicate tool calls
- Service: `src/services/transaction.ts`

#### 6.2 Hutang & Piutang (Smart Debt)
- Catat hutang/piutang ke seseorang
- **Jatuh tempo**: tanggal absolut, offset hari, tanggal berulang (recurring_day)
- **Bunga**: flat (per bulan), daily (per hari)
- **Cicilan & tenor**: auto-calculate cicilan, tracking payment number
- **Hutang lama**: input hutang yang sudah berjalan (amount vs remaining berbeda)
- **Overdue detection**: TELAT X HARI, urgent (≤3 hari), soon (≤7 hari)
- **Bayar hutang**: auto-update remaining, next_payment_date, lunas detection
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
- Period: today, yesterday, this_week, this_month, custom
- Total income, expense, net
- Detail per transaksi
- Service: `src/services/summary.ts`

#### 6.5 Edit & Hapus
- Edit transaksi: multi-layer search via repository (description, category, source_text, last)
- Hapus transaksi
- Edit hutang (adjust remaining proportionally) via repository
- Hapus hutang (soft delete via `settleDebt()`) via repository
- Service: `src/services/edit.ts`, `src/services/edit-debt.ts`
- **All SQL in repository layer** (no direct db.prepare in services)

#### 6.6 Commands
- `/start` — Onboarding flow, auto-create user. Handler: `src/handlers/start.ts`
- `/reset` — Clear all user data (transactions, debts, conversation, obligations, goals, settings). Handler: `src/handlers/reset.ts`

#### 6.7 AI Engine — Dual Model Pipeline
- **Stage 1: Qwen NLU** (`@cf/qwen/qwen3-30b-a3b-fp8`)
  - Normalize Indonesian slang → formal text + explicit Rupiah
  - NO conversation history (prevents re-translating old messages)
  - NO tools — pure text generation
  - `<think>` tag stripping (Qwen3 quirk)
  - Keyword preservation for edit/delete commands
- **Stage 2: Llama FC** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
  - Parse normalized text → reliable tool calls
  - WITH conversation history (for edit context)
  - WITH 15 tool definitions
  - Retry with `tool_choice: "required"` if 0 tool calls
- **Stage 3: Validation** (`validateToolCalls()`)
  - `deepParseArguments()` — fix Llama returning string instead of array
  - `maxItems: 10` — truncate runaway arrays
  - Amount range: Rp1 – Rp100.000.000
  - Deduplicate same tool called multiple times
- **Casual chat fast path**: `isCasualChat()` → single Qwen call (≤4 words + greeting pattern)
- Engine: `src/ai/engine.ts`

#### 6.8 CI/CD (Zero Terminal Lokal)
- **CI**: GitHub Actions — test on push/PR to main (`.github/workflows/ci.yml`)
- **CD**: GitHub Actions — on push to main (`.github/workflows/deploy.yml`):
  1. Run tests
  2. Apply D1 migrations (`wrangler d1 migrations apply cuanbot-db --remote`)
  3. Deploy Worker to Cloudflare
- **Migration otomatis**: Idempotent, fail-fast, no-op jika tidak ada migration baru
- **Tidak perlu terminal lokal** untuk workflow apapun

### 🔲 PLANNED (Roadmap)

- [ ] Potongan platform otomatis (Grab 20%, Gojek 20%, ShopeeFood 20%)
- [ ] Multi-user support (isolasi data per telegram user)
- [ ] Notifikasi/reminder jatuh tempo hutang (scheduled worker)
- [ ] Export data (PDF/CSV rekap bulanan)
- [ ] Dashboard web dengan grafik (analytics)
- [ ] `/help` command — panduan lengkap penggunaan
- [ ] `/rekap` command — shortcut rekap hari ini
- [ ] `/target` command — shortcut lihat target harian

---

## 7. AI Tools (Function Definitions)

15 tools tersedia di `src/ai/tools.ts`:

| Tool Name | Fungsi | Key Args |
|-----------|--------|----------|
| `record_transactions` | Catat income/expense (max 10 items) | `transactions[]`: {type, amount, category, description, date_offset} |
| `record_debt` | Catat hutang/piutang baru | `type, person_name, amount, remaining?, due_date?, due_date_days?, recurring_day?, interest_rate?, interest_type?, tenor_months?, installment_amount?, installment_freq?` |
| `pay_debt` | Bayar hutang | `person_name, amount` |
| `get_debts` | List hutang aktif | `type`: "hutang"/"piutang"/"all" |
| `get_debt_history` | Riwayat pembayaran hutang | `person_name` |
| `get_summary` | Rekap keuangan | `period`: "today"/"yesterday"/"this_week"/"this_month" |
| `set_obligation` | Set kewajiban tetap | `name, amount, frequency` |
| `edit_obligation` | Edit/hapus kewajiban | `name, action`: "delete"/"done" |
| `set_goal` | Set goal nabung | `name, target_amount, deadline_days` |
| `edit_goal` | Edit/batal goal | `name, action`: "cancel"/"done" |
| `set_saving` | Set tabungan harian | `amount` |
| `get_daily_target` | Hitung target harian | (no args) |
| `edit_transaction` | Edit/hapus transaksi | `action, target, new_amount?` |
| `edit_debt` | Edit hutang | `action, person_name, new_amount?` |
| `ask_clarification` | Minta klarifikasi / trigger reset | `message` |

---

## 8. AI Prompt Design

### NLU Prompt (`buildNLUPrompt`) — Qwen Stage 1
- **Mode**: `/nothink` (disable Qwen thinking mode)
- **Task**: Translate informal → formal + explicit Rupiah
- **Aturan Angka**: rb, k, jt, ceban (10rb), goceng (5rb), gocap (50rb), seceng (1rb)
- **Aturan Edit/Hapus**: WAJIB preserve nama item/kategori (bensin, makan, rokok) — JANGAN generalisasi ke "data terakhir"
- **Aturan Hutang**: X minjem ke gue = PIUTANG, hutang ke X = HUTANG
- **Format**: Satu baris per item, angka Rp eksplisit
- **Key constraint**: NO conversation history — hanya normalize pesan saat ini

### Executor Prompt (`buildExecutorPrompt`) — Llama Stage 2
- **Task**: Map normalized text → tool calls
- **Key mapping**: Explicit piutang→type:"piutang", hutang→type:"hutang" (JANGAN campur)
- **Target field rule**: Nama item BERSIH saja ("bensin", bukan "yang bensin")
- **Retry logic**: Jika 0 tool calls → retry dengan `tool_choice: "required"`
- **Key constraint**: WITH conversation history (untuk edit context)

---

## 9. Coding Conventions

### Pattern yang digunakan:
- **Repository pattern**: Semua DB queries di `src/db/repository.ts` dan `repository-target.ts` — **tidak ada direct SQL di service layer**
- **Service layer**: Business logic di `src/services/*.ts`
- **Router pattern**: Tool call dispatch di `src/services/router.ts`
- **Formatter**: Semua response formatting di `src/utils/formatter.ts` (Telegram HTML)
- **ToolCallResult**: Semua service return `{ type, data, message? }`

### Repository exports (edit/delete related):
- `FoundTransaction` — exported interface for transaction lookup results
- `findTransactionByDescription()` — Layer 1: LIKE match on description
- `findTransactionByCategory()` — Layer 2: exact match on category name
- `findTransactionBySourceText()` — Layer 3: LIKE match on source_text
- `findLastTransaction()` — Layer 4: fallback to most recent transaction
- `settleDebt()` — soft delete debt (set status = settled)
- `updateDebtAmountAndRemaining()` — update debt amount + remaining

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
- `refactor/*` — refactoring tanpa ubah behavior
- Merge method: squash merge

---

## 10. Keputusan Desain Penting

### Kenapa Dual Model (bukan single model)?
- **Qwen** paham Indonesian slang tapi lemah function calling
- **Llama** kuat function calling tapi tidak paham slang (goceng→Rp500, bukan Rp5.000)
- Dual pipeline: Qwen normalize → Llama execute = best of both worlds
- Trade-off: +2-3s latency, acceptable untuk Telegram chatbot
- Kedua model gratis di Cloudflare Workers AI

### Kenapa NLU tanpa conversation history?
- Jika Qwen dapat history, ia re-translate pesan lama → "bonus gocap" jadi include "rokok goceng" dari pesan sebelumnya
- Fix: NLU hanya terima system prompt + pesan saat ini
- Llama tetap dapat history untuk context (edit "yang terakhir")

### Kenapa deepParseArguments?
- Llama 3.3 70B kadang return `{transactions: "[{...}]" }` (string) bukan array
- `deepParseArguments()` auto-detect dan parse nested string → array/object
- Safety net di `validateToolCalls()` untuk parse ulang jika masih string

### Kenapa Workers AI (bukan OpenAI langsung)?
- Gratis (included di CF Workers)
- Latency rendah (same edge network)
- Tidak perlu manage API key eksternal untuk AI

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
- AI butuh context dari chat sebelumnya (untuk edit, koreksi)
- Disimpan di D1, di-load per user saat request
- Dibatasi 6 pesan terakhir untuk hemat token
- Dikirim ke **Llama saja** (bukan Qwen NLU)

### Kenapa auto-migration di CD?
- Zero terminal lokal — developer tidak perlu buka terminal sama sekali
- Idempotent — D1 track applied migrations, aman dijalankan berulang
- Fail-fast — migration gagal = deploy diskip
- Urutan benar — schema update dulu, baru code deploy

---

## 11. Known Issues & Quirks

| Issue | Detail | Workaround |
|-------|--------|------------|
| Qwen3 `<think>` tags | Model kadang wrap response dalam `<think>...</think>` | `stripThinkingTags()` in engine.ts |
| Llama string transactions | Llama returns `transactions` as JSON string, not array | `deepParseArguments()` + safety parse in `validateToolCalls()` |
| Llama retry needed | `target hari ini` kadang 0 tool calls pada attempt pertama | Auto-retry with `tool_choice: "required"` |
| Empty reply | Jika AI return tool calls tanpa text, formatter bisa return empty string | `formatter.ts` has "Diproses!" fallback |
| BOT_INFO must be valid JSON | `wrangler.jsonc` vars `BOT_INFO` harus valid JSON string | Set via `npx wrangler secret put` atau update vars |
| router.spec.ts stderr | `[Target] Failed to calculate progress: db.prepare is not a function` | Expected — mockDB = {}, target calc is try/catch |
| CF Neurons billing | Cloudflare free tier = 10.000 Neurons/day, ~50-100 dual-model requests | Monitor usage, consider single-model for simple cases |

---

## 12. Test Coverage

| Test File | Tests | What it covers |
|-----------|-------|----------------|
| `test/index.spec.ts` | 3 | Worker entry point (GET health, POST webhook, other methods) |
| `test/utils/validator.spec.ts` | 19 | `validateAmount` (boundaries, edge cases), `sanitizeString` (XSS, truncation) |
| `test/utils/date.spec.ts` | 12 | `getDateFromOffset`, `getDateRange` (today, yesterday, this_week, this_month) |
| `test/utils/formatter.spec.ts` | 19 | `formatRupiah`, `formatReply` (all ToolCallResult types) |
| `test/services/router.spec.ts` | 11 | All tool routes, multi tool calls, unknown tool, empty calls |
| `test/services/transaction.spec.ts` | 15 | Recording, validation, skip invalid, date offset, category lookup, sanitization |
| `test/services/debt.spec.ts` | ~12 | Interest calc, overdue detection, next payment, debt history |
| `test/services/target.spec.ts` | varies | Smart target calculation |
| `test/services/edit.spec.ts` | 13 | Delete, edit, not found, unknown action, resolveTarget layers 1-4 |
| `test/services/edit-debt.spec.ts` | 8 | Soft delete via settleDebt, edit amount, remaining adjustment, clamp to 0 |
| `test/services/summary.spec.ts` | 7 | Totals calculation, period labels, custom range, empty period |
| `test/services/user.spec.ts` | 5 | Get existing, create new, throw on failure, argument passing |
| `test/ai/engine.spec.ts` | 24 | OpenAI format, legacy, text extraction, think strip, malformed JSON, multi tool, validateToolCalls (runaway, invalid amount, dedup, string parse), isCasualChat |
| **Total** | **~148+** | **All pass** |

---

## 13. Live Test Results (2026-02-08)

### Test Run: Post Dual-Model Hotfix

**Overall: 21/23 PASS (91%)**

| Fase | Test | Status |
|------|------|--------|
| 1 | `rokok goceng` → Rp5.000 | ✅ |
| 1 | `bonus gocap` → Rp50.000 | ✅ |
| 1 | `dapet ceban dari tip` → Rp10.000 | ✅ |
| 1 | `dapet 120rb, makan 25rb, bensin 30rb` → 3 transaksi | ✅ |
| 1 | `2 hari lalu bensin 40rb` → date_offset: -2 | ✅ |
| 2 | `Andi minjem ke gue 200rb` → Piutang Rp200.000 | ✅ |
| 2 | `yang terakhir salah, harusnya 250rb` → Edit Rp250.000 | ✅ |
| 3 | `hutang ke Siti 1jt, jatuh tempo 30 hari lagi` → 30 day due | ✅ |
| 4 | `Andi bayar 100rb` → Sisa Rp150.000 | ✅ |
| 4 | `Andi bayar lagi 150rb` → 🎉 Lunas! | ✅ |
| 5 | `riwayat pembayaran hutang Andi` → 2 payments | ✅ |
| 5 | `riwayat hutang Siti` → Belum ada pembayaran | ✅ |
| 6 | `tambah kewajiban cicilan gopay 500rb per bulan` → ✅ | ✅ |
| 6 | `tambah goal nabung beli motor 5jt` → ✅ | ✅ |
| 6 | `kewajiban gopay udah dibayar` → Done | ✅ |
| 6 | `hapus goal motor` → Dibatalkan | ✅ |
| 7 | `yang rokok tadi hapus aja` → Dihapus | ✅ |
| 7 | `yang bensin 30rb ubah jadi 35rb` → Not found | ❌ (prompt fix pushed) |
| 7 | `hapus transaksi yang gak ada` → Error handled | ✅ |
| 8 | `daftar piutang` → type mapping salah | ⚠️ (prompt fix pushed) |
| 8 | `target hari ini` → 171% tercapai (retry needed) | ✅ |
| 8 | `rekap` → Bersih Rp95.000 | ✅ |
| 9 | `makan siang 25rb` (duplicate test) → Tercatat | ✅ |

**Prompt fix sudah dipush** untuk 2 failing cases (keyword preservation + piutang mapping).

---

## 14. Changelog (Keputusan & Milestone)

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
| 2026-02-08 | Tahap 1 cleanup | Remove stubs, add transaction test, rewrite AI_CONTEXT.md (PR #12) |
| 2026-02-08 | Tahap 2 hardening | Add 5 test files (edit, edit-debt, summary, user, engine) — ~40 new tests (PR #13) |
| 2026-02-08 | Refactor repository | Extract direct SQL from edit.ts & edit-debt.ts to repository layer (PR #14) |
| 2026-02-08 | Auto-migration CD | Add D1 migration step in deploy.yml — zero terminal lokal (PR #15) |
| 2026-02-08 | /reset command | Full data wipe: transactions, debts, payments, obligations, goals, settings, history (PR #16–#18) |
| 2026-02-08 | Formatter fixes | PR #19: fix formatReply returning object, fix /reset handler |
| 2026-02-08 | Llama switch | PR #20: switch FC model to Llama 3.3 70B — better function calling |
| 2026-02-08 | Bot username fix | PR #21: update bot_info.json → correct @ojol_finance_bot username |
| 2026-02-08 | Switch to Qwen FC | PR #22: rollback to Qwen for FC (Llama slang issue) |
| 2026-02-08 | **Dual model pipeline** | **PR #23**: Hybrid architecture — Qwen NLU + Llama FC. Best of both worlds. |
| 2026-02-08 | Hotfix crashes | Direct commit: fix `deepParseArguments` (string→array), remove NLU history |
| 2026-02-08 | Prompt tuning | Direct commit: NLU keyword preservation, Executor piutang mapping fix |
| 2026-02-08 | **Live test 91% pass** | 21/23 scenarios pass. Slang parsing 100%, FC reliable, validation works. |

---

## 15. Instruksi untuk AI (Workflow)

### Ketika diminta MENAMBAH FITUR BARU:
1. Baca section 6 (fitur) untuk cek apakah sudah ada
2. Buat branch `feat/<nama-fitur>` dari `main`
3. Jika butuh schema baru → buat migration file `migrations/0004_*.sql` dst (akan auto-apply saat CD)
4. Implementasi: repository → service → tools → prompt → formatter → router
5. Tambah test jika logic complex
6. Push, buat PR, tunggu CI pass
7. Setelah user bilang merge, squash merge ke main
8. **UPDATE file AI_CONTEXT.md ini** (section 4, 6, 12, 13)

### Ketika diminta MEMPERBAIKI BUG:
1. Buat branch `hotfix/<deskripsi>` atau direct commit ke main (untuk urgent hotfix)
2. Fix di file yang relevan
3. Push, buat PR (atau direct commit), tunggu CI pass
4. Update AI_CONTEXT.md jika ada perubahan signifikan

### Ketika diminta REFACTOR:
1. Buat branch `refactor/<scope>`
2. Jangan ubah behavior, hanya struktur
3. Pastikan test masih pass
4. Update AI_CONTEXT.md jika ada perubahan signifikan

### Urutan file yang perlu diubah saat tambah fitur:
```
1. migrations/0004_xxx.sql        (jika butuh table/column baru — auto-apply via CD)
2. src/db/repository.ts           (query baru)
3. src/services/<feature>.ts      (business logic)
4. src/ai/tools.ts                (tool definition baru)
5. src/ai/prompt.ts               (NLU + Executor instruksi)
6. src/services/router.ts         (dispatch tool call baru)
7. src/utils/formatter.ts         (format response)
8. src/types/transaction.ts       (type baru jika perlu)
9. test/services/<feature>.spec.ts (unit test)
10. AI_CONTEXT.md                 (update dokumentasi)
```

### Dual Model Considerations:
Saat menambah fitur baru yang melibatkan AI:
- **NLU prompt**: Tambah aturan normalize untuk input baru + contoh
- **Executor prompt**: Tambah mapping tool untuk input yang sudah di-normalize
- **Tools schema**: Tambah tool definition — ingat ini 37.5% dari total token, keep minimal
- **Test**: Tambah test di `engine.spec.ts` untuk validateToolCalls jika ada logic baru

---

## 16. Cara Pakai File Ini di Page Baru

Ketika memulai percakapan baru, user cukup bilang:

> "Baca file `AI_CONTEXT.md` di repo `lukim7711/ojol-cuanbot` branch `main`, lalu lanjutkan dari situ. Saya mau [tambah fitur X / fix bug Y / dll]."

AI akan membaca file ini dan langsung punya konteks lengkap tanpa perlu mengulang dari awal.

---

*Last updated: 2026-02-08 — Hybrid dual-model pipeline (Qwen NLU + Llama FC), 91% live test pass*
