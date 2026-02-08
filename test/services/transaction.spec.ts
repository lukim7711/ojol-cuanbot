import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──
const mockInsertTransaction = vi.fn().mockResolvedValue({ success: true });
const mockFindCategoryByName = vi.fn();

vi.mock("../../src/db/repository", () => ({
  insertTransaction: (...args: any[]) => mockInsertTransaction(...args),
  findCategoryByName: (...args: any[]) => mockFindCategoryByName(...args),
}));

vi.mock("../../src/utils/date", () => ({
  getDateFromOffset: vi.fn((offset: number) => {
    const d = new Date("2026-02-08");
    d.setDate(d.getDate() + offset);
    return d.toISOString().split("T")[0];
  }),
}));

import { recordTransactions } from "../../src/services/transaction";
import { User } from "../../src/types/transaction";

const mockUser: User = {
  id: 1,
  telegram_id: "123456789",
  display_name: "Test Driver",
  timezone: "Asia/Jakarta",
};

const mockDB = {} as D1Database;

describe("recordTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindCategoryByName.mockResolvedValue({ id: 1 });
  });

  // ── Happy path ──
  it("records a single income transaction", async () => {
    const result = await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "income", amount: 59000, category: "orderan", description: "pendapatan harian" },
        ],
      },
      "dapet 59rb"
    );

    expect(result.type).toBe("transactions_recorded");
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual({
      type: "income",
      amount: 59000,
      category: "orderan",
      description: "pendapatan harian",
    });
    expect(mockInsertTransaction).toHaveBeenCalledOnce();
  });

  it("records a single expense transaction", async () => {
    const result = await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "expense", amount: 25000, category: "makan", description: "makan di bu tami" },
        ],
      },
      "makan 25rb"
    );

    expect(result.type).toBe("transactions_recorded");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].type).toBe("expense");
    expect(result.data[0].amount).toBe(25000);
    expect(mockInsertTransaction).toHaveBeenCalledOnce();
  });

  it("records multiple transactions in one call", async () => {
    const result = await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "income", amount: 120000, category: "orderan", description: "orderan pagi" },
          { type: "expense", amount: 25000, category: "makan", description: "makan siang" },
          { type: "expense", amount: 30000, category: "bensin", description: "bensin" },
        ],
      },
      "dapet 120rb, makan 25rb, bensin 30rb"
    );

    expect(result.type).toBe("transactions_recorded");
    expect(result.data).toHaveLength(3);
    expect(mockInsertTransaction).toHaveBeenCalledTimes(3);
  });

  // ── Date offset ──
  it("passes correct date for offset 0 (today)", async () => {
    await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "income", amount: 50000, category: "orderan", description: "test", date_offset: 0 },
        ],
      },
      "test"
    );

    // 8th arg to insertTransaction is trxDate
    expect(mockInsertTransaction.mock.calls[0][7]).toBe("2026-02-08");
  });

  it("passes correct date for offset -1 (yesterday)", async () => {
    await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "income", amount: 50000, category: "orderan", description: "test", date_offset: -1 },
        ],
      },
      "test"
    );

    expect(mockInsertTransaction.mock.calls[0][7]).toBe("2026-02-07");
  });

  it("defaults date_offset to 0 when undefined", async () => {
    await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "income", amount: 50000, category: "orderan", description: "test" },
        ],
      },
      "test"
    );

    expect(mockInsertTransaction.mock.calls[0][7]).toBe("2026-02-08");
  });

  // ── Category lookup ──
  it("passes category ID from findCategoryByName", async () => {
    mockFindCategoryByName.mockResolvedValue({ id: 5 });

    await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "expense", amount: 30000, category: "bensin", description: "isi bensin" },
        ],
      },
      "bensin 30rb"
    );

    // 4th arg to insertTransaction is categoryId
    expect(mockInsertTransaction.mock.calls[0][3]).toBe(5);
    expect(mockFindCategoryByName).toHaveBeenCalledWith(mockDB, "expense", "bensin");
  });

  it("passes null categoryId when category not found", async () => {
    mockFindCategoryByName.mockResolvedValue(null);

    await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "expense", amount: 10000, category: "random", description: "beli random" },
        ],
      },
      "beli random 10rb"
    );

    expect(mockInsertTransaction.mock.calls[0][3]).toBeNull();
  });

  // ── Invalid amount (skip) ──
  it("skips transaction with zero amount", async () => {
    const result = await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "income", amount: 0, category: "orderan", description: "gagal" },
        ],
      },
      "test"
    );

    expect(result.type).toBe("transactions_recorded");
    expect(result.data).toHaveLength(0);
    expect(result.message).toContain("1 transaksi gagal");
    expect(mockInsertTransaction).not.toHaveBeenCalled();
  });

  it("skips transaction with negative amount", async () => {
    const result = await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "expense", amount: -5000, category: "makan", description: "negatif" },
        ],
      },
      "test"
    );

    expect(result.data).toHaveLength(0);
    expect(result.message).toContain("1 transaksi gagal");
    expect(mockInsertTransaction).not.toHaveBeenCalled();
  });

  it("skips transaction exceeding 100 million", async () => {
    const result = await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "income", amount: 100000001, category: "orderan", description: "too much" },
        ],
      },
      "test"
    );

    expect(result.data).toHaveLength(0);
    expect(result.message).toContain("1 transaksi gagal");
  });

  // ── Mix valid + invalid ──
  it("records valid and skips invalid in mixed batch", async () => {
    const result = await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "income", amount: 59000, category: "orderan", description: "orderan" },
          { type: "expense", amount: 0, category: "makan", description: "gagal" },
          { type: "expense", amount: 25000, category: "bensin", description: "bensin" },
        ],
      },
      "dapet 59rb, makan 0, bensin 25rb"
    );

    expect(result.data).toHaveLength(2);
    expect(result.message).toContain("1 transaksi gagal");
    expect(result.message).toContain("gagal");
    expect(mockInsertTransaction).toHaveBeenCalledTimes(2);
  });

  // ── Empty transactions array ──
  it("handles empty transactions array", async () => {
    const result = await recordTransactions(
      mockDB,
      mockUser,
      { transactions: [] },
      "test"
    );

    expect(result.type).toBe("transactions_recorded");
    expect(result.data).toHaveLength(0);
    expect(result.message).toBeUndefined();
    expect(mockInsertTransaction).not.toHaveBeenCalled();
  });

  // ── sourceText is passed through ──
  it("passes sourceText to insertTransaction", async () => {
    await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "income", amount: 50000, category: "orderan", description: "test" },
        ],
      },
      "original user message"
    );

    // 6th arg to insertTransaction is sourceText
    expect(mockInsertTransaction.mock.calls[0][5]).toBe("original user message");
  });

  // ── Description sanitization ──
  it("sanitizes description before insert", async () => {
    await recordTransactions(
      mockDB,
      mockUser,
      {
        transactions: [
          { type: "expense", amount: 10000, category: "makan", description: "<script>alert('xss')</script>" },
        ],
      },
      "test"
    );

    // 5th arg to insertTransaction is sanitized description
    const insertedDesc = mockInsertTransaction.mock.calls[0][4];
    expect(insertedDesc).not.toContain("<script>");
  });
});
