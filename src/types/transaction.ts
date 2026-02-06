// ── User ──
export interface User {
  id: number;
  telegram_id: string;
  display_name: string;
  timezone: string;
}

// ── Transaction dari AI ──
export interface ParsedTransaction {
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string;
  date_offset?: number; // 0 = hari ini, -1 = kemarin
}

// ── Debt dari AI ──
export interface ParsedDebt {
  type: "hutang" | "piutang";
  person_name: string;
  amount: number;
  note?: string;
}

// ── Debt Payment dari AI ──
export interface ParsedDebtPayment {
  person_name: string;
  amount: number;
}

// ── Summary Request dari AI ──
export interface ParsedSummaryRequest {
  period: "today" | "yesterday" | "this_week" | "this_month" | "custom";
  custom_start?: string;
  custom_end?: string;
}

// ── Tool Call Result (internal) ──
export interface ToolCallResult {
  type: "transactions_recorded" | "debt_recorded" | "debt_paid"
       | "summary" | "debts_list" | "edited" | "clarification" | "chat";
  data: any;
  message?: string;
}
