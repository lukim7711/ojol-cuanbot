import { describe, it, expect } from "vitest";
import {
  detectHallucinatedResponse,
  looksLikeFinancialInput,
  looksLikeActionQuery,
  shouldHaveToolCall,
} from "../../src/ai/engine";

describe("detectHallucinatedResponse", () => {
  it("returns false for null", () => {
    expect(detectHallucinatedResponse(null)).toBe(false);
  });

  it("returns false for normal chat response", () => {
    expect(detectHallucinatedResponse("Sama-sama bos!")).toBe(false);
  });

  it("returns false for confirmation without financial data", () => {
    expect(detectHallucinatedResponse("Tercatat ya!")).toBe(false);
  });

  it("detects 'Tercatat' with Rp amount", () => {
    expect(
      detectHallucinatedResponse(
        "\u2705 Tercatat!\n\ud83d\udcb0 Pemasukan: Rp10.000 \u2014 ceban dari tip"
      )
    ).toBe(true);
  });

  it("detects 'Dicatat' with Rp amount", () => {
    expect(
      detectHallucinatedResponse(
        "Dicatat!\nPengeluaran: Rp5.000 \u2014 rokok goceng"
      )
    ).toBe(true);
  });

  it("detects 'Sudah dicatat' with pemasukan", () => {
    expect(
      detectHallucinatedResponse(
        "Sudah dicatat bos! Pemasukan 50rb dari bonus."
      )
    ).toBe(true);
  });

  it("detects 'Berhasil disimpan' with pengeluaran", () => {
    expect(
      detectHallucinatedResponse(
        "Berhasil disimpan! Pengeluaran: Rp30.000 \u2014 bensin"
      )
    ).toBe(true);
  });

  it("detects response with rb amount", () => {
    expect(
      detectHallucinatedResponse(
        "Tercatat! Pemasukan 50rb dari bonus"
      )
    ).toBe(true);
  });

  // Debt-specific hallucination patterns
  it("detects 'Lunas' with hutang context", () => {
    expect(
      detectHallucinatedResponse(
        "Hutang ke Budi lunas! Sisa: Rp0"
      )
    ).toBe(true);
  });

  it("detects 'Berhasil dibayar' with Rp", () => {
    expect(
      detectHallucinatedResponse(
        "Berhasil dibayar Rp300.000 ke Budi"
      )
    ).toBe(true);
  });

  it("detects 'Sisa hutang' with Rp", () => {
    expect(
      detectHallucinatedResponse(
        "Sisa hutang: Rp300.000"
      )
    ).toBe(true);
  });

  it("detects 'Pembayaran berhasil' with hutang", () => {
    expect(
      detectHallucinatedResponse(
        "Pembayaran berhasil! Sisa hutang Rp0"
      )
    ).toBe(true);
  });

  it("detects 'bayar hutang' response with Rp", () => {
    expect(
      detectHallucinatedResponse(
        "Bayar hutang ke Budi Rp200.000. Sisa: Rp300.000"
      )
    ).toBe(true);
  });
});

describe("looksLikeFinancialInput", () => {
  it("returns false for greeting", () => {
    expect(looksLikeFinancialInput("halo bos")).toBe(false);
  });

  it("returns false for question without numbers", () => {
    expect(looksLikeFinancialInput("rekap hari ini")).toBe(false);
  });

  it("detects 'dapet 120rb'", () => {
    expect(looksLikeFinancialInput("dapet 120rb dari orderan")).toBe(true);
  });

  it("detects 'makan 25rb'", () => {
    expect(looksLikeFinancialInput("makan nasi padang 25rb")).toBe(true);
  });

  it("detects 'bensin 30rb'", () => {
    expect(looksLikeFinancialInput("isi bensin 30rb")).toBe(true);
  });

  it("detects slang: 'rokok goceng'", () => {
    expect(looksLikeFinancialInput("rokok goceng")).toBe(true);
  });

  it("detects slang: 'bonus gocap'", () => {
    expect(looksLikeFinancialInput("bonus gocap")).toBe(true);
  });

  it("detects slang: 'dapet ceban'", () => {
    expect(looksLikeFinancialInput("dapet ceban dari tip")).toBe(true);
  });

  it("detects hutang: 'minjem 500rb'", () => {
    expect(looksLikeFinancialInput("minjem ke Budi 500rb")).toBe(true);
  });

  it("detects cicilan: 'cicilan 50rb'", () => {
    expect(looksLikeFinancialInput("cicilan gopay 50rb per hari")).toBe(true);
  });

  // Debt payment patterns
  it("detects 'bayar hutang 200rb'", () => {
    expect(looksLikeFinancialInput("bayar hutang ke Budi 200rb")).toBe(true);
  });

  it("detects 'bayar hutang 300rb'", () => {
    expect(looksLikeFinancialInput("bayar hutang ke Budi 300rb")).toBe(true);
  });

  // Edit patterns
  it("detects 'yang terakhir salah, harusnya 250rb'", () => {
    expect(looksLikeFinancialInput("yang terakhir salah, harusnya 250rb")).toBe(true);
  });

  it("detects 'hutang ke Siti ternyata 1.5jt'", () => {
    expect(looksLikeFinancialInput("hutang ke Siti ternyata 1.5jt, bukan 1jt")).toBe(true);
  });

  it("returns false for just numbers without context", () => {
    expect(looksLikeFinancialInput("123456")).toBe(false);
  });

  it("returns false for non-financial text with numbers", () => {
    expect(looksLikeFinancialInput("gue udah 3 tahun narik")).toBe(false);
  });
});

describe("looksLikeActionQuery", () => {
  it("returns false for greeting", () => {
    expect(looksLikeActionQuery("halo bos")).toBe(false);
  });

  it("returns false for random text", () => {
    expect(looksLikeActionQuery("apa kabar")).toBe(false);
  });

  it("detects 'daftar piutang'", () => {
    expect(looksLikeActionQuery("daftar piutang")).toBe(true);
  });

  it("detects 'daftar hutang'", () => {
    expect(looksLikeActionQuery("daftar hutang gue")).toBe(true);
  });

  it("detects 'daftar semua hutang dan piutang'", () => {
    expect(looksLikeActionQuery("daftar semua hutang dan piutang")).toBe(true);
  });

  it("detects 'cek hutang'", () => {
    expect(looksLikeActionQuery("cek hutang")).toBe(true);
  });

  it("detects 'riwayat pembayaran hutang Budi'", () => {
    expect(looksLikeActionQuery("riwayat pembayaran hutang Budi")).toBe(true);
  });

  it("detects '/hutang'", () => {
    expect(looksLikeActionQuery("/hutang")).toBe(true);
  });

  it("detects 'target hari ini'", () => {
    expect(looksLikeActionQuery("target hari ini")).toBe(true);
  });

  it("detects 'berapa target gue'", () => {
    expect(looksLikeActionQuery("berapa target gue")).toBe(true);
  });

  it("detects 'rekap'", () => {
    expect(looksLikeActionQuery("rekap")).toBe(true);
  });

  it("detects 'hapus hutang Budi'", () => {
    expect(looksLikeActionQuery("hapus hutang Budi")).toBe(true);
  });

  it("detects 'batal goal helm'", () => {
    expect(looksLikeActionQuery("batal goal helm")).toBe(true);
  });

  it("detects 'hapus cicilan gopay'", () => {
    expect(looksLikeActionQuery("hapus cicilan gopay")).toBe(true);
  });
});

describe("shouldHaveToolCall", () => {
  it("returns true for financial input", () => {
    expect(shouldHaveToolCall("dapet 120rb dari orderan")).toBe(true);
  });

  it("returns true for action query", () => {
    expect(shouldHaveToolCall("daftar piutang")).toBe(true);
  });

  it("returns true for edit with number", () => {
    expect(shouldHaveToolCall("yang terakhir salah, harusnya 250rb")).toBe(true);
  });

  it("returns false for casual chat", () => {
    expect(shouldHaveToolCall("makasih bos")).toBe(false);
  });

  it("returns false for general question", () => {
    expect(shouldHaveToolCall("apa itu cuanbot")).toBe(false);
  });
});
