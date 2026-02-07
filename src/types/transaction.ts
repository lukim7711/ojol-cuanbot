export interface User {
  id: number;
  telegram_id: string;
  display_name: string;
  timezone: string;
}

export interface ParsedTransaction {
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string;
  date_offset?: number;
}

export interface ParsedDebt {
  type: "hutang" | "piutang";
  person_name: string;
  amount: number;
  note?: string;
}

export interface ParsedDebtPayment {
  person_name: string;
  amount: number;
}

export interface ParsedSummaryRequest {
  period: "today" | "yesterday" | "this_week" | "this_month" | "custom";
  custom_start?: string;
  custom_end?: string;
}

export interface ToolCallResult {
  type: "transactions_recorded" | "debt_recorded" | "debt_paid"
       | "summary" | "debts_list" | "edited" | "clarification" | "chat"
       | "daily_target" | "obligation_set" | "goal_set" | "saving_set"
       | "debt_history";
  data: any;
  message?: string;
}
