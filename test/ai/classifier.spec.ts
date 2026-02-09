import { describe, it, expect } from "vitest";
import { classifyInput, canSkipNLU, InputClass } from "../../src/ai/classifier";

describe("classifyInput", () => {
  describe("CLEAN — explicit Rp amounts, skip NLU", () => {
    const cleanInputs: [string, string][] = [
      ["makan Rp25.000", "explicit Rp with dots"],
      ["bensin Rp40.000", "explicit Rp fuel"],
      ["makan Rp25000", "explicit Rp no dots"],
      ["pengeluaran rokok Rp5.000", "with category prefix"],
      ["pemasukan orderan Rp120.000", "income with Rp"],
      ["kewajiban gopay Rp50.000 per hari", "obligation with Rp"],
      ["cicilan motor Rp500.000", "installment with Rp"],
      ["goal beli helm Rp300.000", "goal with Rp"],
    ];

    for (const [input, desc] of cleanInputs) {
      it(`"${input}" → CLEAN (${desc})`, () => {
        expect(classifyInput(input)).toBe("CLEAN");
      });
    }
  });

  describe("QUERY — simple read commands, skip NLU", () => {
    const queryInputs: string[] = [
      "rekap",
      "rekap hari ini",
      "rekap kemarin",
      "rekap minggu ini",
      "rekap bulan ini",
      "daftar hutang",
      "daftar piutang",
      "cek hutang",
      "lihat rekap",
      "target",
      "target gue",
      "riwayat hutang Andi",
    ];

    for (const input of queryInputs) {
      it(`"${input}" → QUERY`, () => {
        expect(classifyInput(input)).toBe("QUERY");
      });
    }
  });

  describe("SLANG — needs NLU normalization", () => {
    const slangInputs: string[] = [
      "makan 25rb",
      "bensin 40rb",
      "rokok goceng",
      "bonus gocap",
      "dapet ceban",
      "hutang 1jt",
      "tip 50ribu",
      "dapet sejuta",
      "bayar setengah juta",
      "parkir seceng",
    ];

    for (const input of slangInputs) {
      it(`"${input}" → SLANG`, () => {
        expect(classifyInput(input)).toBe("SLANG");
      });
    }
  });

  describe("EDIT — needs NLU for item preservation", () => {
    const editInputs: string[] = [
      "ubah yang bensin jadi 35rb",
      "hapus yang rokok",
      "yang terakhir salah harusnya 30rb",
      "edit makan jadi 20rb",
      "koreksi bensin",
      "batalkan goal motor",
    ];

    for (const input of editInputs) {
      it(`"${input}" → EDIT`, () => {
        expect(classifyInput(input)).toBe("EDIT");
      });
    }
  });

  describe("COMPLEX — multi-line or ambiguous", () => {
    it("multi-line with slang → COMPLEX", () => {
      expect(classifyInput("makan 25rb\nbensin 30rb")).toBe("COMPLEX");
    });

    it("multi-line ALL clean → CLEAN", () => {
      expect(classifyInput("makan Rp25.000\nbensin Rp30.000")).toBe("CLEAN");
    });

    it("ambiguous single word → COMPLEX", () => {
      // "gopay" alone is ambiguous (expense? obligation?)
      expect(classifyInput("gopay")).toBe("COMPLEX");
    });
  });
});

describe("canSkipNLU", () => {
  it("CLEAN → true", () => expect(canSkipNLU("CLEAN")).toBe(true));
  it("QUERY → true", () => expect(canSkipNLU("QUERY")).toBe(true));
  it("SLANG → false", () => expect(canSkipNLU("SLANG")).toBe(false));
  it("EDIT → false", () => expect(canSkipNLU("EDIT")).toBe(false));
  it("COMPLEX → false", () => expect(canSkipNLU("COMPLEX")).toBe(false));
});
