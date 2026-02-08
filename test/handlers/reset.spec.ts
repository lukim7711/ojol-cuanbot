import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──
const mockFindUserByTelegram = vi.fn();
const mockResetAllUserData = vi.fn();

vi.mock("../../src/db/repository", () => ({
  findUserByTelegram: (...args: any[]) => mockFindUserByTelegram(...args),
  resetAllUserData: (...args: any[]) => mockResetAllUserData(...args),
}));

import { handleReset } from "../../src/handlers/reset";

const mockReply = vi.fn().mockResolvedValue(undefined);

function createMockCtx(fromId?: number) {
  return {
    from: fromId ? { id: fromId, first_name: "Tester" } : undefined,
    reply: mockReply,
  } as any;
}

const mockEnv = { DB: {} } as any;

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

  it("replies with empty message if no data to delete", async () => {
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

    await handleReset(createMockCtx(123), mockEnv);

    expect(mockReply).toHaveBeenCalledOnce();
    expect(mockReply.mock.calls[0][0]).toContain("udah kosong");
  });

  it("deletes all data and shows per-table counts", async () => {
    mockFindUserByTelegram.mockResolvedValue({ id: 1 });
    mockResetAllUserData.mockResolvedValue({
      debt_payments: 3,
      debts: 2,
      transactions: 15,
      conversation_logs: 20,
      obligations: 1,
      goals: 1,
      user_settings: 2,
    });

    await handleReset(createMockCtx(123), mockEnv);

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
    expect(mockResetAllUserData).toHaveBeenCalledWith({}, 1);
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

    await handleReset(createMockCtx(123), mockEnv);

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

    await handleReset(createMockCtx(999), mockEnv);

    expect(mockFindUserByTelegram).toHaveBeenCalledWith({}, "999");
    expect(mockResetAllUserData).toHaveBeenCalledWith({}, 42);
  });
});
