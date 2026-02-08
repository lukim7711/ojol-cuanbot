import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindActiveDebtByPerson = vi.fn();
const mockFindDebtByPersonAllStatus = vi.fn();
const mockGetDebtPayments = vi.fn();

vi.mock("../../src/db/repository", () => ({
  findActiveDebtByPerson: (...args: any[]) => mockFindActiveDebtByPerson(...args),
  findDebtByPersonAllStatus: (...args: any[]) => mockFindDebtByPersonAllStatus(...args),
  getDebtPayments: (...args: any[]) => mockGetDebtPayments(...args),
  insertDebt: vi.fn(),
  updateDebtRemaining: vi.fn(),
  updateDebtNextPayment: vi.fn(),
  insertDebtPayment: vi.fn(),
  getActiveDebts: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock("../../src/utils/validator", () => ({
  validateAmount: (n: number) => (n > 0 ? n : null),
  sanitizeString: (s: string) => s,
}));

vi.mock("../../src/utils/date", () => ({
  getDateFromOffset: vi.fn().mockReturnValue("2026-02-08"),
}));

vi.mock("../../src/utils/formatter", () => ({
  formatRupiah: (n: number) => `Rp${n.toLocaleString()}`,
}));

import { getDebtHistory } from "../../src/services/debt";

const mockDb = {} as D1Database;
const mockUser = { id: 1, telegram_id: "123", display_name: "Test" };

describe("getDebtHistory — settled debt fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns history for active debt", async () => {
    mockFindActiveDebtByPerson.mockResolvedValueOnce({
      id: 1, person_name: "Budi", type: "hutang", amount: 500000, remaining: 200000,
      due_date: null, next_payment_date: null, installment_amount: null,
    });
    mockGetDebtPayments.mockResolvedValueOnce({
      results: [{ amount: 200000, paid_at: 1000 }, { amount: 100000, paid_at: 2000 }],
    });

    const result = await getDebtHistory(mockDb, mockUser, { person_name: "Budi" });
    expect(result.type).toBe("debt_history");
    expect(result.data.total_paid).toBe(300000);
    expect(result.data.remaining).toBe(200000);
  });

  it("falls back to settled debt when no active debt found", async () => {
    mockFindActiveDebtByPerson.mockResolvedValueOnce(null); // No active
    mockFindDebtByPersonAllStatus.mockResolvedValueOnce({
      id: 1, person_name: "Budi", type: "hutang", amount: 500000, remaining: 0,
      status: "settled", due_date: null, next_payment_date: null, installment_amount: null,
    });
    mockGetDebtPayments.mockResolvedValueOnce({
      results: [{ amount: 200000, paid_at: 1000 }, { amount: 300000, paid_at: 2000 }],
    });

    const result = await getDebtHistory(mockDb, mockUser, { person_name: "Budi" });
    expect(result.type).toBe("debt_history");
    expect(result.data.total_paid).toBe(500000);
    expect(result.data.remaining).toBe(0);
    expect(result.data.status).toBe("settled");
  });

  it("returns clarification when debt never existed", async () => {
    mockFindActiveDebtByPerson.mockResolvedValueOnce(null);
    mockFindDebtByPersonAllStatus.mockResolvedValueOnce(null);

    const result = await getDebtHistory(mockDb, mockUser, { person_name: "Nobody" });
    expect(result.type).toBe("clarification");
    expect(result.message).toContain("tidak ditemukan");
  });

  it("includes status field in response", async () => {
    mockFindActiveDebtByPerson.mockResolvedValueOnce({
      id: 1, person_name: "Siti", type: "hutang", amount: 1000000, remaining: 500000,
      status: "active", due_date: "2026-03-10", next_payment_date: "2026-03-10",
      installment_amount: null,
    });
    mockGetDebtPayments.mockResolvedValueOnce({ results: [] });

    const result = await getDebtHistory(mockDb, mockUser, { person_name: "Siti" });
    expect(result.data.status).toBe("active");
  });
});
