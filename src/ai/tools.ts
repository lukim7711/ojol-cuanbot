export const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "record_transactions",
      description: "Catat transaksi pemasukan/pengeluaran.",
      parameters: {
        type: "object",
        properties: {
          transactions: {
            type: "array",
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["income", "expense"] },
                amount: { type: "integer" },
                category: { type: "string" },
                description: { type: "string" },
                date_offset: { type: "integer" },
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
      description: "Catat hutang/piutang baru.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["hutang", "piutang"] },
          person_name: { type: "string" },
          amount: { type: "integer" },
          remaining: { type: "integer" },
          note: { type: "string" },
          due_date: { type: "string" },
          due_date_days: { type: "integer" },
          recurring_day: { type: "integer" },
          interest_rate: { type: "number" },
          interest_type: { type: "string", enum: ["none", "flat", "daily"] },
          tenor_months: { type: "integer" },
          installment_amount: { type: "integer" },
          installment_freq: { type: "string", enum: ["daily", "weekly", "monthly"] },
        },
        required: ["type", "person_name", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pay_debt",
      description: "Catat pembayaran hutang/piutang.",
      parameters: {
        type: "object",
        properties: {
          person_name: { type: "string" },
          amount: { type: "integer" },
        },
        required: ["person_name", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_summary",
      description: "Tampilkan rekap keuangan.",
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
      description: "Lihat daftar hutang/piutang aktif.",
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
      description: "Lihat riwayat pembayaran hutang.",
      parameters: {
        type: "object",
        properties: {
          person_name: { type: "string" },
        },
        required: ["person_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_transaction",
      description: "Edit atau hapus transaksi.",
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
      description: "Tanya balik jika pesan ambigu.",
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
      description: "Edit atau hapus hutang/piutang.",
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
      description: "Tampilkan target harian.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_obligation",
      description: "Catat kewajiban rutin (cicilan, kontrakan, dll).",
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
      description: "Set goal menabung untuk beli sesuatu.",
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
      description: "Set tabungan minimum harian.",
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
      description: "Hapus atau selesaikan kewajiban.",
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
      description: "Batalkan atau selesaikan goal.",
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
