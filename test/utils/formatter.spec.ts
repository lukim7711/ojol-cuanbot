import { describe, it, expect } from "vitest";
import { formatRupiah, formatReply } from "../../src/utils/formatter";
import { ToolCallResult } from "../../src/types/transaction";

describe("formatRupiah", () => {
  it("formats 59000 with Rp prefix", () => {
    const result = formatRupiah(59000);
    expect(result).toMatch(/^Rp/);
    expect(result).toContain("59");
  });

  it("formats 0 correctly", () => {
    const result = formatRupiah(0);
    expect(result).toBe("Rp0");
  });

  it("formats large numbers with dot separators (id-ID locale)", () => {
    const result = formatRupiah(1500000);
    expect(result).toMatch(/^Rp/);
    expect(result).toContain("1.500.000");
  });

  it("formats small amount correctly", () => {
    const result = formatRupiah(5000);
    expect(result).toMatch(/^Rp/);
    expect(result).toContain("5.000");
  });
});

describe("formatReply", () => {
  // ── Basa-basi (no tool calls) ──
  it("returns AI text when no tool calls (basa-basi)", () => {
    const result = formatReply([], "Halo! Ada yang bisa dibantu?");
    expect(result).toBe("Halo! Ada yang bisa dibantu?");
  });

  it("returns fallback message when no tool calls and no AI text", () => {
    const result = formatReply([], null);
    expect(result).toContain("Coba ketik ulang");
  });

  // ── transactions_recorded ──
  it("formats transactions_recorded with income and expense", () => {
    const results: ToolCallResult[] = [
      {
        type: "transactions_recorded",
        data: [
          { type: "income", amount: 59000, description: "pendapatan harian" },
          { type: "expense", amount: 25000, description: "makan di bu tami" },
        ],
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("✅");
    expect(reply).toContain("Tercatat");
    expect(reply).toContain("💰");
    expect(reply).toContain("Pemasukan");
    expect(reply).toContain("💸");
    expect(reply).toContain("Pengeluaran");
    expect(reply).toContain("pendapatan harian");
    expect(reply).toContain("makan di bu tami");
  });

  // ── debt_recorded ──
  it("formats hutang correctly with red icon", () => {
    const results: ToolCallResult[] = [
      {
        type: "debt_recorded",
        data: { type: "hutang", person_name: "Budi", amount: 200000 },
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("🔴");
    expect(reply).toContain("Hutang ke");
    expect(reply).toContain("Budi");
  });

  it("formats piutang correctly with green icon", () => {
    const results: ToolCallResult[] = [
      {
        type: "debt_recorded",
        data: { type: "piutang", person_name: "Andi", amount: 100000 },
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("🟢");
    expect(reply).toContain("Piutang dari");
    expect(reply).toContain("Andi");
  });

  // ── debt_paid ──
  it("formats debt_paid with remaining balance", () => {
    const results: ToolCallResult[] = [
      {
        type: "debt_paid",
        data: { person_name: "Andi", paid: 50000, remaining: 150000 },
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("💳");
    expect(reply).toContain("Andi");
    expect(reply).toContain("Sisa hutang");
  });

  it("formats debt_paid with lunas (remaining = 0)", () => {
    const results: ToolCallResult[] = [
      {
        type: "debt_paid",
        data: { person_name: "Andi", paid: 200000, remaining: 0 },
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("🎉");
    expect(reply).toContain("Lunas");
  });

  // ── summary ──
  it("formats summary with positive net (income > expense)", () => {
    const results: ToolCallResult[] = [
      {
        type: "summary",
        data: {
          periodLabel: "Hari Ini",
          totalIncome: 120000,
          totalExpense: 45000,
          details: [],
        },
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("📊");
    expect(reply).toContain("Rekap Hari Ini");
    expect(reply).toContain("💰");
    expect(reply).toContain("💸");
    expect(reply).toContain("📈"); // net positive
  });

  it("formats summary with negative net (expense > income)", () => {
    const results: ToolCallResult[] = [
      {
        type: "summary",
        data: {
          periodLabel: "Hari Ini",
          totalIncome: 30000,
          totalExpense: 80000,
          details: [],
        },
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("📉"); // net negative
  });

  it("formats summary with details list", () => {
    const results: ToolCallResult[] = [
      {
        type: "summary",
        data: {
          periodLabel: "Bulan Ini",
          totalIncome: 500000,
          totalExpense: 200000,
          details: [
            { description: "orderan", amount: 500000 },
            { description: "makan", amount: 200000 },
          ],
        },
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("orderan");
    expect(reply).toContain("makan");
  });

  // ── debts_list ──
  it("formats empty debts list", () => {
    const results: ToolCallResult[] = [
      { type: "debts_list", data: { debts: [] } },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("✨");
    expect(reply).toContain("Tidak ada hutang/piutang");
  });

  it("formats non-empty debts list", () => {
    const results: ToolCallResult[] = [
      {
        type: "debts_list",
        data: {
          debts: [
            { type: "hutang", person_name: "Budi", amount: 200000, remaining: 150000 },
            { type: "piutang", person_name: "Andi", amount: 100000, remaining: 100000 },
          ],
        },
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("📋");
    expect(reply).toContain("Budi");
    expect(reply).toContain("Andi");
    expect(reply).toContain("🔴");
    expect(reply).toContain("🟢");
  });

  // ── edited ──
  it("formats edited result", () => {
    const results: ToolCallResult[] = [
      { type: "edited", data: null, message: "Transaksi berhasil diubah ke Rp20.000" },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("✏️");
    expect(reply).toContain("berhasil diubah");
  });

  // ── clarification ──
  it("formats clarification result", () => {
    const results: ToolCallResult[] = [
      { type: "clarification", data: null, message: "Maksudnya pengeluaran atau pemasukan?" },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("🤔");
    expect(reply).toContain("Maksudnya pengeluaran atau pemasukan?");
  });

  // ── Multiple results ──
  it("handles multiple result types in one reply", () => {
    const results: ToolCallResult[] = [
      {
        type: "transactions_recorded",
        data: [{ type: "income", amount: 59000, description: "orderan" }],
      },
      {
        type: "debt_paid",
        data: { person_name: "Andi", paid: 50000, remaining: 0 },
      },
    ];
    const reply = formatReply(results, null);
    expect(reply).toContain("Tercatat");
    expect(reply).toContain("💳");
    expect(reply).toContain("Lunas");
  });
});
