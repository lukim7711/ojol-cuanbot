import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──
const mockDeleteTransaction = vi.fn().mockResolvedValue({ success: true });
const mockUpdateTransactionAmount = vi.fn().mockResolvedValue({ success: true });

vi.mock("../../src/db/repository", () => ({
  findRecentTransactionByDescription: vi.fn(),
  updateTransactionAmount: (...args: any[]) => mockUpdateTransactionAmount(...args),
  deleteTransaction: (...args: any[]) => mockDeleteTransaction(...args),
  findRecentTransactionByAmount: vi.fn(),
  getLastTransaction: vi.fn(),
  findActiveDebtByPerson: vi.fn(),
  updateDebtAmount: vi.fn(),
  reinsertTransaction: vi.fn(),
}));

vi.mock("../../src/utils/validator", () => ({
  validateAmount: vi.fn((val: any) => {
    const n = Number(val);
    if (!Number.isInteger(n) || n <= 0 || n > 100_000_000) return null;
    return n;
  }),
  sanitizeString: vi.fn((s: string) => s),
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

// Helper: create a mock DB that simulates resolveTarget finding a transaction
function createMockDB(foundTransaction: any | null) {
  const mockFirst = vi.fn();
  // resolveTarget calls db.prepare().bind().first() up to 4 times (4 layers)
  // Return foundTransaction on first call, null on rest (or null for all if not found)
  if (foundTransaction) {
    mockFirst.mockResolvedValueOnce(foundTransaction);
  } else {
    mockFirst
      .mockResolvedValueOnce(null)  // Layer 1: by description
      .mockResolvedValueOnce(null)  // Layer 2: by category
      .mockResolvedValueOnce(null)  // Layer 3: by source_text
      // Layer 4: only if target matches "terakhir/barusan/tadi"
      .mockResolvedValueOnce(null);
  }

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: mockFirst,
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
    }),
  } as unknown as D1Database;
}

describe("editOrDeleteTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const db = createMockDB(sampleTrx);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "delete",
      target: "makan",
    });

    expect(result.type).toBe("edited");
    expect(result.message).toContain("Dihapus");
    expect(result.message).toContain("Pengeluaran");
    expect(result.data.deleted).toEqual(sampleTrx);
    expect(mockDeleteTransaction).toHaveBeenCalledWith(db, 42);
  });

  it("labels income correctly on delete", async () => {
    const incomeTrx = { ...sampleTrx, type: "income", description: "orderan" };
    const db = createMockDB(incomeTrx);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "delete",
      target: "orderan",
    });

    expect(result.message).toContain("Pemasukan");
  });

  // ── EDIT ──
  it("edits amount of a found transaction", async () => {
    const db = createMockDB(sampleTrx);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "edit",
      target: "makan",
      new_amount: 20000,
    });

    expect(result.type).toBe("edited");
    expect(result.message).toContain("Diubah");
    expect(result.data.old.amount).toBe(25000);
    expect(result.data.new.amount).toBe(20000);
    expect(mockUpdateTransactionAmount).toHaveBeenCalledWith(db, 42, 20000);
  });

  it("asks for clarification when edit has no new_amount", async () => {
    const db = createMockDB(sampleTrx);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "edit",
      target: "makan",
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("Mau diubah jadi berapa");
  });

  it("asks for clarification when new_amount is invalid", async () => {
    const db = createMockDB(sampleTrx);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "edit",
      target: "makan",
      new_amount: -5000,
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("gak valid");
  });

  // ── NOT FOUND ──
  it("returns clarification when transaction not found", async () => {
    const db = createMockDB(null);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "delete",
      target: "sesuatu yang gak ada",
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("gak nemu");
  });

  // ── UNKNOWN ACTION ──
  it("returns clarification for unknown action", async () => {
    const db = createMockDB(sampleTrx);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "unknown" as any,
      target: "makan",
    });

    expect(result.type).toBe("clarification");
    expect(result.message).toContain("Mau diapain");
  });

  // ── EDGE: delete transaction without description ──
  it("handles delete of transaction without description", async () => {
    const noDescTrx = { ...sampleTrx, description: "" };
    const db = createMockDB(noDescTrx);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "delete",
      target: "makan",
    });

    expect(result.type).toBe("edited");
    expect(result.message).toContain("Dihapus");
    // Should not have trailing " — "
    expect(result.message).not.toContain(" — \n");
  });

  // ── EDIT preserves description in message ──
  it("includes description in edit message", async () => {
    const db = createMockDB(sampleTrx);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "edit",
      target: "makan",
      new_amount: 30000,
    });

    expect(result.message).toContain("makan di bu tami");
  });

  // ── EDIT with boundary amount (100 million) ──
  it("accepts edit with maximum valid amount", async () => {
    const db = createMockDB(sampleTrx);
    const result = await editOrDeleteTransaction(db, mockUser, {
      action: "edit",
      target: "makan",
      new_amount: 100_000_000,
    });

    expect(result.type).toBe("edited");
    expect(result.data.new.amount).toBe(100_000_000);
  });
});
