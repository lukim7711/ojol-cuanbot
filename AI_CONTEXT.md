# AI_CONTEXT.md — CuanBot Project Context

> **INSTRUKSI UNTUK AI**: File ini berisi seluruh konteks project CuanBot.
> Ketika user memulai percakapan baru dan meminta kamu membaca file ini,
> gunakan SEMUA informasi di bawah sebagai konteks kerja.
> Selalu update file ini setelah menambah fitur baru atau melakukan perubahan signifikan.
>
> **Last updated**: 2026-02-10 — Unified Shopee parser (food + SPX), OCR photo pipeline, 332 tests

---

## 1. Overview Aplikasi

**CuanBot** adalah bot Telegram AI untuk manajemen keuangan harian driver ojek online Indonesia.

- **Target user**: Driver ojol (Shopee, Grab, Gojek, Maxim, dll)
- **Platform**: Telegram Bot
- **Interaksi**: Chat natural Bahasa Indonesia (informal, slang, singkatan) + screenshot foto
- **Bot username**: @ojol_finance_bot
- **Bot name**: Ojol Finance Assistant
- **Live URL**: https://cuanbot.cfkim.workers.dev/

### Value Proposition
Driver ojol bisa catat pemasukan/pengeluaran, hutang, dan target harian cukup dengan chat biasa atau kirim screenshot order — tanpa buka app keuangan ribet.

---

## 2. Tech Stack

| Layer | Teknologi | Detail |
|-------|-----------|--------|
| Runtime | Cloudflare Workers | Serverless, edge-deployed, entry: `src/index.ts` |
| Bot Framework | grammY v1.39+ | TypeScript-first, webhook mode |
| AI/NLP (NLU) | Workers AI — **Qwen3-30B-A3B-FP8** | Stage 1: normalize Indonesian slang → formal text |
| AI/NLP (FC) | Workers AI — **Llama 3.3 70B Instruct FP8** | Stage 2: reliable function calling on normalized text |
| OCR | OCR.space API (Engine 2) | Extract text from screenshot photos, free 25K req/month |
| Local Parser | Regex-based (src/parsers/) | Bypass AI for known formats (Shopee), 0ms parse time |
| Database | Cloudflare D1 (SQLite) | Binding: `DB`, name: `cuanbot-db` |
| KV Store | Cloudflare KV | Binding: `RATE_LIMIT`, for rate limiting + message dedup |
| Language | TypeScript strict | tsconfig strict mode |
| Testing | Vitest + @cloudflare/vitest-pool-workers | Workers-compatible test runner, **332 tests** |
| CI/CD | GitHub Actions | CI: test on push/PR; CD: auto migrate D1 + deploy on push to main |
| Config | wrangler.jsonc | compatibility_date: 2026-02-05, nodejs_compat flag |

### Environment & Secrets

| Binding/Secret | Type | Purpose |
|----------------|------|--------|
| `DB` | D1 Database | Main database (`cuanbot-db`) |
| `AI` | Workers AI | AI model inference |
| `RATE_LIMIT` | KV Namespace | Rate limiting + photo dedup |
| `BOT_TOKEN` | Secret | Telegram Bot API token |
| `BOT_INFO` | Var (JSON) | grammY bot info: `{id, is_bot, first_name, username}` |
| `OCR_API_KEY` | Secret | OCR.space API key |
| `WEBHOOK_SECRET` | Secret (optional) | Telegram webhook verification |
| `CLOUDFLARE_API_TOKEN` | GitHub Secret | For deploy & D1 migration |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Secret | Cloudflare account ID |

Defined in: `src/config/env.ts`

---

## 3. Arsitektur

### 3.1 Message Pipeline (Dual Model)

```
Telegram → Webhook → Cloudflare Worker (src/index.ts)
                         |
                    grammY Bot (src/bot.ts)
                         |
              ┌──── Route by type ────┐
              │                       │
         /command              message:text          message:photo
         (zero AI)            (AI pipeline)         (OCR pipeline)
              │                    │                      │
         Direct handler      Message Handler         Photo Handler
         (start, rekap,      (src/handlers/           (src/handlers/
          target, hutang,     message.ts)              photo.ts)
          reset)                  │                      │
                           ┌── isCasual? ──┐        See §3.2
                           │               │
                         YES              NO
                           │               │
                     Single Qwen      DUAL MODEL
                     (casual reply)        │
                           │        ┌──────┴──────┐
                           │   Stage 1: Qwen    Stage 2: Llama
                           │   (normalize)      (function call)
                           │        └──────┬──────┘
                           │          Stage 3: Validation
                           │          - deepParseArguments
                           │          - maxItems: 10
                           │          - amount range check
                           │          - deduplicate
                           └────────────┤
                                        │
                        Service Router (src/services/router.ts)
                        ├── transaction.ts  → record income/expense
                        ├── debt.ts         → record/pay/list/history debts
                        ├── edit.ts         → edit/delete transactions
                        ├── edit-debt.ts    → edit/delete debts
                        ├── summary.ts      → rekap keuangan
                        ├── target.ts       → smart daily target
                        ├── deleteConfirm.ts → delete confirmation flow
                        └── user.ts         → get/create user
                             |
                        Repository Layer
                        ├── repository.ts        (core queries)
                        └── repository-target.ts (target queries)
                             |
                        Cloudflare D1 (SQLite)
```

### 3.2 Photo Pipeline (OCR → Local Parser → AI Fallback)

```
User sends photo
      │
  ┌───┴───┐
  │ Dedup │ KV-based idempotency (5min TTL)
  └───┬───┘
      │
  Download from Telegram API
      │
  OCR.space Engine 2 (~1-3s)
      │
  cleanOCRForParser(text)
      │
  ┌───┴───────────────┐
  │ tryParseOCR()     │  src/parsers/index.ts
  │  detectFormat()   │  src/parsers/detector.ts
  │    ├─ shopee      │  → parseShopee()  (src/parsers/shopee.ts)
  │    ├─ grab        │  → (not implemented yet)
  │    ├─ gopay       │  → (not implemented yet)
  │    └─ unknown     │  → null (fallback to AI)
  └───┬───────────────┘
      │
  ┌───┴───┐
  │Result?│
  └───┬───┘
    YES │                    NO
      │                      │
  recordTransactions()    AI Fallback
  (direct to DB,          (same dual-model
   0 AI calls,             pipeline as text)
   0ms parse)                  │
      │                        │
  Reply with metadata      Reply from AI
  "Auto-parsed dari
   Shopee (6 food,
   3 paket)"
```

### 3.3 Shopee Parser Detail (src/parsers/shopee.ts)

Shopee drivers handle BOTH food delivery (ShopeeFood) and package delivery (SPX).
Both appear in the same order history screen.

```
Pass 1: SHOPEE_FOOD_REGEX
  Pattern: time + ShopeeFood (with OCR typo tolerance) + Rp + amount
  Output:  "ShopeeFood HH:MM"
  Typos:   ShapeeFood, Shopeefood, shopeeFood, ShuppeFood

Pass 2: SPX_ORDER_REGEX
  Pattern: time + SPX (Instant|Standard|Express|Ekonomi|Marketplace) + Rp + amount
  Output:  "SPX HH:MM"

Pass 3: TIME_AMOUNT_REGEX (fallback)
  Pattern: time + Rp + amount (no platform label)
  Output:  "Shopee HH:MM"

Dedup: Set<string> by "time:amount" key
Sort:  Descending by time (latest first)
Filter: amount >= 1,000 AND <= 10,000,000
```

### 3.4 Date Detection (src/parsers/index.ts)

```
OCR header: "09 Feb 2026 ~"
                │
    detectDateOffset(text)
                │
    Compare to today (WIB/UTC+7)
                │
    Return: 0 (today), -1 (yesterday), -2 (2 days ago), etc.
    Constraint: 0 to -30 days only, future = 0
```

### 3.5 Why Dual Model?

| Aspek | Qwen3-30B-A3B | Llama 3.3 70B |
|-------|---------------|---------------|
| Indonesian slang | ✅ Paham (goceng, gocap, ceban) | ❌ Gagal total |
| Function calling | ❌ Unreliable | ✅ Sangat reliable |
| Role | NLU / Translator | Executor / Function Caller |

### 3.6 Token Estimation per Request

| Skenario | Qwen (NLU) | Llama (FC) | Total |
|----------|-----------|-----------|-------|
| Transaksi normal | ~1,130 | ~2,605 | **~3,735** |
| Transaksi + 5 turn history | ~1,130 | ~3,105 | **~4,235** |
| Casual chat (single Qwen) | ~604 | 0 | **~604** |
| Photo (known format) | 0 | 0 | **0** |
| Photo (unknown → AI fallback) | ~1,130 | ~2,605 | **~3,735** |

### 3.7 CD Pipeline
```
push to main → Run Tests (332) → Apply D1 Migrations (--remote) → Deploy Worker
```

---

## 4. Struktur Folder (Lengkap, dari source code)

```
ojol-cuanbot/
├── src/
│   ├── index.ts              # CF Worker entry: POST /webhook, GET /health
│   ├── bot.ts                # grammY bot: 7 commands + photo + text handlers
│   ├── ai/
│   │   ├── engine.ts         # Dual model: Qwen NLU → Llama FC → Validation
│   │   │                     #   isCasualChat(), normalizeWithQwen(), executeWithLlama()
│   │   │                     #   deepParseArguments(), validateToolCalls(), stripThinkingTags()
│   │   ├── prompt.ts         # buildNLUPrompt() + buildExecutorPrompt()
│   │   └── tools.ts          # 15 AI tool definitions + 5 tool groups
│   ├── config/
│   │   └── env.ts            # Env interface: DB, AI, RATE_LIMIT, BOT_TOKEN, OCR_API_KEY
│   ├── db/
│   │   ├── repository.ts     # Core queries: users, transactions, debts, conversation, edit/delete
│   │   └── repository-target.ts  # Target queries: obligations, goals, settings
│   ├── handlers/
│   │   ├── start.ts          # /start + /help — onboarding message
│   │   ├── reset.ts          # /reset + /confirm_reset — wipe all user data
│   │   ├── rekap.ts          # /rekap — shortcut rekap hari ini (zero AI)
│   │   ├── target.ts         # /target — shortcut target harian (zero AI)
│   │   ├── hutang.ts         # /hutang — shortcut daftar hutang (zero AI)
│   │   ├── message.ts        # Text messages → AI dual-model pipeline
│   │   │                     #   + KV dedup (5min TTL) + rate limit + input guard
│   │   └── photo.ts          # Photo messages → OCR → parser → AI fallback
│   │                         #   + KV dedup + rate limit + cleanOCRForParser()
│   ├── middleware/
│   │   ├── inputGuard.ts     # Pre-AI validation: message length, spam detection
│   │   └── rateLimit.ts      # KV-based rate limiting per telegram user
│   ├── parsers/
│   │   ├── detector.ts       # detectFormat(): shopee | grab | gopay | unknown
│   │   │                     #   ShopeeFood + SPX → unified "shopee" format
│   │   ├── index.ts          # tryParseOCR(): orchestrator, detectDateOffset()
│   │   └── shopee.ts         # parseShopee(): 3-pass regex (food + SPX + fallback)
│   │                         #   parseOjolAmount(): handle OCR artifacts (,:.')
│   ├── services/
│   │   ├── router.ts         # Tool call dispatcher (15 tool routes)
│   │   ├── transaction.ts    # recordTransactions(): income/expense → D1
│   │   ├── debt.ts           # recordDebt(), payDebt(), getDebts(), getDebtHistory()
│   │   │                     #   Interest calc, overdue detection, installment tracking
│   │   ├── edit.ts           # editTransaction(): 4-layer search (desc → cat → source → last)
│   │   ├── edit-debt.ts      # editDebt(): soft delete, amount adjustment
│   │   ├── summary.ts        # getSummary(): today/yesterday/this_week/this_month/custom
│   │   ├── target.ts         # getDailyTarget(): obligations + debts + avg ops + savings + goals
│   │   ├── deleteConfirm.ts  # Delete confirmation flow via KV
│   │   ├── ocr.ts            # extractTextFromImage(), downloadTelegramPhoto()
│   │   │                     #   OCR.space Engine 2, max 1MB, base64 upload
│   │   └── user.ts           # getOrCreateUser(): find or create by telegram_id
│   ├── types/
│   │   ├── transaction.ts    # User, ParsedTransaction, ToolCallResult interfaces
│   │   └── ai-response.ts    # ToolCall, AIResult interfaces
│   └── utils/
│       ├── formatter.ts      # formatReply(): Telegram HTML builder (all result types)
│       │                     #   formatRupiah(): "Rp25.000" formatting
│       ├── date.ts           # getDateFromOffset(), getDateRange() — WIB timezone
│       └── validator.ts      # validateAmount(), sanitizeString() — XSS prevention
├── migrations/
│   ├── 0001_init.sql         # users, transactions, categories, debts, debt_payments, conversation_logs
│   ├── 0002_smart_target.sql # obligations, goals, user_settings
│   └── 0003_smart_debt.sql   # ALTER debts: +8 columns (due_date, interest, installment)
├── test/
│   ├── index.spec.ts         # Worker entry point (3 tests)
│   ├── env.d.ts              # Test environment types
│   ├── tsconfig.json         # Test-specific tsconfig
│   ├── ai/
│   │   └── engine.spec.ts    # AI engine (24 tests)
│   ├── handlers/
│   │   └── (handler tests)   # Handler-level tests
│   ├── middleware/
│   │   └── (middleware tests) # Rate limit, input guard tests
│   ├── parsers/
│   │   ├── detector.spec.ts  # Format detection (17 tests): ShopeeFood, SPX, Grab, GoPay, unknown
│   │   ├── shopeefood.spec.ts # Shopee parser (20 tests): food, SPX, mixed, real-world 9-order
│   │   └── index.spec.ts     # Parser orchestrator (11 tests): tryParseOCR, detectDateOffset
│   ├── services/
│   │   ├── transaction.spec.ts (15 tests)
│   │   ├── edit.spec.ts        (13 tests)
│   │   ├── edit-debt.spec.ts   (8 tests)
│   │   ├── summary.spec.ts     (7 tests)
│   │   ├── user.spec.ts        (5 tests)
│   │   ├── debt.spec.ts        (~12 tests)
│   │   ├── router.spec.ts      (11 tests)
│   │   └── target.spec.ts      (varies)
│   └── utils/
│       ├── validator.spec.ts   (19 tests)
│       ├── date.spec.ts        (12 tests)
│       └── formatter.spec.ts   (19 tests)
├── .github/workflows/
│   ├── ci.yml                # CI: vitest on push/PR to main
│   └── deploy.yml            # CD: test → migrate D1 → deploy worker
├── wrangler.jsonc            # Worker config: cuanbot, D1, KV, AI bindings
├── package.json
├── tsconfig.json
├── vitest.config.mts
└── worker-configuration.d.ts
```

---

## 5. Database Schema (dari migrations/)

### Migration 0001: Core Tables
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  timezone TEXT DEFAULT 'Asia/Jakarta',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  name TEXT NOT NULL,
  icon TEXT
);
-- Seeded income: orderan, bonus, tip, lainnya
-- Seeded expense: makan, bensin, servis, pulsa, rokok, parkir, lainnya

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  category_id INTEGER REFERENCES categories(id),
  amount INTEGER NOT NULL,
  description TEXT,
  source_text TEXT,
  trx_date TEXT NOT NULL,  -- YYYY-MM-DD
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('hutang','piutang')),
  person_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  note TEXT,
  source_text TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  settled_at INTEGER,
  -- Added by migration 0003:
  due_date TEXT,
  interest_rate REAL DEFAULT 0,
  interest_type TEXT DEFAULT 'none',  -- 'none', 'flat', 'daily'
  tenor_months INTEGER,
  installment_amount INTEGER,
  installment_freq TEXT DEFAULT 'monthly',  -- 'daily', 'weekly', 'monthly'
  next_payment_date TEXT,
  total_with_interest INTEGER
);

CREATE TABLE debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL REFERENCES debts(id),
  amount INTEGER NOT NULL,
  source_text TEXT,
  paid_at INTEGER DEFAULT (unixepoch())
);

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
- Qwen NLU normalize slang: goceng→Rp5.000, gocap→Rp50.000, ceban→Rp10.000
- Llama FC → reliable tool calls
- Kategori otomatis, date offset, multi transaksi (max 10)
- Auto-progress bar setelah catat income
- Validation: Rp1–Rp100.000.000, dedup tool calls
- Service: `src/services/transaction.ts`

#### 6.2 Screenshot Order — OCR + Local Parser
- **Driver kirim screenshot** riwayat order Shopee → auto-parse semua transaksi
- **OCR**: OCR.space Engine 2, ~1-3s, max 1MB photo
- **Local parser (0ms)**: Regex-based, bypass AI completely
  - Detects: ShopeeFood (food delivery) + SPX (package delivery)
  - Both appear on same screen — unified "shopee" parser
  - 3-pass: food regex → SPX regex → fallback time+Rp
  - Amount parsing handles OCR artifacts: comma, dot, colon, apostrophe
  - Date offset from screenshot header ("09 Feb 2026" → -1)
- **AI fallback**: Unknown formats → same dual-model pipeline as text
- **Dedup**: KV-based, 5min TTL, prevents duplicate from Telegram retry
- **Performance**: Known format 1.4s total (was 10.5s timeout), 0 AI calls
- Handler: `src/handlers/photo.ts`
- Parser: `src/parsers/shopee.ts`, `src/parsers/detector.ts`, `src/parsers/index.ts`
- OCR: `src/services/ocr.ts`

#### 6.3 Hutang & Piutang (Smart Debt)
- Catat hutang/piutang, jatuh tempo, bunga (flat/daily), cicilan & tenor
- Hutang lama (amount ≠ remaining), overdue detection, next payment tracking
- Bayar hutang → auto-update remaining, lunas detection
- Riwayat pembayaran, list sorted by urgency
- Service: `src/services/debt.ts`

#### 6.4 Smart Daily Target
- Komponen: obligations + debt installments + avg operational + savings + goals + buffer 10%
- Auto progress bar setiap catat income
- Service: `src/services/target.ts`

#### 6.5 Rekap Keuangan
- Period: today, yesterday, this_week, this_month, custom
- Service: `src/services/summary.ts`

#### 6.6 Edit & Hapus
- Edit/hapus transaksi: 4-layer search (description → category → source_text → last)
- Edit/hapus hutang (soft delete via settleDebt)
- Service: `src/services/edit.ts`, `src/services/edit-debt.ts`

#### 6.7 Slash Commands (Zero AI — 0 neurons)

| Command | Handler | Function |
|---------|---------|----------|
| `/start` | `handlers/start.ts` | Onboarding, auto-create user |
| `/help` | `handlers/start.ts` | Same as /start |
| `/reset` | `handlers/reset.ts` | Confirm prompt for full data wipe |
| `/confirm_reset` | `handlers/reset.ts` | Execute wipe: transactions, debts, payments, obligations, goals, settings, history |
| `/rekap` | `handlers/rekap.ts` | Shortcut rekap hari ini |
| `/target` | `handlers/target.ts` | Shortcut target harian |
| `/hutang` | `handlers/hutang.ts` | Shortcut daftar hutang aktif |

Registered in: `src/bot.ts`

#### 6.8 Middleware & Security
- **Rate limit**: KV-based per telegram user (`src/middleware/rateLimit.ts`)
- **Input guard**: Message length, spam detection (`src/middleware/inputGuard.ts`)
- **Message dedup**: KV-based idempotency for text + photo messages (5min TTL)
- **Amount validation**: Rp1–Rp100.000.000 (`src/utils/validator.ts`)
- **HTML sanitize**: Prevent XSS in Telegram HTML responses (`src/utils/validator.ts`)

#### 6.9 AI Engine — Dual Model Pipeline
- Stage 1: Qwen NLU (normalize slang, NO history, NO tools)
- Stage 2: Llama FC (function calling, WITH history, WITH tools)
- Stage 3: Validation (deepParseArguments, maxItems, amount range, dedup)
- Casual chat fast path: ≤4 words + greeting pattern → single Qwen
- Engine: `src/ai/engine.ts`

#### 6.10 CI/CD (Zero Terminal Lokal)
- CI: GitHub Actions — vitest on push/PR
- CD: test → D1 migration → deploy worker (on push to main)
- Migration: idempotent, fail-fast

### 🔲 PLANNED (Roadmap)

- [ ] Multi-foto batch (kirim 2-3 screenshot sekaligus)
- [ ] Export laporan (PDF/CSV rekap bulanan)
- [ ] Reminder cicilan (scheduled worker + push notification)
- [ ] Analisis pengeluaran per kategori
- [ ] GrabFood parser
- [ ] Multi-user household

---

## 7. AI Tools (15 definitions in src/ai/tools.ts)

| Tool Name | Fungsi | Key Args |
|-----------|--------|----------|
| `record_transactions` | Catat income/expense (max 10) | `transactions[]`: {type, amount, category, description, date_offset} |
| `record_debt` | Catat hutang/piutang baru | `type, person_name, amount, due_date_days?, note?` |
| `pay_debt` | Bayar hutang | `person_name, amount` |
| `get_debts` | List hutang aktif | `type`: hutang/piutang/all |
| `get_debt_history` | Riwayat pembayaran | `person_name` |
| `get_summary` | Rekap keuangan | `period`: today/yesterday/this_week/this_month |
| `set_obligation` | Kewajiban rutin | `name, amount, frequency?` |
| `edit_obligation` | Hapus/selesaikan kewajiban | `action`: delete/done, `name` |
| `set_goal` | Goal menabung | `name, target_amount, deadline_days?` |
| `edit_goal` | Batal/selesaikan goal | `action`: cancel/done, `name` |
| `set_saving` | Tabungan harian | `amount` |
| `get_daily_target` | Target harian | (no args) |
| `edit_transaction` | Edit/hapus transaksi | `action`: edit/delete, `target, new_amount?` |
| `edit_debt` | Edit/hapus hutang | `action`: edit/delete, `person_name, new_amount?` |
| `ask_clarification` | Tanya balik jika ambigu | `message` |

### Tool Groups (for dynamic selection)
- `TRANSACTION_TOOLS`: record_transactions, record_debt, pay_debt, ask_clarification
- `DEBT_TOOLS`: record_debt, pay_debt, get_debts, get_debt_history, edit_debt, ask_clarification
- `QUERY_TOOLS`: get_summary, get_debts, get_debt_history, get_daily_target, ask_clarification
- `EDIT_TOOLS`: edit_transaction, edit_debt, edit_obligation, edit_goal, ask_clarification
- `SETTING_TOOLS`: set_obligation, set_goal, set_saving, ask_clarification

---

## 8. AI Prompt Design

### NLU Prompt (Qwen Stage 1) — `buildNLUPrompt()`
- Mode: `/nothink` (disable thinking)
- Task: Translate informal → formal + explicit Rupiah
- Slang rules: rb, k, jt, ceban (10rb), goceng (5rb), gocap (50rb), seceng (1rb)
- Edit/hapus: WAJIB preserve nama item (bensin, makan, rokok)
- Hutang: "X minjem ke gue" = PIUTANG, "hutang ke X" = HUTANG
- Constraint: NO conversation history

### Executor Prompt (Llama Stage 2) — `buildExecutorPrompt()`
- Task: Map normalized text → tool calls
- Key: piutang→type:"piutang", hutang→type:"hutang"
- Target field: nama item BERSIH ("bensin", bukan "yang bensin")
- Retry: 0 tool calls → retry with `tool_choice: "required"`
- Constraint: WITH conversation history

---

## 9. Coding Conventions

### Patterns
- **Repository pattern**: ALL DB queries in `src/db/repository.ts` + `repository-target.ts` — NO direct SQL in services
- **Service layer**: Business logic in `src/services/*.ts`
- **Router pattern**: Tool dispatch in `src/services/router.ts`
- **Formatter**: ALL response formatting in `src/utils/formatter.ts` (Telegram HTML)
- **ToolCallResult**: All services return `{ type, data, message? }`

### Data conventions
- Amount: INTEGER (Rupiah penuh, bukan desimal)
- Tanggal: `YYYY-MM-DD` (string)
- Timestamp: `unixepoch()` (integer)
- Interest rate: decimal (0.02 = 2%)
- Response language: Indonesia informal, panggil user "bos"/"bro"
- Telegram format: HTML (`<b>`, `<i>`, emoji unicode)

### Branching & merge
- `main` — production, auto-deploy
- `feat/*` — fitur baru
- `fix/*` / `hotfix/*` — perbaikan
- `refactor/*` — refactoring
- `docs/*` — dokumentasi
- Merge method: **squash merge**

---

## 10. Keputusan Desain Penting

| Keputusan | Alasan |
|-----------|--------|
| Dual Model (Qwen + Llama) | Qwen paham slang tapi FC lemah; Llama FC kuat tapi gagal slang. Gabungan = 90%+ accuracy |
| NLU tanpa history | Kalau Qwen dapat history, ia re-translate pesan lama → duplicate. Llama tetap dapat history |
| deepParseArguments() | Llama kadang return `{transactions: "[{...}]"}` (string bukan array) → auto-fix |
| Workers AI (bukan OpenAI) | Gratis, low latency (same edge), no external API key needed |
| D1 (bukan Postgres) | Zero-config, gratis, cukup untuk single-bot |
| grammY (bukan node-telegram-bot-api) | TypeScript-first, native CF Workers support |
| Amount INTEGER | Hindari floating point errors, Rupiah tak punya desimal |
| Local parser sebelum AI | Shopee screenshot = 0ms parse, 0 AI calls → hemat neurons + cepat |
| ShopeeFood + SPX unified | Driver Shopee handle food + paket di halaman yang sama → 1 parser |
| OCR Engine 2 | Best for noisy backgrounds (photos of phone screens) |
| KV dedup (5min TTL) | Telegram retries webhook setelah timeout → prevent double recording |

---

## 11. Known Issues & Quirks

| Issue | Detail | Workaround |
|-------|--------|------------|
| Qwen3 `<think>` tags | Model kadang wrap response dalam tags | `stripThinkingTags()` |
| Llama string transactions | Returns JSON string bukan array | `deepParseArguments()` |
| Llama retry needed | `target hari ini` kadang 0 tool calls | Auto-retry with `tool_choice: "required"` |
| Empty reply | AI return tool calls tanpa text | "Diproses!" fallback in formatter |
| OCR.space Engine 2 exit code 1 | Exit code 1 = success (counterintuitive) | Check OCRExitCode ≤ 2 |
| Photo 1MB limit | OCR.space free tier max | Error message + suggest compressed photo |
| router.spec.ts stderr | `db.prepare is not a function` | Expected — mockDB = {} |
| CF Neurons billing | Free 10K Neurons/day | ~50-100 dual-model requests |

---

## 12. Test Coverage (332 tests, all pass)

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `test/index.spec.ts` | 3 | Worker entry point |
| `test/ai/engine.spec.ts` | 24 | AI engine: parse, validate, casual, deepParse |
| `test/parsers/detector.spec.ts` | 17 | ShopeeFood, SPX, Grab, GoPay, unknown |
| `test/parsers/shopeefood.spec.ts` | 20 | Shopee parser: food, SPX, mixed, real-world 9-order |
| `test/parsers/index.spec.ts` | 11 | tryParseOCR, detectDateOffset, mixed formats |
| `test/services/router.spec.ts` | 11 | All 15 tool routes |
| `test/services/transaction.spec.ts` | 15 | Recording, validation, category, date offset |
| `test/services/debt.spec.ts` | ~12 | Interest, overdue, next payment, history |
| `test/services/edit.spec.ts` | 13 | Delete, edit, 4-layer search |
| `test/services/edit-debt.spec.ts` | 8 | Soft delete, amount adjustment |
| `test/services/summary.spec.ts` | 7 | Totals, period labels, custom range |
| `test/services/user.spec.ts` | 5 | Get existing, create new |
| `test/services/target.spec.ts` | varies | Smart target calculation |
| `test/utils/validator.spec.ts` | 19 | validateAmount, sanitizeString |
| `test/utils/date.spec.ts` | 12 | getDateFromOffset, getDateRange |
| `test/utils/formatter.spec.ts` | 19 | formatRupiah, formatReply |
| + handlers, middleware tests | varies | Various handler/middleware coverage |
| **Total** | **332** | **28 test files, all pass** |

---

## 13. Live Test Results

### 2026-02-08: Post Dual-Model Hotfix — 21/23 PASS (91%)

| Test | Status |
|------|--------|
| Slang parsing (goceng, gocap, ceban) | ✅ |
| Multi transaksi in 1 message | ✅ |
| Date offset (2 hari lalu) | ✅ |
| Hutang/piutang CRUD | ✅ |
| Edit transaksi | ✅ (prompt fix pushed) |
| Rekap, target, daftar piutang | ✅ |

### 2026-02-10: OCR + Local Parser — PASS

| Test | Status |
|------|--------|
| ShopeeFood 9-order screenshot (6 food + 3 SPX) | ✅ |
| Total Rp170,400 correct | ✅ |
| dateOffset=-1 (yesterday) applied | ✅ |
| `/rekap kemarin` shows Rp170,400 | ✅ |
| Performance: 1.4s (was 10.5s timeout) | ✅ |
| 0 AI calls for known format | ✅ |
| SPX labeled separately from ShopeeFood | ✅ |

---

## 14. Changelog

| Tanggal | Event | PR |
|---------|-------|----|
| 2026-02-06 | Initial setup: CF Worker + grammY + D1 | — |
| 2026-02-06 | Hutang/piutang v1, edit/delete, summary | — |
| 2026-02-07 | Smart target, smart debt, test suite v1 | #2–#10 |
| 2026-02-08 | Cleanup, hardening, 5 new test files | #12–#14 |
| 2026-02-08 | Auto-migration CD, /reset command | #15–#18 |
| 2026-02-08 | Formatter fixes, Llama switch, rollback | #19–#22 |
| 2026-02-08 | **Dual model pipeline** (Qwen NLU + Llama FC) | **#23** |
| 2026-02-08 | Hotfix crashes + prompt tuning | direct |
| 2026-02-08 | Live test 91% pass | — |
| 2026-02-09 | OCR photo pipeline + ShopeeFood parser | #34–#38 |
| 2026-02-09 | Photo dedup, rate limit, error handling | #39–#41 |
| 2026-02-10 | ShopeeFood parser test fix | #42 |
| 2026-02-10 | **Unified Shopee parser (food + SPX)** | **#43** |
| 2026-02-10 | Documentation update (AI_CONTEXT.md v2) | #44 |

---

## 15. Instruksi untuk AI (Workflow)

### Menambah Fitur Baru:
1. Baca section 6 untuk cek existing features
2. Branch: `feat/<nama-fitur>` dari `main`
3. Schema baru → `migrations/0004_*.sql` (auto-apply via CD)
4. Urutan implementasi:
```
migrations/   → repository.ts → service.ts → tools.ts → prompt.ts → router.ts → formatter.ts → types/ → tests → AI_CONTEXT.md
```
5. Push → PR → CI pass → merge (squash)

### Memperbaiki Bug:
1. Branch: `fix/<deskripsi>` atau `hotfix/<deskripsi>`
2. Fix → push → PR → merge
3. Update AI_CONTEXT.md jika signifikan

### Menambah Parser Baru (untuk platform ojol lain):
1. Tambah regex di `src/parsers/detector.ts` → return format baru
2. Buat `src/parsers/<platform>.ts` dengan fungsi `parse<Platform>()`
3. Update switch di `src/parsers/index.ts`
4. Update metadata label di `src/handlers/photo.ts`
5. Tambah tests di `test/parsers/`

### Dual Model Considerations:
- NLU prompt: Tambah aturan normalize untuk input baru
- Executor prompt: Tambah tool mapping
- Tools schema: Keep minimal (37.5% of total tokens)
- Test: engine.spec.ts untuk validateToolCalls

---

## 16. Cara Pakai File Ini di Page Baru

Ketika memulai percakapan baru, user cukup bilang:

> "Baca file `AI_CONTEXT.md` di repo `lukim7711/ojol-cuanbot` branch `main`, lalu lanjutkan dari situ. Saya mau [tambah fitur X / fix bug Y / dll]."

AI akan membaca file ini dan langsung punya konteks lengkap tanpa perlu mengulang dari awal.

---

*Last updated: 2026-02-10 — Unified Shopee parser (food + SPX), OCR photo pipeline, 332 tests, 7 commands*
