import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──
const mockGetTransactionsByDateRange = vi.fn();

vi.mock("../../src/db/repository", () => ({
  getTransactionsByDateRange: (...args: any[]) => mockGetTransactionsByDateRange(...args),
}));

vi.mock("../../src/utils/date", () => ({
  getDateRange: vi.fn((period: string) => {
    const ranges: Record<string, { start: string; end: string }> = {
      today: { start: "2026-02-08", end: "2026-02-08" },
      yesterday: { start: "2026-02-07", end: "2026-02-07" },
      this_week: { start: "2026-02-02", end: "2026-02-08" },
      this_month: { start: "2026-02-01", end: "2026-02-08" },
    };
    return ranges[period] ?? { start: "2026-02-08", end: "2026-02-08" };
  }),
}));

import { getSummary } from "../../src/services/summary";
import { User } from "../../src/types/transaction";

const mockUser: User = {
  id: 1,
  telegram_id: "123456789",
  display_name: "Test Driver",
  timezone: "Asia/Jakarta",
};

const mockDB = {} as D1Database;

describe("getSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates totals from mixed transactions", async () => {
    mockGetTransactionsByDateRange.mockResolvedValue({
      results: [
        { type: "income", amount: 120000, description: "orderan" },
        { type: "expense", amount: 25000, description: "makan" },
        { type: "expense", amount: 30000, description: "bensin" },
        { type: "income", amount: 50000, description: "bonus" },
      ],
    });

    const result = await getSummary(mockDB, mockUser, { period: "today" });

    expect(result.type).toBe("summary");
    expect(result.data.totalIncome).toBe(170000);
    expect(result.data.totalExpense).toBe(55000);
    expect(result.data.details).toHaveLength(4);
  });

  it("returns correct period label for 'today'", async () => {
    mockGetTransactionsByDateRange.mockResolvedValue({ results: [] });

    const result = await getSummary(mockDB, mockUser, { period: "today" });
    expect(result.data.periodLabel).toBe("Hari Ini");
  });

  it("returns correct period label for 'this_month'", async () => {
    mockGetTransactionsByDateRange.mockResolvedValue({ results: [] });

    const result = await getSummary(mockDB, mockUser, { period: "this_month" });
    expect(result.data.periodLabel).toBe("Bulan Ini");
  });

  it("returns zero totals for empty period", async () => {
    mockGetTransactionsByDateRange.mockResolvedValue({ results: [] });

    const result = await getSummary(mockDB, mockUser, { period: "today" });

    expect(result.data.totalIncome).toBe(0);
    expect(result.data.totalExpense).toBe(0);
    expect(result.data.details).toHaveLength(0);
  });

  it("uses custom date range when period is 'custom'", async () => {
    mockGetTransactionsByDateRange.mockResolvedValue({ results: [] });

    const result = await getSummary(mockDB, mockUser, {
      period: "custom",
      custom_start: "2026-01-01",
      custom_end: "2026-01-31",
    });

    // custom period label falls through to "start s/d end" format
    expect(result.data.periodLabel).toContain("2026-01-01");
    expect(result.data.periodLabel).toContain("2026-01-31");
    // Verify it called with custom dates, not getDateRange output
    expect(mockGetTransactionsByDateRange).toHaveBeenCalledWith(
      mockDB, 1, "2026-01-01", "2026-01-31"
    );
  });

  it("includes transaction details in result", async () => {
    mockGetTransactionsByDateRange.mockResolvedValue({
      results: [
        { type: "income", amount: 59000, description: "orderan pagi" },
      ],
    });

    const result = await getSummary(mockDB, mockUser, { period: "today" });

    expect(result.data.details[0]).toEqual({
      type: "income",
      amount: 59000,
      description: "orderan pagi",
    });
  });

  it("falls back to date label for unknown period", async () => {
    mockGetTransactionsByDateRange.mockResolvedValue({ results: [] });

    const result = await getSummary(mockDB, mockUser, { period: "random" });

    // PERIOD_LABELS doesn't have "random", so label = "start s/d end" from getDateRange fallback
    expect(result.data.periodLabel).toContain("s/d");
  });
});
