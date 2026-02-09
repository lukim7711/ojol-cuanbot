/**
 * Tool Definitions — Compressed (Fase E)
 *
 * Changes from Fase D:
 * - record_debt: trimmed 12 → 5 properties (removed rarely-used fields)
 * - get_summary: removed custom period (custom_start, custom_end)
 * - set_obligation: removed note field
 * - All descriptions shortened
 */
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
          due_date_days: { type: "integer" },
          note: { type: "string" },
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
      description: "Rekap keuangan.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "this_week", "this_month"] },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_debts",
      description: "Daftar hutang/piutang aktif.",
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
      description: "Riwayat pembayaran hutang.",
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
      description: "Tanya balik jika ambigu.",
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
      description: "Edit/hapus hutang-piutang.",
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
      description: "Target harian.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_obligation",
      description: "Catat kewajiban rutin.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "integer" },
          frequency: { type: "string", enum: ["daily", "weekly", "monthly"] },
        },
        required: ["name", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_goal",
      description: "Goal menabung.",
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
      description: "Tabungan minimum harian.",
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
      description: "Hapus/selesaikan kewajiban.",
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
      description: "Batalkan/selesaikan goal.",
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
