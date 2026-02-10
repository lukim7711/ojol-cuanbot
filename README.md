# 🏍️ CuanBot — Ojol Finance Assistant

Bot Telegram AI untuk manajemen keuangan harian driver ojek online Indonesia.

> Catat pemasukan, pengeluaran, hutang — cukup chat biasa atau kirim screenshot order.

**Bot**: [@ojol_finance_bot](https://t.me/ojol_finance_bot)

---

## ✨ Fitur Utama

### 💬 Chat Natural Language
Ketik seperti biasa, bot paham:
```
"dapet 120rb, makan 25rb, bensin 30rb"
"bonus gocap"              → Rp50.000
"rokok goceng"             → Rp5.000
"2 hari lalu bensin 40rb"  → catat di tanggal 2 hari lalu
```

### 📷 Screenshot Order → Auto-Parse
Kirim screenshot riwayat order Shopee — bot otomatis baca semua transaksi:
```
✅ Tercatat!
💰 Pemasukan: Rp18.400 — ShopeeFood 22:30
💰 Pemasukan: Rp12.000 — ShopeeFood 21:43
💰 Pemasukan: Rp27.200 — SPX 18:25
💰 Pemasukan: Rp30.400 — SPX 17:06
💰 Pemasukan: Rp32.800 — SPX 16:00

📋 Auto-parsed dari Shopee (6 food, 3 paket)
```
- ShopeeFood + SPX (paket marketplace) dikenali otomatis
- 0 panggilan AI — pure regex, 0ms parse time
- Format lain → AI fallback

### 💸 Hutang & Piutang
```
"hutang ke Siti 1jt, jatuh tempo 30 hari lagi"
"Andi bayar 100rb"
"riwayat hutang Andi"
```
- Jatuh tempo, bunga, cicilan
- Overdue detection + urgency sorting
- Riwayat pembayaran per orang

### 🎯 Smart Target Harian
Bot hitung berapa yang harus dicapai hari ini:
```
🎯 Target: Rp285.000/hari
├── Kewajiban: Rp50.000
├── Cicilan hutang: Rp35.000
├── Operasional: Rp120.000
├── Tabungan: Rp50.000
└── Buffer 10%: Rp28.500

📊 Progress: ████████░░ 78% (Rp222.400)
```

### ✏️ Edit & Hapus
```
"yang bensin tadi ubah jadi 35rb"
"hapus yang rokok"
"yang terakhir salah, harusnya 250rb"
```
2-step delete confirmation untuk keamanan.

---

## 📱 Slash Commands

| Command | Fungsi |
|---------|--------|
| `/start` | Mulai & panduan |
| `/help` | Panduan penggunaan |
| `/rekap` | Rekap keuangan hari ini |
| `/target` | Target harian + progress |
| `/hutang` | Daftar hutang aktif |
| `/reset` | Hapus semua data |

Semua command **zero AI** — langsung query database, 0 neurons.

---

## 🏗️ Tech Stack

| Layer | Teknologi |
|-------|----------|
| Runtime | Cloudflare Workers (serverless, edge) |
| Bot | grammY (TypeScript, webhook mode) |
| AI | Llama 4 Scout 17B (single model: slang + function calling) |
| OCR | OCR.space Engine 2 |
| Parser | Regex-based (Shopee: food + SPX) |
| Database | Cloudflare D1 (SQLite) |
| KV | Cloudflare KV (rate limit, dedup, daily counter) |
| Tests | Vitest — **332 tests** |
| CI/CD | GitHub Actions (test → migrate → deploy) |

### Architecture

```
[Telegram] → [CF Worker] → [grammY Bot]
                               |
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
     /command              text msg              photo msg
     (zero AI)           (single model)        (OCR pipeline)
         │                     │                     │
     Direct DB          Llama 4 Scout          OCR.space → Parser
                        (slang table in             │
                         prompt + FC)          Known? → DB
                               │               Unknown? → AI
                               │                     │
                          Service Router ←────────────┘
                               │
                          Cloudflare D1
```

### Single Model Pipeline
Kenapa 1 model saja?
- **Llama 4 Scout** cukup kuat handle slang Indonesia via tabel di system prompt
- Function calling reliable dalam satu panggilan
- Latency lebih rendah (1 AI call vs 2 sequential)
- Complexity pipeline berkurang signifikan

### Dynamic Tool Selection (Fase F)
Regex pre-filter kirim hanya 4-6 tools (dari 15) per request → hemat tokens.

### Local Parser (Shopee)
Kenapa regex, bukan AI?
- Screenshot Shopee format konsisten → regex cukup
- **0ms** parse (vs 3-5s AI) → jauh lebih cepat
- **0 AI calls** → hemat daily neurons budget
- 3-pass: ShopeeFood → SPX → fallback

---

## 📂 Project Structure

```
src/
├── index.ts          # Worker entry
├── bot.ts            # grammY setup + command routing
├── ai/               # Single model pipeline (engine, executor, parser, prompt,
│                     #   toolRouter, tools, utils, validator)
├── config/           # Environment types
├── db/               # Repository layer (all SQL queries)
├── handlers/         # Command + message + photo handlers
├── middleware/        # Rate limit, input guard
├── parsers/          # OCR format detection + Shopee parser
├── services/         # Business logic (transaction, debt, target, etc.)
├── types/            # TypeScript interfaces
└── utils/            # Formatter, date, validator

migrations/           # D1 SQL migrations (auto-applied on deploy)
test/                 # 332 tests mirroring src/ structure
```

---

## 🚀 Development

### Prerequisites
- Node.js 18+
- Cloudflare account (free tier)
- Telegram Bot token (from @BotFather)
- OCR.space API key (free tier, optional)

### Setup
```bash
npm install

# Set secrets
npx wrangler secret put BOT_TOKEN
npx wrangler secret put OCR_API_KEY

# Apply migrations
npx wrangler d1 migrations apply cuanbot-db --local   # local dev
npx wrangler d1 migrations apply cuanbot-db --remote  # production

# Dev
npx wrangler dev

# Test
npm test

# Deploy
npx wrangler deploy
```

### CI/CD
- **CI**: Tests run on every push/PR to `main`
- **CD**: Push to `main` → test → migrate D1 → deploy worker
- Zero terminal lokal needed for deployment

---

## 🤖 AI Context

Untuk melanjutkan development di percakapan AI baru, baca [`AI_CONTEXT.md`](./AI_CONTEXT.md) — berisi dokumentasi lengkap arsitektur, schema, fitur, dan workflow.

```
"Baca file AI_CONTEXT.md di repo lukim7711/ojol-cuanbot branch main,
 lalu lanjutkan dari situ. Saya mau [tambah fitur X]."
```

---

## 📊 Stats

- **Model**: Llama 4 Scout 17B (single model)
- **Tests**: 332 (all pass)
- **Source files**: 30+
- **Migrations**: 3
- **AI tools**: 15 definitions, 5 groups
- **Commands**: 7 slash commands
- **Parsers**: 1 (Shopee: food + SPX)

---

*Built with ❤️ for Indonesian ojol drivers*
