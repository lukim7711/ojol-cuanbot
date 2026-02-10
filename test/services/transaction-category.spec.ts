import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for Bug 5 fix: category fallback to "lainnya".
 *
 * When AI sends a category name not in the DB,
 * transaction.ts should fall back to "lainnya" instead of inserting null.
 */

const mockFindCategoryByName = vi.fn();
const mockInsertTransaction = vi.fn();

vi.mock("../../src/db/repository", () => ({
  findCategoryByName: (...args: any[]) => mockFindCategoryByName(...args),
  insertTransaction: (...args: any[]) => mockInsertTransaction(...args),
}));

vi.mock("../../src/utils/date", () => ({
  getDateFromOffset: () => "2026-02-10",
}));

vi.mock("../../src/utils/validator", () => ({
  validateAmount: (v: any) => (typeof v === "number" && v > 0 ? v : null),
  sanitizeString: (s: string) => s,
}));

import { recordTransactions } from "../../src/services/transaction";

const mockUser = { id: 1, telegram_id: "123", display_name: "Test" };

describe("recordTransactions — category fallback (Bug 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertTransaction.mockResolvedValue({ meta: { changes: 1 } });
  });

  it("uses correct category when found", async () => {
    mockFindCategoryByName.mockResolvedValue({ id: 5 }); // "makan" exists

    await recordTransactions(
      {} as any,
      mockUser,
      { transactions: [{ type: "expense", category: "makan", amount: 25000, description: "makan siang" }] },
      "makan 25rb"
    );

    // Should call findCategoryByName once (found on first try)
    expect(mockFindCategoryByName).toHaveBeenCalledTimes(1);
    expect(mockInsertTransaction).toHaveBeenCalledWith(
      {}, 1, "expense", 5, 25000, "makan siang", "makan 25rb", "2026-02-10"
    );
  });

  it("falls back to 'lainnya' when category not found", async () => {
    // First call: "jajan" not found
    mockFindCategoryByName.mockResolvedValueOnce(null);
    // Second call: fallback "lainnya" found
    mockFindCategoryByName.mockResolvedValueOnce({ id: 11 });

    await recordTransactions(
      {} as any,
      mockUser,
      { transactions: [{ type: "expense", category: "jajan", amount: 10000, description: "jajan" }] },
      "jajan 10rb"
    );

    // Should call findCategoryByName twice: "jajan" then "lainnya"
    expect(mockFindCategoryByName).toHaveBeenCalledTimes(2);
    expect(mockFindCategoryByName).toHaveBeenNthCalledWith(1, {}, "expense", "jajan");
    expect(mockFindCategoryByName).toHaveBeenNthCalledWith(2, {}, "expense", "lainnya");

    // Should insert with fallback category id 11
    expect(mockInsertTransaction).toHaveBeenCalledWith(
      {}, 1, "expense", 11, 10000, "jajan", "jajan 10rb", "2026-02-10"
    );
  });

  it("handles both fallback and direct match in multi-transaction", async () => {
    // Transaction 1: "makan" found directly
    mockFindCategoryByName.mockResolvedValueOnce({ id: 5 });
    // Transaction 2: "laundry" not found, fallback "lainnya" found
    mockFindCategoryByName.mockResolvedValueOnce(null);
    mockFindCategoryByName.mockResolvedValueOnce({ id: 11 });

    const result = await recordTransactions(
      {} as any,
      mockUser,
      {
        transactions: [
          { type: "expense", category: "makan", amount: 25000, description: "makan" },
          { type: "expense", category: "laundry", amount: 15000, description: "laundry" },
        ],
      },
      "makan 25rb, laundry 15rb"
    );

    expect(mockInsertTransaction).toHaveBeenCalledTimes(2);
    expect(result.data).toHaveLength(2);
  });

  it("inserts null category_id only if even 'lainnya' not found (edge case)", async () => {
    // Both original and fallback not found (corrupted DB)
    mockFindCategoryByName.mockResolvedValue(null);

    await recordTransactions(
      {} as any,
      mockUser,
      { transactions: [{ type: "expense", category: "xyz", amount: 5000, description: "test" }] },
      "test 5rb"
    );

    // category_id should be null as ultimate fallback
    expect(mockInsertTransaction).toHaveBeenCalledWith(
      {}, 1, "expense", null, 5000, "test", "test 5rb", "2026-02-10"
    );
  });
});
