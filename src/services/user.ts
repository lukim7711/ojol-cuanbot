import { findUserByTelegram, createUser } from "../db/repository";
import { User } from "../types/transaction";

export async function getOrCreateUser(
  db: D1Database,
  telegramId: string,
  displayName: string
): Promise<User> {
  const existing = await findUserByTelegram(db, telegramId);
  if (existing) return existing;

  const newUser = await createUser(db, telegramId, displayName);
  if (!newUser) throw new Error("Failed to create user");
  return newUser;
}
