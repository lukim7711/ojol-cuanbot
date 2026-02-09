import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──
const mockFindUserByTelegram = vi.fn();
const mockResetAllUserData = vi.fn();

vi.mock("../../src/db/repository", () => ({
  findUserByTelegram: (...args: any[]) => mockFindUserByTelegram(...args),
  resetAllUserData: (...args: any[]) => mockResetAllUserData(...args),
}));

import { handleReset, handleConfirmReset } from "../../src/handlers/reset";

const mockReply = vi.fn().mockResolvedValue(undefined);

function createMockCtx(fromId?: number) {
  return {
    from: fromId ? { id: fromId, first_name: "Tester" } : undefined,
    reply: mockReply,
  } as any;
}

const mockEnv = { DB: {} } as any;

// ============================================
// STEP 1: handleReset (shows warning only)
// ============================================
describe("handleReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing if ctx.from is missing", async () => {
    await handleReset(createMockCtx(), mockEnv);
    expect(mockReply).not.toHaveBeenCalled();
  });

  it("replies with warning if user not found", async () => {
    mockFindUserByTelegram.mockResolvedValue(null);

    await handleReset(createMockCtx(123), mockEnv);

    expect(mockReply).toHaveBeenCalledOnce();
    expect(mockReply.mock.calls[0][0]).toContain("belum terdaftar");
  });

  it("shows confirmation warning (does NOT delete yet)", async () => {
    mockFindUserByTelegram.mockResolvedValue({ id: 1 });

    await handleReset(createMockCtx(123), mockEnv);

    expect(mockReply).toHaveBeenCalledOnce();
    const msg = mockReply.mock.calls[0][0] as string;
    expect(msg).toContain("YAKIN");
    expect(msg).toContain("confirm_reset");
    expect(msg).toContain("60 detik");
    // Must NOT have called resetAllUserData
    expect(mockResetAllUserData).not.toHaveBeenCalled();
  });
});

// ============================================
// STEP 2: handleConfirmReset (actual deletion)
// ============================================
describe("handleConfirmReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing if ctx.from is missing", async () => {
    await handleConfirmReset(createMockCtx(), mockEnv);
    expect(mockReply).not.toHaveBeenCalled();
  });

  it("rejects if no pending reset exists", async () => {
    await handleConfirmReset(createMockCtx(999), mockEnv);

    expect(mockReply).toHaveBeenCalledOnce();
    expect(mockReply.mock.calls[0][0]).toContain("Tidak ada permintaan reset aktif");
    expect(mockResetAllUserData).not.toHaveBeenCalled();
  });

  it("deletes all data after valid /reset → /confirm_reset flow", async () => {
    const userId = 400;
    const telegramId = 4000;

    mockFindUserByTelegram.mockResolvedValue({ id: userId });
    mockResetAllUserData.mockResolvedValue({
      debt_payments: 3,
      debts: 2,
      transactions: 15,
      conversation_logs: 20,
      obligations: 1,
      goals: 1,
      user_settings: 2,
    });

    // Step 1: /reset → sets pending
    await handleReset(createMockCtx(telegramId), mockEnv);
    expect(mockResetAllUserData).not.toHaveBeenCalled();

    // Step 2: /confirm_reset → executes deletion
    mockReply.mockClear();
    await handleConfirmReset(createMockCtx(telegramId), mockEnv);

    expect(mockResetAllUserData).toHaveBeenCalledWith({}, userId);
    const msg = mockReply.mock.calls[0][0] as string;
    expect(msg).toContain("Reset Selesai");
    expect(msg).toContain("15 transaksi");
    expect(msg).toContain("2 hutang/piutang");
    expect(msg).toContain("3 pembayaran hutang");
    expect(msg).toContain("1 kewajiban");
    expect(msg).toContain("1 goal");
    expect(msg).toContain("2 setting");
    expect(msg).toContain("20 chat history");
    expect(msg).toContain("Total: 44 data dihapus");
  });

  it("shows empty message if no data to delete", async () => {
    mockFindUserByTelegram.mockResolvedValue({ id: 1 });
    mockResetAllUserData.mockResolvedValue({
      debt_payments: 0,
      debts: 0,
      transactions: 0,
      conversation_logs: 0,
      obligations: 0,
      goals: 0,
      user_settings: 0,
    });

    // Step 1
    await handleReset(createMockCtx(500), mockEnv);
    // Step 2
    mockReply.mockClear();
    await handleConfirmReset(createMockCtx(500), mockEnv);

    expect(mockReply).toHaveBeenCalledOnce();
    expect(mockReply.mock.calls[0][0]).toContain("udah kosong");
  });

  it("only shows lines for tables with data", async () => {
    mockFindUserByTelegram.mockResolvedValue({ id: 1 });
    mockResetAllUserData.mockResolvedValue({
      debt_payments: 0,
      debts: 0,
      transactions: 5,
      conversation_logs: 3,
      obligations: 0,
      goals: 0,
      user_settings: 0,
    });

    // Step 1
    await handleReset(createMockCtx(600), mockEnv);
    // Step 2
    mockReply.mockClear();
    await handleConfirmReset(createMockCtx(600), mockEnv);

    const msg = mockReply.mock.calls[0][0] as string;
    expect(msg).toContain("5 transaksi");
    expect(msg).toContain("3 chat history");
    expect(msg).not.toContain("hutang/piutang");
    expect(msg).not.toContain("kewajiban");
    expect(msg).not.toContain("goal");
    expect(msg).toContain("Total: 8 data dihapus");
  });

  it("passes correct userId to resetAllUserData", async () => {
    mockFindUserByTelegram.mockResolvedValue({ id: 42 });
    mockResetAllUserData.mockResolvedValue({
      debt_payments: 0, debts: 0, transactions: 1,
      conversation_logs: 0, obligations: 0, goals: 0, user_settings: 0,
    });

    // Step 1
    await handleReset(createMockCtx(999), mockEnv);
    // Step 2
    mockReply.mockClear();
    await handleConfirmReset(createMockCtx(999), mockEnv);

    expect(mockFindUserByTelegram).toHaveBeenCalledWith({}, "999");
    expect(mockResetAllUserData).toHaveBeenCalledWith({}, 42);
  });

  it("rejects confirm if user not found (edge case)", async () => {
    // Step 1: reset with valid user
    mockFindUserByTelegram.mockResolvedValue({ id: 1 });
    await handleReset(createMockCtx(700), mockEnv);

    // Step 2: but now user lookup fails
    mockFindUserByTelegram.mockResolvedValue(null);
    mockReply.mockClear();
    await handleConfirmReset(createMockCtx(700), mockEnv);

    expect(mockReply.mock.calls[0][0]).toContain("belum terdaftar");
    expect(mockResetAllUserData).not.toHaveBeenCalled();
  });
});
