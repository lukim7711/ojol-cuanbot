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
                type: { type: "string", enum: ["income", "expense"] },
                amount: { type: "integer", description: "Jumlah dalam Rupiah" },
                category: { type: "string" },
                description: { type: "string" },
                date_offset: { type: "integer", description: "0=hari ini, -1=kemarin" },
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
        "Catat hutang/piutang baru ATAU hutang lama yang baru diinput. Mendukung jatuh tempo, bunga, tenor, dan cicilan.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["hutang", "piutang"] },
          person_name: { type: "string", description: "Nama orang/lembaga" },
          amount: { type: "integer", description: "Jumlah pokok dalam Rupiah" },
          remaining: { type: "integer", description: "Sisa hutang saat ini (untuk hutang lama yang sudah pernah dicicil). Jika baru, kosongkan." },
          note: { type: "string", description: "Catatan opsional" },
          due_date: { type: "string", description: "Tanggal jatuh tempo format YYYY-MM-DD. Gunakan ini jika user sebut tanggal spesifik." },
          due_date_days: { type: "integer", description: "Jatuh tempo dalam X hari dari sekarang. Gunakan ini jika user bilang 'jatuh tempo 2 minggu'." },
          recurring_day: { type: "integer", description: "Tanggal berulang tiap bulan (1-28). Gunakan ini jika user bilang 'tiap tanggal 15'." },
          interest_rate: { type: "number", description: "Suku bunga dalam desimal. 2% = 0.02" },
          interest_type: { type: "string", enum: ["none", "flat", "daily"], description: "Tipe bunga: none (tanpa bunga), flat (bunga tetap per bulan), daily (bunga harian)" },
          tenor_months: { type: "integer", description: "Lama pinjaman dalam bulan" },
          installment_amount: { type: "integer", description: "Jumlah cicilan per periode dalam Rupiah" },
          installment_freq: { type: "string", enum: ["daily", "weekly", "monthly"], description: "Frekuensi cicilan" },
        },
        required: ["type", "person_name", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pay_debt",
      description: "Catat pembayaran/cicilan hutang atau penerimaan pembayaran piutang.",
      parameters: {
        type: "object",
        properties: {
          person_name: { type: "string" },
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
          period: { type: "string", enum: ["today", "yesterday", "this_week", "this_month", "custom"] },
          custom_start: { type: "string" },
          custom_end: { type: "string" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_debts",
      description: "Lihat daftar hutang dan/atau piutang yang masih aktif, termasuk status jatuh tempo.",
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
      name: "get_debt_history",
      description: "Lihat riwayat pembayaran hutang tertentu.",
      parameters: {
        type: "object",
        properties: {
          person_name: { type: "string", description: "Nama orang/lembaga" },
        },
        required: ["person_name"],
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
          target: { type: "string" },
          new_amount: { type: "integer" },
        },
        required: ["action", "target"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ask_clarification",
      description: "Gunakan HANYA jika pesan user ambigu atau data kurang lengkap.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
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
          person_name: { type: "string" },
          new_amount: { type: "integer" },
        },
        required: ["action", "person_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_daily_target",
      description: "Tampilkan target harian otomatis berdasarkan kewajiban, hutang, operasional, tabungan, dan goals.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_obligation",
      description: "Catat kewajiban tetap/rutin (cicilan, kontrakan, iuran, dll).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "integer" },
          frequency: { type: "string", enum: ["daily", "weekly", "monthly"] },
          note: { type: "string" },
        },
        required: ["name", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_goal",
      description: "Set goal/target menabung untuk beli sesuatu.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          target_amount: { type: "integer" },
          deadline_days: { type: "integer" },
        },
        required: ["name", "target_amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_saving",
      description: "Set jumlah tabungan minimum harian.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "integer" },
        },
        required: ["amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_obligation",
      description: "Hapus atau tandai selesai kewajiban tetap.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["delete", "done"] },
          name: { type: "string" },
        },
        required: ["action", "name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_goal",
      description: "Batalkan atau tandai tercapai goal.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["cancel", "done"] },
          name: { type: "string" },
        },
        required: ["action", "name"],
      },
    },
  },
] as const;
