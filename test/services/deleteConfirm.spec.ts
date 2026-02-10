import { describe, it, expect, vi, beforeEach } from "vitest";
import { setPendingDelete, getPendingDelete, clearPendingDelete } from "../../src/services/deleteConfirm";

/**
 * Mock KV namespace for testing.
 * Simulates Cloudflare KV get/put/delete.
 */
function createMockKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string, type?: string) => {
      const val = store.get(key);
      if (!val) return null;
      if (type === "json") return JSON.parse(val);
      return val;
    }),
    put: vi.fn(async (key: string, value: string, _opts?: any) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as KVNamespace & { store: Map<string, string> };
}

describe("deleteConfirm (KV-backed)", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("should store and retrieve pending delete", async () => {
    const data = {
      type: "transaction" as const,
      args: { action: "delete", target: "makan" },
      description: "makan",
    };

    await setPendingDelete(kv, "123", data);
    const result = await getPendingDelete(kv, "123");

    expect(result).not.toBeNull();
    expect(result!.type).toBe("transaction");
    expect(result!.args.target).toBe("makan");
    expect(result!.description).toBe("makan");
  });

  it("should return null for non-existent user", async () => {
    const result = await getPendingDelete(kv, "999");
    expect(result).toBeNull();
  });

  it("should clear pending delete", async () => {
    await setPendingDelete(kv, "123", {
      type: "debt",
      args: { action: "delete", person_name: "budi" },
      description: "budi",
    });

    await clearPendingDelete(kv, "123");
    const result = await getPendingDelete(kv, "123");

    expect(result).toBeNull();
  });

  it("should use correct KV key format", async () => {
    await setPendingDelete(kv, "456", {
      type: "transaction",
      args: {},
      description: "test",
    });

    // Verify KV key is del:{userId}
    expect(kv.store.has("del:456")).toBe(true);
  });

  it("should pass TTL to KV put", async () => {
    await setPendingDelete(kv, "123", {
      type: "transaction",
      args: {},
      description: "test",
    });

    // Verify put was called with expirationTtl
    expect(kv.put).toHaveBeenCalledWith(
      "del:123",
      expect.any(String),
      { expirationTtl: 60 }
    );
  });

  it("should fail-open on KV read error", async () => {
    const brokenKV = {
      get: vi.fn(async () => { throw new Error("KV unavailable"); }),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    const result = await getPendingDelete(brokenKV, "123");
    expect(result).toBeNull(); // fail-open: treat as no pending
  });

  it("should fail-open on KV write error", async () => {
    const brokenKV = {
      get: vi.fn(),
      put: vi.fn(async () => { throw new Error("KV unavailable"); }),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    // Should not throw
    await expect(
      setPendingDelete(brokenKV, "123", {
        type: "transaction",
        args: {},
        description: "test",
      })
    ).resolves.toBeUndefined();
  });

  it("should isolate different users", async () => {
    await setPendingDelete(kv, "user_a", {
      type: "transaction",
      args: { target: "makan" },
      description: "makan",
    });
    await setPendingDelete(kv, "user_b", {
      type: "debt",
      args: { person_name: "siti" },
      description: "siti",
    });

    const a = await getPendingDelete(kv, "user_a");
    const b = await getPendingDelete(kv, "user_b");

    expect(a!.type).toBe("transaction");
    expect(b!.type).toBe("debt");
  });
});
