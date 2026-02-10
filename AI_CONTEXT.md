# AI_CONTEXT.md — CuanBot Project Context

> **INSTRUKSI UNTUK AI**: File ini berisi seluruh konteks project CuanBot.
> Ketika user memulai percakapan baru dan meminta kamu membaca file ini,
> gunakan SEMUA informasi di bawah sebagai konteks kerja.
> Selalu update file ini setelah menambah fitur baru atau melakukan perubahan signifikan.
>
> **Last updated**: 2026-02-10 — Single model Llama 4 Scout, Unified Shopee parser, OCR pipeline, 332 tests

---

## 1. Overview Aplikasi

**CuanBot** adalah bot Telegram AI untuk manajemen keuangan harian driver ojek online Indonesia.

- **Target user**: Driver ojol (Shopee, Grab, Gojek, Maxim, dll)
- **Platform**: Telegram Bot
- **Interaksi**: Chat natural Bahasa Indonesia (informal, slang, singkatan) + screenshot foto
- **Bot username**: @ojol_finance_bot
- **Bot name**: Ojol Finance Assistant

### Value Proposition
Driver ojol bisa catat pemasukan/pengeluaran, hutang, dan target harian cukup dengan chat biasa atau kirim screenshot order — tanpa buka app keuangan ribet.

---

## 2. Tech Stack

| Layer | Teknologi | Detail |
|-------|-----------|--------|
| Runtime | Cloudflare Workers | Serverless, edge-deployed, entry: `src/index.ts` |
| Bot Framework | grammY v1.39+ | TypeScript-first, webhook mode |
| AI Model | Workers AI — **Llama 4 Scout 17B 16E Instruct** | Single model: slang conversion + function calling in one call |
| OCR | OCR.space API (Engine 2) | Extract text from screenshot photos, free 25K req/month |
| Local Parser | Regex-based (`src/parsers/`) | Bypass AI for known formats (Shopee), 0ms parse time |
| Database | Cloudflare D1 (SQLite) | Binding: `DB`, name: `cuanbot-db` |
| KV Store | Cloudflare KV | Binding: `RATE_LIMIT`, for rate limiting + message dedup + daily AI limit + delete confirm |
| Language | TypeScript strict | tsconfig strict mode |
| Testing | Vitest + @cloudflare/vitest-pool-workers | Workers-compatible test runner, **332 tests** |
| CI/CD | GitHub Actions | CI: test on push/PR; CD: auto migrate D1 + deploy on push to main |
| Config | wrangler.jsonc | compatibility_date: 2026-02-05, nodejs_compat flag |

### Environment & Secrets

| Binding/Secret | Type | Purpose |
|----------------|------|--------|
| `DB` | D1 Database | Main database (`cuanbot-db`) |
| `AI` | Workers AI | AI model inference (Llama 4 Scout) |
| `RATE_LIMIT` | KV Namespace | Rate limiting, message dedup, daily AI call counter, delete confirmation |
| `BOT_TOKEN` | Secret | Telegram Bot API token |
| `BOT_INFO` | Var (JSON) | grammY bot info: `{id, is_bot, first_name, username}` |
| `OCR_API_KEY` | Secret (optional) | OCR.space API key |
| `WEBHOOK_SECRET` | Secret (optional) | Telegram webhook verification |
| `CLOUDFLARE_API_TOKEN` | GitHub Secret | For deploy & D1 migration |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Secret | Cloudflare account ID |

Defined in: `src/config/env.ts`

---

## 3. Arsitektur

### 3.1 Single Model Pipeline (Llama 4 Scout)

> **PENTING**: Project ini TIDAK lagi menggunakan dual model (Qwen + Llama 3.3 70B).
> Sejak migrasi ke Llama 4 Scout 17B, SATU model menangani semuanya:
> slang conversion + function calling dalam 1 panggilan.
> Slang ditangani via tabel slang di system prompt, bukan model NLU terpisah.

```
Telegram → Webhook → Cloudflare Worker (src/index.ts)
                         |
                    grammY Bot (src/bot.ts)
                         |
              ┌──── Route by type ────┐──────────────────┐
              │                       │                  │
         /command              message:text          message:photo
         (zero AI)            (AI pipeline)         (OCR pipeline)
              │                    │                      │
         Direct handler      Message Handler         Photo Handler
         (start, rekap,      (src/handlers/           (src/handlers/
          target, hutang,     message.ts)              photo.ts)
          reset)                  │                      │
              │              ┌── Guards ──┐          See §3.2
              │              │ KV dedup   │
              │              │ Rate limit │
              │              │ Input guard│
              │              └─────┬──────┘
              │                    │
              │            ┌── Fast Path? ──┐
              │            │ CONFIRM_WORDS  │
              │            │ + pending KV   │
              │            └──┬──────┬──────┘
              │           YES │      │ NO
              │               │      │
              │          Skip AI   runAI()
              │          go to     (src/ai/engine.ts)
              │          router        │
              │               │   ┌── isCasualChat? ──┐
              │               │   │                   │
              │               │  YES                  NO
              │               │   │                   │
              │               │  chatWithLlama()   executeWithLlama()
              │               │  (no tools,         (with tools,
              │               │   casual prompt)     unified prompt)
              │               │       │                   │
              │               │       │           toolRouter.ts
              │               │       │           (select 4-5 tools
              │               │       │            from 15, Fase F)
              │               │       │                   │
              │               │       │           Llama 4 Scout
              │               │       │           @cf/meta/llama-4-scout-17b-16e-instruct
              │               │       │           (slang table in prompt +
              │               │       │            function calling)
              │               │       │                   │
              │               │       │           validateToolCalls()
              │               │       │           (maxItems, amount range,
              │               │       │            dedup by args hash,
              │               │       │            delete limiter)
              │               │       │                   │
              │               │       │           Retry if 0 tool calls
              │               │       │           (enhanced mode + ALL tools)
              │               │       │                   │
              └───────────────┴───────┴───────────────────┤
                                                          │
                               Service Router (src/services/router.ts)
                               ├── transaction.ts  → record income/expense
                               ├── debt.ts         → record/pay/list/history debts
                               ├── edit.ts         → edit/delete transactions
                               ├── edit-debt.ts    → edit/delete debts
                               ├── summary.ts      → rekap keuangan
                               ├── target.ts       → smart daily target
                               ├── deleteConfirm.ts → delete confirmation via KV
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
  (direct to DB,          (same single-model
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

### 3.5 Why Single Model (bukan Dual Model lagi)?

Project ini awalnya pakai dual model (Qwen NLU + Llama 3.3 70B FC).
Sekarang sudah **migrasi ke Llama 4 Scout 17B** sebagai single model.

| Aspek | Dual Model (lama) | Single Model (sekarang) |
|-------|-------------------|------------------------|
| Model | Qwen3-30B + Llama 3.3 70B | Llama 4 Scout 17B saja |
| Slang handling | Qwen NLU stage terpisah | Slang table di system prompt |
| Function calling | Llama 3.3 70B | Llama 4 Scout (sama kuat) |
| Latency | 2 sequential AI calls | 1 AI call saja |
| Token usage | ~3,735 per request | Lebih hemat (1 call) |
| Complexity | 3-stage pipeline | Simple single pipeline |

### 3.6 Token Estimation per Request

| Skenario | Llama 4 Scout | Note |
|----------|--------------|------|
| Transaksi normal | ~2,600 | With tool subset (Fase F) |
| Casual chat | ~600 | No tools, casual prompt |
| Photo (known format) | 0 | Local parser, bypass AI |
| Photo (unknown → AI) | ~2,600 | Same as text pipeline |
| Retry (enhanced) | ~5,200 | ALL 15 tools sent |

### 3.7 Dynamic Tool Selection (Fase F — src/ai/toolRouter.ts)

Regex-based pre-filter that narrows tool "menu" from 15 → 4-6 per request.
First match wins, order matters.

| Route | Pattern (keywords) | Tools sent |
|-------|-------------------|------------|
| QUERY | rekap, daftar, riwayat, target, berapa | 5 tools |
| EDIT | ubah, hapus, selesai, batal, salah | 5 tools |
| SETTING | cicilan, kewajiban, goal, nabung | 4 tools |
| DEBT | hutang, piutang, minjem, bayar | 6 tools |
| TRANSACTION | \d+, rb, goceng, makan, bensin | 4 tools |
| ALL (fallback) | no pattern match | 15 tools |

Every group includes `ask_clarification` as safe fallback.
On retry (enhanced mode), ALL 15 tools are sent.

### 3.8 CD Pipeline
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
│   │   ├── engine.ts         # Single model pipeline orchestrator
│   │   │                     #   runAI() — main entry point
│   │   │                     #   runPipeline() — casual vs financial routing
│   │   │                     #   isDailyLimitExceeded() — 200 calls/day via KV
│   │   │                     #   getNextMidnightWIBEpoch() — TTL calc for daily reset
│   │   │                     #   withTimeout() — 15s AI pipeline timeout
│   │   ├── executor.ts       # Llama 4 Scout interface
│   │   │                     #   Model: @cf/meta/llama-4-scout-17b-16e-instruct
│   │   │                     #   executeWithLlama() — FC mode (with tools)
│   │   │                     #   chatWithLlama() — chat mode (no tools)
│   │   │                     #   Fase F: dynamic tool subset from toolRouter
│   │   ├── parser.ts         # AI response parsing
│   │   │                     #   parseAIResponse() — OpenAI + legacy format
│   │   │                     #   parseToolArguments() — string→object
│   │   │                     #   deepParseArguments() — fix nested string→array
│   │   │                     #   stripThinkingTags() — remove <think> tags
│   │   ├── prompt.ts         # Prompt templates
│   │   │                     #   buildUnifiedPrompt(date) — FC + slang table + security rules
│   │   │                     #   buildCasualChatPrompt() — casual mode
│   │   ├── toolRouter.ts     # Dynamic tool selection (Fase F)
│   │   │                     #   selectToolsForMessage() — regex→tool group
│   │   │                     #   5 routes: QUERY, EDIT, SETTING, DEBT, TRANSACTION
│   │   ├── tools.ts          # 15 AI tool definitions + 5 tool groups
│   │   │                     #   Groups: TRANSACTION, DEBT, QUERY, EDIT, SETTING
│   │   ├── utils.ts          # getWIBDateString() — current date in WIB
│   │   └── validator.ts      # AI output validation
│   │                         #   isCasualChat() — narrow pattern detection
│   │                         #   validateToolCalls() — maxItems, amount, dedup, delete limit
│   │                         #   buildDedupKey() — name+args hash (Bug #11 fix)
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
│   │   ├── message.ts        # Text messages → AI single-model pipeline
│   │   │                     #   KV dedup (5min TTL) + rate limit + input guard
│   │   │                     #   Fast path: CONFIRM_WORDS + pending delete → skip AI
│   │   │                     #   Conversation history: 3 recent messages
│   │   │                     #   Tool context saved in assistant messages
│   │   └── photo.ts          # Photo messages → OCR → parser → AI fallback
│   │                         #   KV dedup + rate limit + cleanOCRForParser()
│   ├── middleware/
│   │   ├── inputGuard.ts     # sanitizeUserInput(), hasInjectionPatterns()
│   │   └── rateLimit.ts      # isRateLimited() — KV-based per telegram user
│   ├── parsers/
│   │   ├── detector.ts       # detectFormat(): shopee | grab | gopay | unknown
│   │   ├── index.ts          # tryParseOCR(): orchestrator, detectDateOffset()
│   │   └── shopee.ts         # parseShopee(): 3-pass regex (food + SPX + fallback)
│   ├── services/
│   │   ├── router.ts         # processToolCalls(): tool call dispatcher (15 routes)
│   │   ├── transaction.ts    # recordTransactions(): income/expense → D1
│   │   ├── debt.ts           # recordDebt(), payDebt(), getDebts(), getDebtHistory()
│   │   ├── edit.ts           # editTransaction(): 4-layer search
│   │   ├── edit-debt.ts      # editDebt(): soft delete, amount adjustment
│   │   ├── summary.ts        # getSummary(): today/yesterday/this_week/this_month/custom
│   │   ├── target.ts         # getDailyTarget(): obligations + debts + avg ops + savings + goals
│   │   ├── deleteConfirm.ts  # getPendingDelete(), setPendingDelete() — KV-based
│   │   ├── ocr.ts            # extractTextFromImage(), downloadTelegramPhoto()
│   │   └── user.ts           # getOrCreateUser(): find or create by telegram_id
│   ├── types/
│   │   ├── transaction.ts    # User, ParsedTransaction, ToolCallResult interfaces
│   │   └── ai-response.ts    # ToolCall, AIResult interfaces
│   └── utils/
│       ├── formatter.ts      # formatReply(): Telegram HTML builder
│       ├── date.ts           # getDateFromOffset(), getDateRange() — WIB timezone
│       └── validator.ts      # validateAmount(), sanitizeString() — XSS prevention
├── migrations/
│   ├── 0001_init.sql         # users, transactions, categories, debts, debt_payments, conversation_logs
│   ├── 0002_smart_target.sql # obligations, goals, user_settings
│   └── 0003_smart_debt.sql   # ALTER debts: +8 columns
├── test/
│   ├── index.spec.ts         # Worker entry point (3 tests)
│   ├── env.d.ts              # Test environment types
│   ├── tsconfig.json         # Test-specific tsconfig
│   ├── ai/
│   │   └── engine.spec.ts    # AI engine (24 tests)
│   ├── handlers/             # Handler-level tests
│   ├── middleware/            # Rate limit, input guard tests
│   ├── parsers/
│   │   ├── detector.spec.ts  # Format detection (17 tests)
│   │   ├── shopeefood.spec.ts # Shopee parser (20 tests)
│   │   └── index.spec.ts     # Parser orchestrator (11 tests)
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
  installment_freq TEXT DEFAULT 'monthly',
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
  note TEXT, source_text TEXT,
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

#### 6.1 Catat Transaksi (Single Model — Llama 4 Scout)
- Input natural: "dapet 120rb, makan 25rb, bensin 30rb"
- **Slang conversion via system prompt**: goceng→5000, gocap→50000, ceban→10000, seceng→1000
- Llama 4 Scout handles slang + function calling in single call
- Kategori otomatis, date offset, multi transaksi (max 10)
- Auto-progress bar setelah catat income
- Validation: Rp1–Rp100.000.000, dedup by name+args hash
- Service: `src/services/transaction.ts`

#### 6.2 Screenshot Order — OCR + Local Parser
- **Driver kirim screenshot** riwayat order Shopee → auto-parse semua transaksi
- **OCR**: OCR.space Engine 2, ~1-3s, max 1MB photo
- **Local parser (0ms)**: Regex-based, bypass AI completely
  - Detects: ShopeeFood + SPX (package delivery)
  - 3-pass: food regex → SPX regex → fallback time+Rp
  - Amount parsing handles OCR artifacts: comma, dot, colon, apostrophe
  - Date offset from screenshot header ("09 Feb 2026" → -1)
- **AI fallback**: Unknown formats → same single-model pipeline as text
- **Dedup**: KV-based, 5min TTL, prevents duplicate from Telegram retry
- **Performance**: Known format 1.4s total (was 10.5s timeout), 0 AI calls
- Handler: `src/handlers/photo.ts`
- Parser: `src/parsers/shopee.ts`, `src/parsers/detector.ts`, `src/parsers/index.ts`
- OCR: `src/services/ocr.ts`

#### 6.3 Hutang & Piutang (Smart Debt)
- Catat hutang/piutang, jatuh tempo, bunga (flat/daily), cicilan & tenor
- Overdue detection, next payment tracking, bayar → auto-update remaining
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
- **Delete confirmation**: 2-step via KV (setPendingDelete → confirm/cancel)
- **Max 1 delete per message** (Phase 3 security)
- Service: `src/services/edit.ts`, `src/services/edit-debt.ts`, `src/services/deleteConfirm.ts`

#### 6.7 Slash Commands (Zero AI — 0 neurons)

| Command | Handler | Function |
|---------|---------|----------|
| `/start` | `handlers/start.ts` | Onboarding, auto-create user |
| `/help` | `handlers/start.ts` | Same as /start |
| `/reset` | `handlers/reset.ts` | Confirm prompt for full data wipe |
| `/confirm_reset` | `handlers/reset.ts` | Execute wipe |
| `/rekap` | `handlers/rekap.ts` | Shortcut rekap hari ini |
| `/target` | `handlers/target.ts` | Shortcut target harian |
| `/hutang` | `handlers/hutang.ts` | Shortcut daftar hutang aktif |

Registered in: `src/bot.ts`

#### 6.8 Security & Middleware (Phase 3)
- **Rate limit**: KV-based per telegram user (`src/middleware/rateLimit.ts`)
- **Input guard**: `sanitizeUserInput()`, `hasInjectionPatterns()` (`src/middleware/inputGuard.ts`)
- **Message dedup**: KV-based idempotency for text + photo (5min TTL)
- **Daily AI call limit**: 200 calls/user/day via KV, reset at midnight WIB
- **Delete limiter**: Max 1 delete operation per request (`validator.ts`)
- **Security prompt rules**: Off-topic rejection, role injection defense, delete restriction
- **Delete confirmation fast path**: CONFIRM_WORDS bypass AI (Bug 4 fix, saves ~42 neurons)
- **Amount validation**: Rp1–Rp100.000.000 (`src/utils/validator.ts`)
- **HTML sanitize**: Prevent XSS in Telegram responses

#### 6.9 AI Engine — Single Model Pipeline (src/ai/engine.ts)
- **Model**: `@cf/meta/llama-4-scout-17b-16e-instruct` (satu model untuk semua)
- **Casual chat**: `isCasualChat()` → `chatWithLlama()` — no tools, casual prompt
- **Financial input**: `executeWithLlama()` — with tools + unified prompt (slang table built-in)
- **Validation**: `validateToolCalls()` — maxItems, amount range, dedup by args hash, delete limit
- **Retry**: If 0 tool calls → retry with enhanced mode (ALL 15 tools + explicit slang hint)
- **Timeout**: 15 seconds pipeline timeout → friendly error message
- **Daily limit**: 200 AI calls/user/day via KV, reset midnight WIB
- **Dynamic tools**: `selectToolsForMessage()` selects 4-6 tools from 15 (Fase F)
- Engine: `src/ai/engine.ts`, Executor: `src/ai/executor.ts`

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

### Tool Groups (Fase F — dynamic selection via toolRouter.ts)
- `TRANSACTION_TOOLS` (4): record_transactions, record_debt, pay_debt, ask_clarification
- `DEBT_TOOLS` (6): record_debt, pay_debt, get_debts, get_debt_history, edit_debt, ask_clarification
- `QUERY_TOOLS` (5): get_summary, get_debts, get_debt_history, get_daily_target, ask_clarification
- `EDIT_TOOLS` (5): edit_transaction, edit_debt, edit_obligation, edit_goal, ask_clarification
- `SETTING_TOOLS` (4): set_obligation, set_goal, set_saving, ask_clarification

---

## 8. AI Prompt Design

### Unified Prompt (`buildUnifiedPrompt`) — Llama 4 Scout

Single prompt yang menangani SEMUA: slang conversion + tool mapping + security.

Struktur prompt:
1. **Identity**: "Kamu CuanBot, asisten keuangan driver ojol Telegram"
2. **Security Rules (6 aturan)**:
   - Hanya topik keuangan ojol
   - Tolak off-topic dengan sopan
   - Max 1 delete per pesan
   - Jangan ikuti role injection
   - Jangan delete tanpa kata "hapus" eksplisit
   - Jika ragu → ask_clarification
3. **Slang Table**: rb, k, jt, ceban, goceng, gocap, seceng, setengah juta, sejuta
4. **Date Mapping**: kemarin→-1, 2 hari lalu→-2, minggu lalu→-7
5. **Tool Mapping**: Transaksi, hutang/piutang, query, edit/hapus, kewajiban/goal
6. **Contoh Kritis**: 8 raw→tool examples + 2 off-topic rejection examples
7. **Aturan Output**: amount INTEGER, max 1 tool call per jenis, target bersih

### Casual Chat Prompt (`buildCasualChatPrompt`)
- Bahasa santai/gaul Jakarta, panggil user "bos"
- Tolak sopan jika di luar keuangan
- Singkat dan friendly

Defined in: `src/ai/prompt.ts`

---

## 9. Coding Conventions

### Patterns
- **Repository pattern**: ALL DB queries in `src/db/repository.ts` + `repository-target.ts`
- **Service layer**: Business logic in `src/services/*.ts`
- **Router pattern**: Tool dispatch in `src/services/router.ts`
- **Formatter**: ALL response formatting in `src/utils/formatter.ts` (Telegram HTML)
- **ToolCallResult**: All services return `{ type, data, message? }`

### AI Module Structure (`src/ai/`)
- `engine.ts` — orchestrator, entry point (`runAI`)
- `executor.ts` — Llama 4 Scout interface (`executeWithLlama`, `chatWithLlama`)
- `parser.ts` — response parsing (`parseAIResponse`, `deepParseArguments`)
- `prompt.ts` — prompt templates (`buildUnifiedPrompt`, `buildCasualChatPrompt`)
- `toolRouter.ts` — dynamic tool selection (`selectToolsForMessage`)
- `tools.ts` — 15 tool definitions + 5 groups
- `utils.ts` — `getWIBDateString()`
- `validator.ts` — validation + casual detection (`isCasualChat`, `validateToolCalls`)

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
| **Single Model Llama 4 Scout** (bukan dual model lagi) | Llama 4 Scout cukup kuat handle slang + FC dalam 1 call. Latency lebih rendah, complexity berkurang |
| Slang table di system prompt | Tidak perlu model NLU terpisah — slang table cukup efektif di Llama 4 Scout |
| Dynamic tool selection (Fase F) | Kirim 4-6 tools bukan 15 → hemat tokens, lebih fokus |
| Delete confirmation 2-step (KV) | Prevent accidental delete. Fast path skip AI untuk konfirmasi |
| Daily AI limit 200/user | Prevent abuse + budget control. Reset midnight WIB via absolute KV expiration |
| Security prompt rules (Phase 3) | Off-topic rejection, role injection defense, single delete limit |
| Dedup by name + args hash (Bug #11) | Allow multiple record_debt with different args |
| Workers AI (bukan OpenAI) | Gratis, low latency, no external API key |
| D1 (bukan Postgres) | Zero-config, gratis, cukup untuk single-bot |
| Local parser sebelum AI | Shopee = 0ms parse, 0 AI calls → hemat neurons |
| KV dedup (5min TTL) | Telegram retries webhook → prevent double recording |
| deepParseArguments() | Llama kadang return string bukan array → auto-fix |

---

## 11. Known Issues & Quirks

| Issue | Detail | Workaround |
|-------|--------|------------|
| `<think>` tags | Model kadang wrap response | `stripThinkingTags()` in parser.ts |
| String transactions | AI returns JSON string bukan array | `deepParseArguments()` in parser.ts |
| Retry needed | Kadang 0 tool calls pada first attempt | Auto-retry with enhanced mode + ALL tools |
| Empty reply | AI return tool calls tanpa text | "Diproses!" fallback in formatter |
| Pipeline timeout | Workers AI hang | 15s timeout → friendly error |
| OCR 1MB limit | OCR.space free tier | Error message + suggest compress |
| Daily limit edge | Counter reset at midnight WIB | `getNextMidnightWIBEpoch()` absolute expiration |

---

## 12. Test Coverage (332 tests, all pass)

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `test/index.spec.ts` | 3 | Worker entry point |
| `test/ai/engine.spec.ts` | 24 | AI engine: parse, validate, casual, deepParse |
| `test/parsers/detector.spec.ts` | 17 | ShopeeFood, SPX, Grab, GoPay, unknown |
| `test/parsers/shopeefood.spec.ts` | 20 | Shopee parser: food, SPX, mixed, real-world |
| `test/parsers/index.spec.ts` | 11 | tryParseOCR, detectDateOffset |
| `test/services/router.spec.ts` | 11 | All 15 tool routes |
| `test/services/transaction.spec.ts` | 15 | Recording, validation, category |
| `test/services/debt.spec.ts` | ~12 | Interest, overdue, payment |
| `test/services/edit.spec.ts` | 13 | Delete, edit, 4-layer search |
| `test/services/edit-debt.spec.ts` | 8 | Soft delete, amount adjustment |
| `test/services/summary.spec.ts` | 7 | Totals, period labels |
| `test/services/user.spec.ts` | 5 | Get existing, create new |
| `test/services/target.spec.ts` | varies | Smart target calculation |
| `test/utils/validator.spec.ts` | 19 | validateAmount, sanitizeString |
| `test/utils/date.spec.ts` | 12 | getDateFromOffset, getDateRange |
| `test/utils/formatter.spec.ts` | 19 | formatRupiah, formatReply |
| + handlers, middleware tests | varies | Various handler/middleware coverage |
| **Total** | **332** | **All pass** |

---

## 13. Changelog

| Tanggal | Event | PR |
|---------|-------|----|
| 2026-02-06 | Initial setup: CF Worker + grammY + D1 | — |
| 2026-02-06 | Hutang/piutang v1, edit/delete, summary | — |
| 2026-02-07 | Smart target, smart debt, test suite v1 | #2–#10 |
| 2026-02-08 | Cleanup, hardening, auto-migration CD | #12–#18 |
| 2026-02-08 | Dual model pipeline (Qwen + Llama 3.3 70B) | #23 |
| 2026-02-08 | Live test 91% pass | — |
| 2026-02-09 | OCR photo pipeline + ShopeeFood parser | #34–#38 |
| 2026-02-09 | Photo dedup, rate limit, error handling | #39–#41 |
| 2026-02-10 | Unified Shopee parser (food + SPX) | #43 |
| 2026-02-10 | **Migrated to single model: Llama 4 Scout 17B** | — |
| 2026-02-10 | Dynamic tool routing (Fase F) | — |
| 2026-02-10 | Security hardening Phase 3: input guard, daily limit, delete limiter | — |
| 2026-02-10 | Bug fixes: #4 (delete confirm fast path), #6 (daily TTL), #11 (dedup hash) | — |
| 2026-02-10 | Documentation update (AI_CONTEXT.md v3 — accurate single model) | #44 |

---

## 14. Instruksi untuk AI (Workflow)

### Menambah Fitur Baru:
1. Baca section 6 untuk cek existing features
2. Branch: `feat/<nama-fitur>` dari `main`
3. Schema baru → `migrations/0004_*.sql` (auto-apply via CD)
4. Urutan implementasi:
```
migrations/ → repository.ts → service.ts → tools.ts → prompt.ts → toolRouter.ts → router.ts → formatter.ts → types/ → tests → AI_CONTEXT.md
```
5. Push → PR → CI pass → merge (squash)

### Memperbaiki Bug:
1. Branch: `fix/<deskripsi>` atau `hotfix/<deskripsi>`
2. Fix → push → PR → merge
3. Update AI_CONTEXT.md jika signifikan

### Menambah Parser Baru:
1. Tambah regex di `src/parsers/detector.ts` → return format baru
2. Buat `src/parsers/<platform>.ts` dengan fungsi `parse<Platform>()`
3. Update switch di `src/parsers/index.ts`
4. Update metadata label di `src/handlers/photo.ts`
5. Tambah tests di `test/parsers/`

### AI Model Considerations:
- Model saat ini: `@cf/meta/llama-4-scout-17b-16e-instruct`
- Prompt: `buildUnifiedPrompt()` — slang table + security + tool mapping
- Tool routing: `selectToolsForMessage()` — tambah pattern jika tool group baru
- Validation: `validateToolCalls()` — tambah rules jika perlu
- Tests: engine.spec.ts untuk validateToolCalls

---

## 15. Cara Pakai File Ini di Page Baru

Ketika memulai percakapan baru, user cukup bilang:

> "Baca file `AI_CONTEXT.md` di repo `lukim7711/ojol-cuanbot` branch `main`, lalu lanjutkan dari situ. Saya mau [tambah fitur X / fix bug Y / dll]."

AI akan membaca file ini dan langsung punya konteks lengkap tanpa perlu mengulang dari awal.

---

*Last updated: 2026-02-10 — Single model Llama 4 Scout 17B, Unified Shopee parser (food + SPX), OCR pipeline, Security Phase 3, 332 tests*
