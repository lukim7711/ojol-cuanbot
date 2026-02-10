/**
 * Delete Confirmation State (KV-backed)
 *
 * Stores pending delete operations that need user confirmation.
 * When user says "hapus X", we store the intent here and ask "ya/batal?".
 * On next message, router checks this store first.
 *
 * Uses Cloudflare KV with TTL — survives Worker cold starts.
 * KV key format: del:{userId}
 * TTL: 60 seconds — auto-cleanup by Cloudflare
 */

export interface PendingDelete {
  type: "transaction" | "debt";
  args: any;
  description: string;
}

const CONFIRM_TTL_SECONDS = 60;

/**
 * Store a pending delete for a user in KV.
 */
export async function setPendingDelete(
  kv: KVNamespace,
  userId: string,
  data: PendingDelete
): Promise<void> {
  const key = `del:${userId}`;
  try {
    await kv.put(key, JSON.stringify(data), {
      expirationTtl: CONFIRM_TTL_SECONDS,
    });
  } catch (error) {
    // Fail-open: if KV write fails, the delete just won't have
    // confirmation state — user will need to say "hapus" again.
    console.error("[DeleteConfirm] KV write error:", error);
  }
}

/**
 * Get pending delete for a user from KV.
 * Returns null if expired (auto by KV TTL) or not found.
 */
export async function getPendingDelete(
  kv: KVNamespace,
  userId: string
): Promise<PendingDelete | null> {
  const key = `del:${userId}`;
  try {
    const data = await kv.get<PendingDelete>(key, "json");
    return data ?? null;
  } catch (error) {
    // Fail-open: if KV read fails, treat as no pending delete.
    console.error("[DeleteConfirm] KV read error:", error);
    return null;
  }
}

/**
 * Clear pending delete for a user (after confirmation or cancellation).
 */
export async function clearPendingDelete(
  kv: KVNamespace,
  userId: string
): Promise<void> {
  const key = `del:${userId}`;
  try {
    await kv.delete(key);
  } catch (error) {
    // Non-critical: KV TTL will auto-cleanup anyway.
    console.error("[DeleteConfirm] KV delete error:", error);
  }
}
