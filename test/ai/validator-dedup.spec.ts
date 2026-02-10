import { describe, it, expect } from "vitest";
import { validateToolCalls } from "../../src/ai/validator";

/**
 * Tests for Bug #11 fix: Dedup uses name + arguments,
 * not name-only. Multiple record_debt with different args are kept.
 */

describe("validateToolCalls — Bug #11 dedup fix", () => {
  it("keeps multiple record_debt with different arguments (installments)", () => {
    const result = validateToolCalls({
      toolCalls: [
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Tagihan 6/9", amount: 382350, due_date_days: 0, note: "" },
        },
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Tagihan 7/9", amount: 335360, due_date_days: 18, note: "" },
        },
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Tagihan 8/9", amount: 335350, due_date_days: 57, note: "" },
        },
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Tagihan 9/9", amount: 335350, due_date_days: 78, note: "" },
        },
      ],
      textResponse: undefined,
    });

    // All 4 should be kept — different arguments
    expect(result.toolCalls).toHaveLength(4);
    expect(result.toolCalls[0].arguments.person_name).toBe("Tagihan 6/9");
    expect(result.toolCalls[1].arguments.person_name).toBe("Tagihan 7/9");
    expect(result.toolCalls[2].arguments.person_name).toBe("Tagihan 8/9");
    expect(result.toolCalls[3].arguments.person_name).toBe("Tagihan 9/9");
  });

  it("still deduplicates truly identical tool calls", () => {
    const result = validateToolCalls({
      toolCalls: [
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Budi", amount: 50000 },
        },
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Budi", amount: 50000 },
        },
      ],
      textResponse: undefined,
    });

    // Only 1 kept — identical args
    expect(result.toolCalls).toHaveLength(1);
  });

  it("keeps multiple record_transactions (different tool names always kept)", () => {
    const result = validateToolCalls({
      toolCalls: [
        {
          name: "record_transactions",
          arguments: {
            transactions: [
              { type: "income", amount: 18400, category: "orderan", description: "ShopeeFood" },
            ],
          },
        },
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Shopee Paylater", amount: 382350 },
        },
      ],
      textResponse: undefined,
    });

    expect(result.toolCalls).toHaveLength(2);
  });

  it("still limits deletes to 1 per request", () => {
    const result = validateToolCalls({
      toolCalls: [
        {
          name: "edit_transaction",
          arguments: { action: "delete", target: "makan" },
        },
        {
          name: "edit_debt",
          arguments: { action: "delete", person_name: "Budi" },
        },
      ],
      textResponse: undefined,
    });

    // Only first delete kept
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("edit_transaction");
  });

  it("handles record_debt with same amount but different person_name", () => {
    // Tenor 8/9 and 9/9 both have amount 335350 — should still be kept
    const result = validateToolCalls({
      toolCalls: [
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Tagihan 8/9", amount: 335350, due_date_days: 57 },
        },
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Tagihan 9/9", amount: 335350, due_date_days: 78 },
        },
      ],
      textResponse: undefined,
    });

    expect(result.toolCalls).toHaveLength(2);
  });
});
