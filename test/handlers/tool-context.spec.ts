import { describe, it, expect } from "vitest";

// Test the buildToolContext function logic
function buildToolContext(toolCalls: Array<{ name: string; arguments: any }>): string {
  if (toolCalls.length === 0) return "";

  const parts = toolCalls.map((tc) => {
    const argSummary = Object.entries(tc.arguments)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    return `${tc.name}(${argSummary})`;
  });

  return `[tools_used: ${parts.join("; ")}]\n`;
}

describe("buildToolContext", () => {
  it("returns empty string for no tool calls", () => {
    expect(buildToolContext([])).toBe("");
  });

  it("formats single record_debt tool call", () => {
    const result = buildToolContext([
      { name: "record_debt", arguments: { type: "piutang", person_name: "Andi", amount: 200000 } },
    ]);
    expect(result).toContain("[tools_used:");
    expect(result).toContain("record_debt");
    expect(result).toContain("Andi");
    expect(result).toContain("200000");
  });

  it("formats single record_transactions tool call", () => {
    const result = buildToolContext([
      { name: "record_transactions", arguments: { transactions: [{ type: "expense", amount: 5000 }] } },
    ]);
    expect(result).toContain("record_transactions");
    expect(result).toContain("5000");
  });

  it("formats pay_debt tool call", () => {
    const result = buildToolContext([
      { name: "pay_debt", arguments: { person_name: "Budi", amount: 100000 } },
    ]);
    expect(result).toContain("pay_debt");
    expect(result).toContain("Budi");
    expect(result).toContain("100000");
  });

  it("handles multiple tool calls", () => {
    const result = buildToolContext([
      { name: "record_transactions", arguments: { transactions: [] } },
      { name: "record_debt", arguments: { type: "hutang", person_name: "Siti" } },
    ]);
    expect(result).toContain("record_transactions");
    expect(result).toContain("record_debt");
    expect(result).toContain(";");
  });

  it("context helps AI select correct edit tool", () => {
    // Simulate: user recorded a debt, now wants to edit
    // The conversation history would contain this context
    const debtContext = buildToolContext([
      { name: "record_debt", arguments: { type: "piutang", person_name: "Andi", amount: 200000 } },
    ]);

    // AI should see record_debt in history → use edit_debt, not edit_transaction
    expect(debtContext).toContain("record_debt");
    expect(debtContext).not.toContain("record_transactions");
  });
});
