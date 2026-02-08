import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──
const mockFindUserByTelegram = vi.fn();
const mockCreateUser = vi.fn();

vi.mock("../../src/db/repository", () => ({
  findUserByTelegram: (...args: any[]) => mockFindUserByTelegram(...args),
  createUser: (...args: any[]) => mockCreateUser(...args),
}));

import { getOrCreateUser } from "../../src/services/user";

const mockDB = {} as D1Database;

const existingUser = {
  id: 1,
  telegram_id: "123456789",
  display_name: "Existing Driver",
  timezone: "Asia/Jakarta",
};

describe("getOrCreateUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing user without creating new one", async () => {
    mockFindUserByTelegram.mockResolvedValue(existingUser);

    const result = await getOrCreateUser(mockDB, "123456789", "Existing Driver");

    expect(result).toEqual(existingUser);
    expect(mockFindUserByTelegram).toHaveBeenCalledWith(mockDB, "123456789");
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("creates new user when not found", async () => {
    const newUser = {
      id: 2,
      telegram_id: "987654321",
      display_name: "New Driver",
      timezone: "Asia/Jakarta",
    };
    mockFindUserByTelegram.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue(newUser);

    const result = await getOrCreateUser(mockDB, "987654321", "New Driver");

    expect(result).toEqual(newUser);
    expect(mockFindUserByTelegram).toHaveBeenCalledWith(mockDB, "987654321");
    expect(mockCreateUser).toHaveBeenCalledWith(mockDB, "987654321", "New Driver");
  });

  it("throws error when createUser returns null", async () => {
    mockFindUserByTelegram.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue(null);

    await expect(
      getOrCreateUser(mockDB, "111111111", "Failed User")
    ).rejects.toThrow("Failed to create user");
  });

  it("passes telegramId and displayName correctly to createUser", async () => {
    mockFindUserByTelegram.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({
      id: 3,
      telegram_id: "555555555",
      display_name: "Budi Ojol",
      timezone: "Asia/Jakarta",
    });

    await getOrCreateUser(mockDB, "555555555", "Budi Ojol");

    expect(mockCreateUser).toHaveBeenCalledWith(mockDB, "555555555", "Budi Ojol");
  });

  it("does not call createUser if findUserByTelegram returns a user", async () => {
    mockFindUserByTelegram.mockResolvedValue(existingUser);

    await getOrCreateUser(mockDB, "123456789", "Any Name");

    expect(mockCreateUser).toHaveBeenCalledTimes(0);
  });
});
