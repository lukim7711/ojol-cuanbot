# 🏍️ CuanBot — Asisten Keuangan Driver Ojol

> Bot Telegram AI untuk manajemen keuangan harian driver ojek online Indonesia. Cukup chat natural, otomatis tercatat.

[![Deploy to Cloudflare Workers](https://github.com/lukim7711/ojol-cuanbot/actions/workflows/deploy.yml/badge.svg)](https://github.com/lukim7711/ojol-cuanbot/actions/workflows/deploy.yml)

## ✨ Fitur

### 📝 Catat Transaksi (NLP)
Chat biasa langsung tercatat — paham singkatan, slang, dan bahasa informal.

```
"dapet 120rb orderan grab"          → 💰 Pemasukan: Rp120.000
"makan 25rb, bensin 30rb"           → 💸 Pengeluaran: Rp25.000 + Rp30.000
"kemarin dapet 200rb dari gojek"    → 💰 Pemasukan (kemarin): Rp200.000
```

### 💳 Hutang & Piutang
Catat hutang/piutang dengan jatuh tempo, bunga, dan cicilan.

```
"minjem ke Budi 500rb jatuh tempo tanggal 20"
"gue punya hutang ke Kredivo 1.5jt bunga 2% per bulan 6 bulan"
"hutang motor ke FIF 8jt, sisa 5jt, cicilan 500rb per bulan tanggal 5"
"bayar Kredivo 280rb"
"riwayat bayar hutang Kredivo"
"cek hutang"
```

Fitur hutang:
- **Jatuh tempo fleksibel** — tanggal absolut, offset hari, atau tanggal berulang
- **Support hutang lama** — input hutang yang sudah berjalan sebelum pakai bot
- **Bunga otomatis** — flat (per bulan) dan daily (per hari)
- **Tracking cicilan** — cicilan ke-berapa, sisa berapa, next payment kapan
- **Deteksi overdue** — ⚠️ TELAT, ⏳ segera, 📅 aman
- **Riwayat pembayaran** — lihat semua pembayaran per hutang

### 🎯 Smart Daily Target
Target harian otomatis dihitung dari semua kewajiban finansial.

```
"cicilan gopay 50rb per hari"       → Kewajiban tercatat
"kontrakan 500rb per bulan"         → Kewajiban tercatat
"nabung minimal 20rb per hari"      → Tabungan diset
"mau beli helm 300rb target 30 hari"→ Goal tercatat
"target gue berapa?"                → 🎯 Target Hari Ini: Rp176.734
```

Komponen target:
- ✅ Kewajiban tetap (cicilan, kontrakan, iuran)
- ✅ Cicilan hutang aktif (auto-prioritas overdue)
- ✅ Estimasi operasional (rata-rata 7 hari terakhir)
- ✅ Tabungan harian
- ✅ Goals (nabung beli sesuatu)
- ✅ Buffer 10%

### 📊 Auto-Progress Bar
Setiap catat pemasukan, progress target otomatis muncul:

```
"dapet 80rb"
→ ✅ Tercatat! 💰 Pemasukan: Rp80.000 — orderan harian
  ━━━━━━━━━━━━━━
  🎉 TARGET TERCAPAI! ██████████ 113%
  💵 Surplus: Rp23.266
  Mantap bos, istirahat yang cukup ya! 😎
```

### 📈 Rekap Keuangan
```
"rekap hari ini"     → Ringkasan pemasukan & pengeluaran hari ini
"rekap kemarin"      → Ringkasan kemarin
"rekap minggu ini"   → Ringkasan minggu ini
"rekap bulan ini"    → Ringkasan bulan ini
```

### ✏️ Edit & Hapus
```
"yang makan tadi salah, harusnya 20rb"   → Edit transaksi
"hapus yang bensin"                       → Hapus transaksi
"yang hutang ke Budi salah, harusnya 300rb" → Edit hutang
```

## 🏗️ Arsitektur

```
Telegram User
    │
    ▼
┌─────────────────────┐
│   Telegram Bot API   │  (grammY)
│   Webhook Handler    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Cloudflare Worker  │  (TypeScript)
│                      │
│  ┌──────────────┐   │
│  │   AI Engine   │   │  OpenAI-compatible (Workers AI)
│  │  NLP → Tools  │   │  Function calling
│  └──────┬───────┘   │
│         │            │
│  ┌──────▼───────┐   │
│  │   Services    │   │  Business logic
│  │  Router       │   │  Transaction, Debt, Target
│  └──────┬───────┘   │
│         │            │
│  ┌──────▼───────┐   │
│  │   D1 Database │   │  SQLite (serverless)
│  └──────────────┘   │
└─────────────────────┘
```

## 🛠️ Tech Stack

| Layer | Teknologi | Alasan |
|-------|-----------|--------|
| **Runtime** | Cloudflare Workers | Serverless, edge-deployed, gratis 100k req/hari |
| **Bot Framework** | grammY | Lightweight, TypeScript-first, Cloudflare-friendly |
| **AI/NLP** | Workers AI (OpenAI-compatible) | Function calling, bahasa Indonesia |
| **Database** | Cloudflare D1 (SQLite) | Serverless SQL, zero-config, free tier |
| **Language** | TypeScript | Type safety, DX |
| **CI/CD** | GitHub Actions | Auto deploy on push to main |
| **Testing** | Vitest | Fast, Workers-compatible |

## 📁 Struktur Project

```
ojol-cuanbot/
├── src/
│   ├── index.ts              # Cloudflare Worker entry point
│   ├── bot.ts                # grammY bot setup
│   ├── ai/
│   │   ├── prompt.ts         # System prompt & rules
│   │   └── tools.ts          # AI function definitions
│   ├── config/
│   │   └── env.ts            # Environment config
│   ├── db/
│   │   ├── repository.ts     # Core DB queries
│   │   └── repository-target.ts # Target-related queries
│   ├── handlers/
│   │   └── message.ts        # Telegram message handler
│   ├── services/
│   │   ├── router.ts         # Tool call router
│   │   ├── transaction.ts    # Income/expense logic
│   │   ├── debt.ts           # Hutang/piutang + smart debt
│   │   ├── edit.ts           # Edit/delete transactions
│   │   ├── edit-debt.ts      # Edit/delete debts
│   │   ├── summary.ts        # Rekap keuangan
│   │   └── target.ts         # Smart daily target
│   ├── types/
│   │   └── transaction.ts    # TypeScript interfaces
│   └── utils/
│       ├── formatter.ts      # Response formatting (Telegram HTML)
│       ├── date.ts           # Date utilities (WIB timezone)
│       └── validator.ts      # Input validation & sanitization
├── migrations/
│   ├── 0001_init.sql         # Users, transactions, debts, categories
│   ├── 0002_smart_target.sql # Obligations, goals, user_settings
│   └── 0003_smart_debt.sql   # Due date, interest, installments
├── test/
│   └── services/
│       ├── transaction.spec.ts
│       └── debt.spec.ts      # Interest calc, overdue, next payment
├── .github/
│   └── workflows/
│       └── deploy.yml        # CI/CD: test → deploy
├── wrangler.jsonc             # Cloudflare config
├── package.json
└── tsconfig.json
```

## 🚀 Setup & Deploy

### Prerequisites
- Node.js ≥ 18
- Cloudflare account (free tier)
- Telegram Bot Token (dari [@BotFather](https://t.me/BotFather))

### 1. Clone & Install
```bash
git clone https://github.com/lukim7711/ojol-cuanbot.git
cd ojol-cuanbot
npm install
```

### 2. Setup Cloudflare D1
```bash
npx wrangler login
npx wrangler d1 create cuanbot-db
```

Update `wrangler.jsonc` dengan database ID yang didapat.

### 3. Run Migrations
```bash
npx wrangler d1 execute DB --remote --file=migrations/0001_init.sql
npx wrangler d1 execute DB --remote --file=migrations/0002_smart_target.sql
npx wrangler d1 execute DB --remote --file=migrations/0003_smart_debt.sql
```

### 4. Set Secrets
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put AI_API_KEY
```

### 5. Deploy
```bash
npm run deploy
```

### 6. Set Webhook
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<WORKER_URL>/webhook"
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test
npx vitest run test/services/debt.spec.ts
```

Test coverage:
- Interest calculation (flat, daily, no interest)
- Overdue detection (overdue, urgent, soon, ok)
- Next payment date calculation (monthly, weekly, daily)
- Amount parsing dan validation

## 📊 Database Schema

### Core Tables
- **users** — Telegram user mapping
- **transactions** — Pemasukan & pengeluaran
- **categories** — Kategori transaksi
- **debts** — Hutang/piutang + due date, bunga, cicilan
- **debt_payments** — Riwayat pembayaran hutang

### Target Tables
- **obligations** — Kewajiban tetap (cicilan, kontrakan)
- **goals** — Target nabung (beli sesuatu)
- **user_settings** — Pengaturan user (tabungan harian, dll)

### Conversation
- **conversation_logs** — Riwayat chat untuk context AI

## 🔮 Roadmap

- [ ] Potongan platform otomatis (Grab 20%, Gojek 20%, dll)
- [ ] Multi-user support
- [ ] Notifikasi/reminder jatuh tempo
- [ ] Export data (PDF/CSV rekap bulanan)
- [ ] Dashboard web dengan grafik

## 📄 License

MIT © 2026
