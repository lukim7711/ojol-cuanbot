/**
 * Delete Confirmation State
 *
 * Stores pending delete operations that need user confirmation.
 * When user says "hapus X", we store the intent here and ask "ya/batal?".
 * On next message, router checks this store first.
 *
 * In-memory with TTL — acceptable because:
 * - Delete confirmations expire in 60 seconds
 * - Worst case (Worker restart): user just has to say "hapus X" again
 * - This is MUCH safer than deleting without asking
 */

export interface PendingDelete {
  type: "transaction" | "debt";
  args: any;
  description: string;
  expiresAt: number;
}

const pendingDeletes = new Map<string, PendingDelete>();
const CONFIRM_TTL_MS = 60_000; // 60 seconds

/**
 * Store a pending delete for a user.
 */
export function setPendingDelete(
  userId: string,
  data: Omit<PendingDelete, "expiresAt">
): void {
  pendingDeletes.set(userId, {
    ...data,
    expiresAt: Date.now() + CONFIRM_TTL_MS,
  });

  // Cleanup old entries
  cleanupExpired();
}

/**
 * Get pending delete for a user. Returns null if expired or not found.
 */
export function getPendingDelete(userId: string): PendingDelete | null {
  const pending = pendingDeletes.get(userId);
  if (!pending) return null;

  if (Date.now() > pending.expiresAt) {
    pendingDeletes.delete(userId);
    return null;
  }

  return pending;
}

/**
 * Clear pending delete for a user (after confirmation or cancellation).
 */
export function clearPendingDelete(userId: string): void {
  pendingDeletes.delete(userId);
}

/**
 * Remove expired entries to prevent memory leak.
 */
function cleanupExpired(): void {
  const now = Date.now();
  for (const [userId, pending] of pendingDeletes.entries()) {
    if (now > pending.expiresAt) {
      pendingDeletes.delete(userId);
    }
  }
}
