/**
 * Tool Definitions — With Groups (Fase F)
 *
 * Fase E: compressed schemas (15 tools)
 * Fase F: added grouped exports for dynamic tool selection.
 *        Each group includes ask_clarification as fallback.
 *
 * Groups:
 *  TRANSACTION_TOOLS — record_transactions, record_debt, pay_debt
 *  DEBT_TOOLS        — record_debt, pay_debt, get_debts, get_debt_history, edit_debt
 *  QUERY_TOOLS       — get_summary, get_debts, get_debt_history, get_daily_target
 *  EDIT_TOOLS        — edit_transaction, edit_debt, edit_obligation, edit_goal
 *  SETTING_TOOLS     — set_obligation, set_goal, set_saving
 */

const record_transactions = {
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
};

const record_debt = {
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
};

const pay_debt = {
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
};

const get_summary = {
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
};

const get_debts = {
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
};

const get_debt_history = {
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
};

const edit_transaction = {
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
};

const ask_clarification = {
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
};

const edit_debt = {
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
};

const get_daily_target = {
  type: "function" as const,
  function: {
    name: "get_daily_target",
    description: "Target harian.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const set_obligation = {
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
};

const set_goal = {
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
};

const set_saving = {
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
};

const edit_obligation = {
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
};

const edit_goal = {
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
};

// ============================================
// ALL TOOLS — full list (fallback)
// ============================================
export const TOOLS = [
  record_transactions,
  record_debt,
  pay_debt,
  get_summary,
  get_debts,
  get_debt_history,
  edit_transaction,
  ask_clarification,
  edit_debt,
  get_daily_target,
  set_obligation,
  set_goal,
  set_saving,
  edit_obligation,
  edit_goal,
] as const;

// ============================================
// TOOL GROUPS — for dynamic selection (Fase F)
// Each group includes ask_clarification as safe fallback
// ============================================

/** Transaksi: income/expense recording + debt recording + payment */
export const TRANSACTION_TOOLS = [
  record_transactions,
  record_debt,
  pay_debt,
  ask_clarification,
] as const;

/** Hutang/Piutang: debt CRUD + payment + query */
export const DEBT_TOOLS = [
  record_debt,
  pay_debt,
  get_debts,
  get_debt_history,
  edit_debt,
  ask_clarification,
] as const;

/** Query: read-only data retrieval */
export const QUERY_TOOLS = [
  get_summary,
  get_debts,
  get_debt_history,
  get_daily_target,
  ask_clarification,
] as const;

/** Edit/Hapus: modify or delete existing records */
export const EDIT_TOOLS = [
  edit_transaction,
  edit_debt,
  edit_obligation,
  edit_goal,
  ask_clarification,
] as const;

/** Setting: create goals, obligations, savings */
export const SETTING_TOOLS = [
  set_obligation,
  set_goal,
  set_saving,
  ask_clarification,
] as const;
