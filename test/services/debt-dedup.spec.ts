import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock repository
const mockFindActiveDebtByPerson = vi.fn();
const mockInsertDebt = vi.fn().mockResolvedValue({ success: true });

vi.mock("../../src/db/repository", () => ({
  findActiveDebtByPerson: (...args: any[]) => mockFindActiveDebtByPerson(...args),
  insertDebt: (...args: any[]) => mockInsertDebt(...args),
  findCategoryByName: vi.fn(),
  updateDebtRemaining: vi.fn(),
  updateDebtNextPayment: vi.fn(),
  insertDebtPayment: vi.fn(),
  getActiveDebts: vi.fn().mockResolvedValue({ results: [] }),
  getDebtPayments: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock("../../src/utils/date", () => ({
  getDateFromOffset: vi.fn().mockReturnValue("2026-02-08"),
}));

import { recordDebt } from "../../src/services/debt";

const mockUser = { id: 1, telegram_id: "123", display_name: "Test" };

describe("recordDebt dedup guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock Date.now for consistent timestamp
    vi.spyOn(Date, "now").mockReturnValue(1770536400000); // some fixed timestamp
  });

  it("allows first debt to a person", async () => {
    mockFindActiveDebtByPerson.mockResolvedValue(null);

    const result = await recordDebt(
      {} as any,
      mockUser,
      { type: "hutang", person_name: "Siti", amount: 1000000 },
      "hutang ke Siti 1jt"
    );

    expect(result.type).toBe("debt_recorded");
    expect(mockInsertDebt).toHaveBeenCalledOnce();
  });

  it("blocks duplicate debt (same person, same amount, <60s)", async () => {
    const nowUnix = Math.floor(1770536400000 / 1000);
    mockFindActiveDebtByPerson.mockResolvedValue({
      id: 5,
      amount: 1000000,
      remaining: 1000000,
      created_at: nowUnix - 10, // 10 seconds ago
      due_date: null,
      interest_rate: 0,
      interest_type: "none",
      tenor_months: null,
      installment_amount: null,
      installment_freq: "monthly",
      next_payment_date: null,
      total_with_interest: 1000000,
    });

    const result = await recordDebt(
      {} as any,
      mockUser,
      { type: "hutang", person_name: "Siti", amount: 1000000 },
      "hutang ke Siti 1jt"
    );

    expect(result.type).toBe("debt_recorded");
    // Should NOT have called insertDebt (dedup blocked it)
    expect(mockInsertDebt).not.toHaveBeenCalled();
  });

  it("allows debt with different amount to same person", async () => {
    const nowUnix = Math.floor(1770536400000 / 1000);
    mockFindActiveDebtByPerson.mockResolvedValue({
      id: 5,
      amount: 500000, // different amount
      remaining: 500000,
      created_at: nowUnix - 10,
      due_date: null,
      interest_rate: 0,
      interest_type: "none",
      tenor_months: null,
      installment_amount: null,
      installment_freq: "monthly",
      next_payment_date: null,
      total_with_interest: 500000,
    });

    const result = await recordDebt(
      {} as any,
      mockUser,
      { type: "hutang", person_name: "Siti", amount: 1000000 },
      "hutang ke Siti 1jt"
    );

    expect(result.type).toBe("debt_recorded");
    expect(mockInsertDebt).toHaveBeenCalledOnce();
  });

  it("allows debt to same person after 60s window", async () => {
    const nowUnix = Math.floor(1770536400000 / 1000);
    mockFindActiveDebtByPerson.mockResolvedValue({
      id: 5,
      amount: 1000000,
      remaining: 1000000,
      created_at: nowUnix - 120, // 2 minutes ago
      due_date: null,
      interest_rate: 0,
      interest_type: "none",
      tenor_months: null,
      installment_amount: null,
      installment_freq: "monthly",
      next_payment_date: null,
      total_with_interest: 1000000,
    });

    const result = await recordDebt(
      {} as any,
      mockUser,
      { type: "hutang", person_name: "Siti", amount: 1000000 },
      "hutang ke Siti 1jt"
    );

    expect(result.type).toBe("debt_recorded");
    expect(mockInsertDebt).toHaveBeenCalledOnce();
  });
});
