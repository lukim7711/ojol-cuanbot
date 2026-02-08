import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock findObligationByName to simulate fuzzy search behavior
const mockFindObligationByName = vi.fn();
const mockFindGoalByName = vi.fn();
const mockUpdateObligationStatus = vi.fn();
const mockUpdateGoalStatus = vi.fn();

vi.mock("../../src/db/repository-target", () => ({
  findObligationByName: (...args: any[]) => mockFindObligationByName(...args),
  updateObligationStatus: (...args: any[]) => mockUpdateObligationStatus(...args),
  findGoalByName: (...args: any[]) => mockFindGoalByName(...args),
  updateGoalStatus: (...args: any[]) => mockUpdateGoalStatus(...args),
  getActiveObligations: vi.fn().mockResolvedValue({ results: [] }),
  getActiveGoals: vi.fn().mockResolvedValue({ results: [] }),
  getUserSetting: vi.fn().mockResolvedValue(null),
  getAverageDailyExpense: vi.fn().mockResolvedValue(0),
  getTodayIncome: vi.fn().mockResolvedValue(0),
  insertObligation: vi.fn(),
  insertGoal: vi.fn(),
  upsertUserSetting: vi.fn(),
}));

vi.mock("../../src/db/repository", () => ({
  getActiveDebts: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock("../../src/utils/date", () => ({
  getDateFromOffset: vi.fn().mockReturnValue("2026-02-08"),
}));

vi.mock("../../src/utils/validator", () => ({
  validateAmount: (n: number) => (n > 0 ? n : null),
  sanitizeString: (s: string) => s,
}));

import { editObligation, editGoal } from "../../src/services/target";

const mockDb = {} as D1Database;
const mockUser = { id: 1, telegram_id: "123", display_name: "Test" };

describe("editObligation — fuzzy name matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds obligation with exact LIKE match", async () => {
    mockFindObligationByName.mockResolvedValueOnce(
      { id: 1, name: "cicilan gopay", amount: 50000, frequency: "daily" }
    );
    mockUpdateObligationStatus.mockResolvedValueOnce({});

    const result = await editObligation(mockDb, mockUser, { action: "done", name: "cicilan gopay" });
    expect(result.type).toBe("edited");
    expect(mockFindObligationByName).toHaveBeenCalledTimes(1);
  });

  it("finds 'cicilan gopay' when AI sends 'kewajiban gopay' (token fallback)", async () => {
    // First call: exact match "kewajiban gopay" → null
    mockFindObligationByName.mockResolvedValueOnce(null);
    // Second call: token "gopay" → found!
    mockFindObligationByName.mockResolvedValueOnce(
      { id: 1, name: "cicilan gopay", amount: 50000, frequency: "daily" }
    );
    mockUpdateObligationStatus.mockResolvedValueOnce({});

    const result = await editObligation(mockDb, mockUser, { action: "done", name: "kewajiban gopay" });
    expect(result.type).toBe("edited");
    expect(result.message).toContain("cicilan gopay");
  });

  it("returns clarification when nothing matches", async () => {
    mockFindObligationByName.mockResolvedValue(null);

    const result = await editObligation(mockDb, mockUser, { action: "done", name: "xyz tidak ada" });
    expect(result.type).toBe("clarification");
    expect(result.message).toContain("tidak ditemukan");
  });

  it("skips generic words like 'kewajiban' when tokenizing", async () => {
    mockFindObligationByName.mockResolvedValueOnce(null); // exact "kewajiban kontrakan"
    mockFindObligationByName.mockResolvedValueOnce(
      { id: 2, name: "kontrakan", amount: 500000, frequency: "monthly" }
    );
    mockUpdateObligationStatus.mockResolvedValueOnce({});

    const result = await editObligation(mockDb, mockUser, { action: "done", name: "kewajiban kontrakan" });
    expect(result.type).toBe("edited");
    // Should NOT have tried "kewajiban" as a token (it's in skip list)
    expect(mockFindObligationByName).toHaveBeenCalledTimes(2); // exact + "kontrakan" only
  });
});

describe("editGoal — fuzzy name matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds goal with token fallback", async () => {
    mockFindGoalByName.mockResolvedValueOnce(null); // exact "goal helm"
    mockFindGoalByName.mockResolvedValueOnce(
      { id: 1, name: "beli helm baru", target_amount: 500000, saved_amount: 0, deadline_days: 30 }
    );
    mockUpdateGoalStatus.mockResolvedValueOnce({});

    const result = await editGoal(mockDb, mockUser, { action: "cancel", name: "goal helm" });
    expect(result.type).toBe("edited");
    expect(result.message).toContain("beli helm baru");
  });

  it("returns clarification when goal not found", async () => {
    mockFindGoalByName.mockResolvedValue(null);

    const result = await editGoal(mockDb, mockUser, { action: "cancel", name: "nothing" });
    expect(result.type).toBe("clarification");
  });
});
