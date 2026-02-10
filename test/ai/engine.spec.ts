import { describe, it, expect } from "vitest";
import { isCasualChat, validateToolCalls } from "../../src/ai/engine";
import type { AIResult } from "../../src/ai/engine";

describe("isCasualChat", () => {
  describe("casual messages → true", () => {
    const casualMessages = [
      "halo",
      "hai bos",
      "hey",
      "hi",
      "pagi bos",
      "siang",
      "sore bos",
      "malam",
      "makasih ya",
      "thanks bro",
      "terima kasih",
      "ok",
      "oke",
      "sip",
      "siap bos",
      "mantap",
      "bye",
      "dadah",
      "lagi apa",
      "apa kabar",
      "lu siapa",
      "lo bisa apa",
    ];

    for (const msg of casualMessages) {
      it(`"${msg}" → true`, () => {
        expect(isCasualChat(msg)).toBe(true);
      });
    }
  });

  describe("financial/action messages → false", () => {
    const financialMessages = [
      "rokok goceng",
      "dapet 100rb dari orderan",
      "makan siang 25rb",
      "bensin 40rb",
      "bonus gocap",
      "dapet ceban dari tip",
      "2 hari lalu bensin 40rb",
      "isi bensin 30rb",
      "Andi minjem ke gue 200rb",
      "hutang ke Siti 1jt jatuh tempo 30 hari lagi",
      "yang terakhir salah harusnya 250rb",
      "bayar hutang Budi 100rb",
      "Andi bayar 100rb",
      "Andi bayar lagi 150rb",
      "daftar hutang",
      "daftar piutang",
      "rekap hari ini",
      "rekap",
      "target gue berapa",
      "cek hutang",
      "riwayat pembayaran hutang Andi",
      "hapus yang bensin",
      "yang rokok tadi hapus aja",
      "cicilan gopay 50rb per hari",
      "kewajiban gopay udah dibayar",
      "batal goal motor",
    ];

    for (const msg of financialMessages) {
      it(`"${msg}" → false`, () => {
        expect(isCasualChat(msg)).toBe(false);
      });
    }
  });

  describe("edge cases", () => {
    it("long casual message → false (>4 words bypass)", () => {
      expect(isCasualChat("halo bos gue mau nanya dong tentang fitur baru")).toBe(false);
    });

    it("empty string → false", () => {
      expect(isCasualChat("")).toBe(false);
    });

    it("financial with greeting prefix → false (>4 words)", () => {
      expect(isCasualChat("hai bos rokok goceng makan 20rb")).toBe(false);
    });
  });
});

describe("validateToolCalls", () => {
  it("truncates runaway transaction arrays to max 10", () => {
    const fakeTransactions = Array.from({ length: 50 }, (_, i) => ({
      type: "expense",
      amount: 1000,
      category: "test",
      description: `item-${i}`,
    }));

    const result: AIResult = {
      toolCalls: [
        {
          name: "record_transactions",
          arguments: { transactions: fakeTransactions },
        },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    expect(validated.toolCalls[0].arguments.transactions.length).toBe(10);
  });

  it("filters out invalid amounts (0, negative, >100M)", () => {
    const result: AIResult = {
      toolCalls: [
        {
          name: "record_transactions",
          arguments: {
            transactions: [
              { type: "expense", amount: 5000, category: "rokok", description: "rokok" },
              { type: "expense", amount: 0, category: "bad", description: "zero" },
              { type: "expense", amount: -100, category: "bad", description: "negative" },
              { type: "income", amount: 200000000, category: "bad", description: "too much" },
              { type: "income", amount: 50000, category: "bonus", description: "bonus" },
            ],
          },
        },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    const txns = validated.toolCalls[0].arguments.transactions;
    expect(txns.length).toBe(2);
    expect(txns[0].amount).toBe(5000);
    expect(txns[1].amount).toBe(50000);
  });

  it("deduplicates truly identical tool calls (same name + same args)", () => {
    const result: AIResult = {
      toolCalls: [
        { name: "get_debts", arguments: { type: "all" } },
        { name: "get_debts", arguments: { type: "all" } },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    expect(validated.toolCalls.length).toBe(1);
  });

  it("keeps same tool with different arguments — Bug #11", () => {
    const result: AIResult = {
      toolCalls: [
        { name: "get_debts", arguments: { type: "all" } },
        { name: "get_debts", arguments: { type: "hutang" } },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    // Different args → both kept (Bug #11 fix)
    expect(validated.toolCalls.length).toBe(2);
  });

  it("removes debt tool call with invalid amount (negative)", () => {
    const result: AIResult = {
      toolCalls: [
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Budi", amount: -500 },
        },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    expect(validated.toolCalls.length).toBe(0);
  });

  it("removes pay_debt with zero amount (spurious call)", () => {
    const result: AIResult = {
      toolCalls: [
        { name: "edit_obligation", arguments: { action: "done", name: "gopay" } },
        { name: "pay_debt", arguments: { person_name: "gopay", amount: 0 } },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    expect(validated.toolCalls.length).toBe(1);
    expect(validated.toolCalls[0].name).toBe("edit_obligation");
  });

  it("keeps debt tool call with valid amount", () => {
    const result: AIResult = {
      toolCalls: [
        {
          name: "record_debt",
          arguments: { type: "hutang", person_name: "Budi", amount: 500000 },
        },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    expect(validated.toolCalls.length).toBe(1);
    expect(validated.toolCalls[0].arguments.amount).toBe(500000);
  });

  it("passes through valid tool calls unchanged", () => {
    const result: AIResult = {
      toolCalls: [
        {
          name: "record_transactions",
          arguments: {
            transactions: [
              { type: "expense", amount: 5000, category: "rokok", description: "rokok" },
            ],
          },
        },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    expect(validated.toolCalls[0].arguments.transactions.length).toBe(1);
    expect(validated.toolCalls[0].arguments.transactions[0].amount).toBe(5000);
  });

  it("handles empty tool calls gracefully", () => {
    const result: AIResult = { toolCalls: [], textResponse: "hello" };
    const validated = validateToolCalls(result);
    expect(validated.toolCalls.length).toBe(0);
    expect(validated.textResponse).toBe("hello");
  });

  // ============================================
  // PHASE 3: Delete limiter tests
  // ============================================
  it("allows single delete operation", () => {
    const result: AIResult = {
      toolCalls: [
        { name: "edit_transaction", arguments: { action: "delete", target: "bensin" } },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    expect(validated.toolCalls.length).toBe(1);
    expect(validated.toolCalls[0].arguments.action).toBe("delete");
  });

  it("drops extra delete operations beyond the first", () => {
    const result: AIResult = {
      toolCalls: [
        { name: "edit_transaction", arguments: { action: "delete", target: "bensin" } },
        { name: "edit_debt", arguments: { action: "delete", person_name: "Budi" } },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    // First delete kept, second dropped
    expect(validated.toolCalls.length).toBe(1);
    expect(validated.toolCalls[0].name).toBe("edit_transaction");
  });

  it("allows edit + delete in same request (only delete counts toward limit)", () => {
    const result: AIResult = {
      toolCalls: [
        { name: "edit_transaction", arguments: { action: "edit", target: "bensin", new_amount: 35000 } },
        { name: "edit_debt", arguments: { action: "delete", person_name: "Budi" } },
      ],
      textResponse: null,
    };

    const validated = validateToolCalls(result);
    // Both kept: edit is not a delete, and there's only 1 delete
    expect(validated.toolCalls.length).toBe(2);
  });
});
