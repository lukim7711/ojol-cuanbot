import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──
const mockFindActiveDebtByPerson = vi.fn();
const mockSettleDebt = vi.fn().mockResolvedValue({ success: true });
const mockUpdateDebtAmountAndRemaining = vi.fn().mockResolvedValue({ success: true });

vi.mock("../../src/db/repository", () => ({
  findActiveDebtByPerson: (...args: any[]) => mockFindActiveDebtByPerson(...args),
  settleDebt: (...args: any[]) => mockSettleDebt(...args),
  updateDebtAmountAndRemaining: (...args: any[]) => mockUpdateDebtAmountAndRemaining(...args),
}));

vi.mock("../../src/utils/validator", () => ({
  validateAmount: vi.fn((val: any) => {
    const n = Number(val);
    if (!Number.isInteger(n) || n <= 0 || n > 100_000_000) return null;
    return n;
  }),
}));

vi.mock("../../src/utils/formatter", () => ({
  formatRupiah: vi.fn((n: number) => `Rp${n.toLocaleString("id-ID")}`),
}));

import { editDebt } from "../../src/services/edit-debt";
import { User } from "../../src/types/transaction";

const mockUser: User = {
  id: 1,
  telegram_id: "123456789",
  display_name: "Test Driver",
  timezone: "Asia/Jakarta",
};

const mockDB = {} as D1Database;

const sampleDebt = {
  id: 10,
  type: "hutang",
  person_name: "Budi",
  amount: 200000,
  remaining: 200000,
  due_date: null,
  interest_rate: 0,
  interest_type: "none",
  tenor_months: null,
  installment_amount: null,
  installment_freq: "monthly",
  next_payment_date: null,
  total_with_interest: null,
};

describe("editDebt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── DELETE ──
  it("soft-deletes an active debt", async () => {
    mockFindActiveDebtByPerson.mockResolvedValue(sampleDebt);

    const result = await editDebt(mockDB, mockUser, {
      action: "delete",
      person_name: "Budi",
    });

    expect(result.type).toBe("edited");
    expect(result.message).toContain("dihapus");
    expect(result.message).toContain("Budi");
    expect(result.data.deleted_debt).toEqual(sampleDebt);
    expect(mockSettleDebt).toHaveBeenCalledWith(mockDB, 10);
  });

  // ── EDIT ──
  it("edits debt amount and adjusts remaining", async () => {
    mockFindActiveDebtByPerson.mockResolvedValue(sampleDebt);

    const result = await editDebt(mockDB, mockUser, {
      action: "edit",
      person_name: "Budi",
      new_amount: 300000,
    });

    expect(result.type).toBe("edited");
    expect(result.data.old_amount).toBe(200000);
    expect(result.data.new_amount).toBe(300000);
    // remaining = max(0, 200000 + (300000 - 200000)) = 300000
    expect(result.data.new_remaining).toBe(300000);
    expect(result.message).toContain("diubah");
    expect(mockUpdateDebtAmountAndRemaining).toHaveBeenCalledWith(mockDB, 10, 300000, 300000);
  });

  it("adjusts remaining correctly when decreasing amount", async () => {
    mockFindActiveDebtByPerson.mockResolvedValue(sampleDebt);

    const result = await editDebt(mockDB, mockUser, {
      action: "edit",
      person_name: "Budi",
      new_amount: 150000,
    });

    expect(result.data.new_remaining).toBe(150000);
    expect(mockUpdateDebtAmountAndRemaining).toHaveBeenCalledWith(mockDB, 10, 150000, 150000);
  });

  it("clamps remaining to 0 when decrease is larger than remaining", async () => {
    const partialPaid = { ...sampleDebt, remaining: 50000 };
    mockFindActiveDebtByPerson.mockResolvedValue(partialPaid);

    const result = await editDebt(mockDB, mockUser, {
      action: "edit",
      person_name: "Budi",
      new_amount: 10000,
    });

    expect(result.data.new_remaining).toBe(0);
    expect(mockUpdateDebtAmountAndRemaining).toHaveBeenCalledWith(mockDB, 10, 10000, 0);
  });

  // ── NOT FOUND ──
  it("returns clarification when debt not found", async () => {
    mockFindActiveDebtByPerson.mockResolvedValue(null);

    const result = await editDebt(mockDB, mockUser, {
      action: "delete",
      person_name: "Siapa",
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("Gak nemu");
    expect(result.message).toContain("Siapa");
  });

  // ── INVALID AMOUNT ──
  it("returns clarification when new_amount is invalid", async () => {
    mockFindActiveDebtByPerson.mockResolvedValue(sampleDebt);

    const result = await editDebt(mockDB, mockUser, {
      action: "edit",
      person_name: "Budi",
      new_amount: -100,
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("gak valid");
  });

  // ── EDIT WITHOUT AMOUNT ──
  it("returns clarification when edit without new_amount", async () => {
    mockFindActiveDebtByPerson.mockResolvedValue(sampleDebt);

    const result = await editDebt(mockDB, mockUser, {
      action: "edit",
      person_name: "Budi",
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("Mau diapain");
  });

  // ── UNKNOWN ACTION ──
  it("returns clarification for unknown action", async () => {
    mockFindActiveDebtByPerson.mockResolvedValue(sampleDebt);

    const result = await editDebt(mockDB, mockUser, {
      action: "unknown" as any,
      person_name: "Budi",
    });

    expect(result.type).toBe("clarification");
  });
});
