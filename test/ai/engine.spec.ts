import { describe, it, expect } from "vitest";
import {
  detectHallucinatedResponse,
  looksLikeFinancialInput,
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
        "✅ Tercatat!\n💰 Pemasukan: Rp10.000 — ceban dari tip"
      )
    ).toBe(true);
  });

  it("detects 'Dicatat' with Rp amount", () => {
    expect(
      detectHallucinatedResponse(
        "Dicatat!\nPengeluaran: Rp5.000 — rokok goceng"
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
        "Berhasil disimpan! Pengeluaran: Rp30.000 — bensin"
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

  it("returns false for just numbers without context", () => {
    expect(looksLikeFinancialInput("123456")).toBe(false);
  });

  it("returns false for non-financial text with numbers", () => {
    expect(looksLikeFinancialInput("gue udah 3 tahun narik")).toBe(false);
  });
});
