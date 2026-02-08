import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──
const mockFindTransactionByDescription = vi.fn();
const mockFindTransactionByCategory = vi.fn();
const mockFindTransactionBySourceText = vi.fn();
const mockFindLastTransaction = vi.fn();
const mockDeleteTransaction = vi.fn().mockResolvedValue({ success: true });
const mockUpdateTransactionAmount = vi.fn().mockResolvedValue({ success: true });

vi.mock("../../src/db/repository", () => ({
  findTransactionByDescription: (...args: any[]) => mockFindTransactionByDescription(...args),
  findTransactionByCategory: (...args: any[]) => mockFindTransactionByCategory(...args),
  findTransactionBySourceText: (...args: any[]) => mockFindTransactionBySourceText(...args),
  findLastTransaction: (...args: any[]) => mockFindLastTransaction(...args),
  updateTransactionAmount: (...args: any[]) => mockUpdateTransactionAmount(...args),
  deleteTransaction: (...args: any[]) => mockDeleteTransaction(...args),
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

import { editOrDeleteTransaction } from "../../src/services/edit";
import { User } from "../../src/types/transaction";

const mockUser: User = {
  id: 1,
  telegram_id: "123456789",
  display_name: "Test Driver",
  timezone: "Asia/Jakarta",
};

const mockDB = {} as D1Database;

describe("editOrDeleteTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all layers return null (not found)
    mockFindTransactionByDescription.mockResolvedValue(null);
    mockFindTransactionByCategory.mockResolvedValue(null);
    mockFindTransactionBySourceText.mockResolvedValue(null);
    mockFindLastTransaction.mockResolvedValue(null);
  });

  const sampleTrx = {
    id: 42,
    type: "expense",
    amount: 25000,
    description: "makan di bu tami",
    category_name: "makan",
    trx_date: "2026-02-08",
  };

  // ── DELETE ──
  it("deletes a found transaction", async () => {
    mockFindTransactionByDescription.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "delete",
      target: "makan bu tami",
    });

    expect(result.type).toBe("edited");
    expect(result.message).toContain("Dihapus");
    expect(result.message).toContain("Pengeluaran");
    expect(result.data.deleted).toEqual(sampleTrx);
    expect(mockDeleteTransaction).toHaveBeenCalledWith(mockDB, 42);
  });

  it("labels income correctly on delete", async () => {
    const incomeTrx = { ...sampleTrx, type: "income", description: "orderan" };
    mockFindTransactionByDescription.mockResolvedValue(incomeTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "delete",
      target: "orderan",
    });

    expect(result.message).toContain("Pemasukan");
  });

  // ── EDIT ──
  it("edits amount of a found transaction", async () => {
    mockFindTransactionByDescription.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "edit",
      target: "makan bu tami",
      new_amount: 20000,
    });

    expect(result.type).toBe("edited");
    expect(result.message).toContain("Diubah");
    expect(result.data.old.amount).toBe(25000);
    expect(result.data.new.amount).toBe(20000);
    expect(mockUpdateTransactionAmount).toHaveBeenCalledWith(mockDB, 42, 20000);
  });

  it("asks for clarification when edit has no new_amount", async () => {
    mockFindTransactionByDescription.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "edit",
      target: "makan bu tami",
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("Mau diubah jadi berapa");
  });

  it("asks for clarification when new_amount is invalid", async () => {
    mockFindTransactionByDescription.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "edit",
      target: "makan bu tami",
      new_amount: -5000,
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("gak valid");
  });

  // ── NOT FOUND ──
  it("returns clarification when transaction not found", async () => {
    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "delete",
      target: "sesuatu yang gak ada",
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("gak nemu");
  });

  // ── UNKNOWN ACTION ──
  it("returns clarification for unknown action", async () => {
    mockFindTransactionByDescription.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "unknown" as any,
      target: "makan bu tami",
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("Mau diapain");
  });

  // ── EDGE: delete without description ──
  it("handles delete of transaction without description", async () => {
    const noDescTrx = { ...sampleTrx, description: "" };
    mockFindTransactionByDescription.mockResolvedValue(noDescTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "delete",
      target: "makan",
    });

    expect(result.type).toBe("edited");
    expect(result.message).toContain("Dihapus");
    expect(result.message).not.toContain(" — \n");
  });

  it("includes description in edit message", async () => {
    mockFindTransactionByDescription.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "edit",
      target: "makan bu tami",
      new_amount: 30000,
    });

    expect(result.message).toContain("makan di bu tami");
  });

  it("accepts edit with maximum valid amount", async () => {
    mockFindTransactionByDescription.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "edit",
      target: "makan bu tami",
      new_amount: 100_000_000,
    });

    expect(result.type).toBe("edited");
    expect(result.data.new.amount).toBe(100_000_000);
  });

  // ── RESOLVE TARGET: Layer 2 — category match ──
  it("finds transaction via category when description not matched", async () => {
    mockFindTransactionByCategory.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "delete",
      target: "makan",
    });

    expect(result.type).toBe("edited");
    expect(mockFindTransactionByDescription).toHaveBeenCalled();
    expect(mockFindTransactionByCategory).toHaveBeenCalledWith(mockDB, 1, "makan");
    expect(mockDeleteTransaction).toHaveBeenCalledWith(mockDB, 42);
  });

  // ── RESOLVE TARGET: Layer 3 — source_text match ──
  it("finds transaction via source_text when desc and category not matched", async () => {
    mockFindTransactionBySourceText.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "delete",
      target: "dapet 59rb makan 25rb",
    });

    expect(result.type).toBe("edited");
    expect(mockFindTransactionByDescription).toHaveBeenCalled();
    expect(mockFindTransactionByCategory).toHaveBeenCalled();
    expect(mockFindTransactionBySourceText).toHaveBeenCalled();
    expect(mockDeleteTransaction).toHaveBeenCalledWith(mockDB, 42);
  });

  // ── RESOLVE TARGET: Layer 4 — "terakhir" fallback ──
  it("finds last transaction when target says 'yang terakhir'", async () => {
    mockFindLastTransaction.mockResolvedValue(sampleTrx);

    const result = await editOrDeleteTransaction(mockDB, mockUser, {
      action: "delete",
      target: "yang terakhir",
    });

    expect(result.type).toBe("edited");
    expect(mockFindLastTransaction).toHaveBeenCalledWith(mockDB, 1);
    expect(mockDeleteTransaction).toHaveBeenCalledWith(mockDB, 42);
  });
});
