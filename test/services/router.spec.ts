import { describe, it, expect, vi } from "vitest";

// ── Mock all service dependencies ──
vi.mock("../../src/services/transaction", () => ({
  recordTransactions: vi.fn().mockResolvedValue({
    type: "transactions_recorded",
    data: [{ type: "income", amount: 59000, description: "orderan" }],
  }),
}));

vi.mock("../../src/services/debt", () => ({
  recordDebt: vi.fn().mockResolvedValue({
    type: "debt_recorded",
    data: { type: "hutang", person_name: "Budi", amount: 200000 },
  }),
  payDebt: vi.fn().mockResolvedValue({
    type: "debt_paid",
    data: { person_name: "Budi", paid: 100000, remaining: 100000 },
  }),
  getDebtsList: vi.fn().mockResolvedValue({
    type: "debts_list",
    data: { debts: [] },
  }),
}));

vi.mock("../../src/services/summary", () => ({
  getSummary: vi.fn().mockResolvedValue({
    type: "summary",
    data: {
      periodLabel: "Hari Ini",
      totalIncome: 120000,
      totalExpense: 45000,
      details: [],
    },
  }),
}));

vi.mock("../../src/services/edit", () => ({
  editOrDeleteTransaction: vi.fn().mockResolvedValue({
    type: "edited",
    data: null,
    message: "Transaksi berhasil diubah",
  }),
}));

vi.mock("../../src/services/edit-debt", () => ({
  editDebt: vi.fn().mockResolvedValue({
    type: "edited",
    data: null,
    message: "Hutang berhasil diubah",
  }),
}));

import { processToolCalls } from "../../src/services/router";
import { User } from "../../src/types/transaction";

const mockUser: User = {
  id: 1,
  telegram_id: "123456789",
  display_name: "Test Driver",
  timezone: "Asia/Jakarta",
};

const mockDB = {} as D1Database;

describe("processToolCalls", () => {
  // ── Individual tool routing ──
  it("routes record_transactions correctly", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [
        {
          name: "record_transactions",
          arguments: {
            transactions: [
              { type: "income", amount: 59000, category: "orderan", description: "pendapatan" },
            ],
          },
        },
      ],
      "hari ini dapet 59rb"
    );
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("transactions_recorded");
  });

  it("routes record_debt correctly", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Budi", amount: 200000 },
        },
      ],
      "minjem ke Budi 200rb"
    );
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("debt_recorded");
  });

  it("routes pay_debt correctly", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [
        {
          name: "pay_debt",
          arguments: { person_name: "Budi", amount: 100000 },
        },
      ],
      "bayar hutang ke Budi 100rb"
    );
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("debt_paid");
  });

  it("routes get_summary correctly", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [{ name: "get_summary", arguments: { period: "today" } }],
      "rekap hari ini"
    );
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("summary");
  });

  it("routes get_debts correctly", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [{ name: "get_debts", arguments: { type: "all" } }],
      "hutang gue berapa"
    );
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("debts_list");
  });

  it("routes edit_transaction correctly", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [
        {
          name: "edit_transaction",
          arguments: { action: "edit", target: "makan", new_amount: 20000 },
        },
      ],
      "yang makan tadi harusnya 20rb"
    );
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("edited");
  });

  it("routes edit_debt correctly", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [
        {
          name: "edit_debt",
          arguments: { action: "edit", person_name: "Budi", new_amount: 150000 },
        },
      ],
      "hutang ke Budi harusnya 150rb"
    );
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("edited");
  });

  // ── ask_clarification (handled inline, not via service) ──
  it("routes ask_clarification correctly", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [
        {
          name: "ask_clarification",
          arguments: { message: "Maksudnya pengeluaran atau pemasukan?" },
        },
      ],
      "ambigu input"
    );
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("clarification");
    expect(results[0].data).toBeNull();
    expect(results[0].message).toBe("Maksudnya pengeluaran atau pemasukan?");
  });

  // ── Edge cases ──
  it("handles multiple tool calls in one message", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [
        {
          name: "record_transactions",
          arguments: { transactions: [] },
        },
        {
          name: "pay_debt",
          arguments: { person_name: "Andi", amount: 50000 },
        },
      ],
      "dapet 59rb, bayar hutang Andi 50rb"
    );
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe("transactions_recorded");
    expect(results[1].type).toBe("debt_paid");
  });

  it("ignores unknown tool names silently", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [{ name: "nonexistent_tool", arguments: {} }],
      "test"
    );
    expect(results).toHaveLength(0);
  });

  it("returns empty array for empty tool calls", async () => {
    const results = await processToolCalls(
      mockDB,
      mockUser,
      [],
      "test"
    );
    expect(results).toHaveLength(0);
  });
});
