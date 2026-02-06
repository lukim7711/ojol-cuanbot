// Definisi tools untuk Workers AI function calling
// Ref: https://developers.cloudflare.com/workers-ai/features/function-calling/traditional/

export const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "record_transactions",
      description:
        "Catat satu atau lebih transaksi keuangan (pemasukan dan/atau pengeluaran) dari pesan user.",
      parameters: {
        type: "object",
        properties: {
          transactions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["income", "expense"],
                  description: "income = pemasukan, expense = pengeluaran",
                },
                amount: {
                  type: "integer",
                  description: "Jumlah dalam Rupiah penuh (integer). Contoh: 59000, 1500000",
                },
                category: {
                  type: "string",
                  description:
                    "Kategori: orderan, bonus, tip, lainnya (income) atau makan, bensin, servis, pulsa, rokok, parkir, lainnya (expense)",
                },
                description: {
                  type: "string",
                  description: "Deskripsi singkat, misal: 'makan di bu tami'",
                },
                date_offset: {
                  type: "integer",
                  description: "0 = hari ini, -1 = kemarin, -2 = 2 hari lalu. Default: 0",
                },
              },
              required: ["type", "amount", "category", "description"],
            },
          },
        },
        required: ["transactions"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "record_debt",
      description:
        "Catat hutang baru (user berhutang ke orang lain) atau piutang baru (orang lain berhutang ke user).",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["hutang", "piutang"] },
          person_name: { type: "string", description: "Nama orang terkait" },
          amount: { type: "integer", description: "Jumlah dalam Rupiah" },
          note: { type: "string", description: "Catatan opsional" },
        },
        required: ["type", "person_name", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pay_debt",
      description:
        "Catat pembayaran/cicilan hutang atau penerimaan pembayaran piutang.",
      parameters: {
        type: "object",
        properties: {
          person_name: { type: "string", description: "Nama orang" },
          amount: { type: "integer", description: "Jumlah yang dibayar" },
        },
        required: ["person_name", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_summary",
      description: "Tampilkan ringkasan/rekap keuangan user.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "yesterday", "this_week", "this_month", "custom"],
          },
          custom_start: { type: "string", description: "YYYY-MM-DD" },
          custom_end: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_debts",
      description: "Lihat daftar hutang dan/atau piutang yang masih aktif.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["hutang", "piutang", "all"] },
        },
        required: ["type"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_transaction",
      description: "Koreksi atau hapus transaksi yang sudah dicatat.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["edit", "delete"] },
          target: { type: "string", description: "Deskripsi transaksi yang dimaksud" },
          new_amount: { type: "integer", description: "Jumlah baru (hanya untuk edit)" },
        },
        required: ["action", "target"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ask_clarification",
      description:
        "Gunakan HANYA jika pesan user ambigu atau data kurang lengkap untuk dicatat.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Pertanyaan klarifikasi" },
        },
        required: ["message"],
      },
    },
  },
  {
  type: "function" as const,
  function: {
    name: "edit_debt",
    description: "Koreksi atau hapus data hutang/piutang yang sudah dicatat.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["edit", "delete"] },
        person_name: { type: "string", description: "Nama orang pada hutang yang dimaksud" },
        new_amount: { type: "integer", description: "Jumlah baru (hanya untuk edit)" },
      },
      required: ["action", "person_name"],
    },
  },
},

] as const;
