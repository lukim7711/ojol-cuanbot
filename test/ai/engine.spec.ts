import { describe, it, expect } from "vitest";
import {
  detectHallucinatedResponse,
  looksLikeFinancialInput,
  looksLikeActionQuery,
  shouldHaveToolCall,
} from "../../src/ai/engine";

describe("detectHallucinatedResponse", () => {
  // === Original patterns ===
  it("detects hallucinated transaction confirmation", () => {
    expect(detectHallucinatedResponse("✅ Tercatat! Pengeluaran: Rp25.000")).toBe(true);
  });

  it("detects hallucinated debt confirmation", () => {
    expect(detectHallucinatedResponse("Hutang ke Budi sudah dicatat. Rp500.000")).toBe(true);
  });

  it("detects hallucinated payment confirmation", () => {
    expect(detectHallucinatedResponse("Pembayaran berhasil! Sisa hutang: Rp300.000")).toBe(true);
  });

  it("does NOT flag greeting text", () => {
    expect(detectHallucinatedResponse("Halo bos! Ada yang bisa dibantu?")).toBe(false);
  });

  it("does NOT flag clarification text", () => {
    expect(detectHallucinatedResponse("Mau dicatat sebagai pemasukan atau pengeluaran?")).toBe(false);
  });

  it("does NOT flag clarification with question mark", () => {
    expect(detectHallucinatedResponse("Mau dihapus yang mana?")).toBe(false);
  });

  it("does NOT flag 'Mau disimpan sebagai apa?'", () => {
    expect(detectHallucinatedResponse("Mau disimpan sebagai apa?")).toBe(false);
  });

  it("returns false for null", () => {
    expect(detectHallucinatedResponse(null)).toBe(false);
  });

  it("detects lunas confirmation", () => {
    expect(detectHallucinatedResponse("🎉 Lunas! Hutang ke Budi sudah selesai.")).toBe(true);
  });

  it("detects bayar hutang with amount", () => {
    expect(detectHallucinatedResponse("Bayar hutang ke Siti Rp200.000. Sisa: Rp800.000")).toBe(true);
  });

  it("does NOT flag question about hutang", () => {
    expect(detectHallucinatedResponse("Mau bayar hutang ke siapa?")).toBe(false);
  });

  it("detects sisa hutang pattern", () => {
    expect(detectHallucinatedResponse("Sisa hutang: Rp300.000")).toBe(true);
  });

  // === Edit/delete/cancel hallucination patterns ===
  it("detects hallucinated delete: 'Dihapus! Pengeluaran Rp150.000'", () => {
    expect(detectHallucinatedResponse("🗑 Dihapus! Pengeluaran: Rp150.000")).toBe(true);
  });

  it("detects hallucinated delete: 'Dihapus! Rp0 — hapus transaksi'", () => {
    expect(detectHallucinatedResponse("🗑 Dihapus! Pengeluaran: Rp0 — hapus transaksi yang gak ada")).toBe(true);
  });

  it("detects hallucinated edit: 'Diubah! Rp100.000 → Rp150.000'", () => {
    expect(detectHallucinatedResponse("✏️ Diubah! Rp100.000 → Rp150.000")).toBe(true);
  });

  it("detects hallucinated cancel: 'Dibatalkan! Goal xyz'", () => {
    expect(detectHallucinatedResponse("Dibatalkan! Goal beli helm baru sudah dibatalkan.")).toBe(true);
  });

  it("detects 'sudah dihapus' pattern with transaksi context", () => {
    expect(detectHallucinatedResponse("Transaksi sudah dihapus.")).toBe(true);
  });

  it("detects 'berhasil dihapus' with cicilan context", () => {
    expect(detectHallucinatedResponse("Cicilan gopay berhasil dihapus.")).toBe(true);
  });

  it("detects 'berhasil diedit' with kewajiban context", () => {
    expect(detectHallucinatedResponse("Kewajiban berhasil diedit.")).toBe(true);
  });

  it("detects 'sudah dibatalkan' with goal context", () => {
    expect(detectHallucinatedResponse("Goal sudah dibatalkan.")).toBe(true);
  });
});

describe("looksLikeFinancialInput", () => {
  it("detects 'dapet 200rb orderan'", () => {
    expect(looksLikeFinancialInput("dapet 200rb orderan")).toBe(true);
  });

  it("detects 'bensin 40rb'", () => {
    expect(looksLikeFinancialInput("bensin 40rb")).toBe(true);
  });

  it("does NOT flag 'halo'", () => {
    expect(looksLikeFinancialInput("halo")).toBe(false);
  });

  it("does NOT flag text without numbers", () => {
    expect(looksLikeFinancialInput("daftar hutang gue")).toBe(false);
  });

  it("detects slang numbers: 'goceng'", () => {
    expect(looksLikeFinancialInput("makan goceng")).toBe(true);
  });

  it("detects 'minjem 500rb'", () => {
    expect(looksLikeFinancialInput("minjem 500rb")).toBe(true);
  });

  it("detects edit pattern: 'salah, harusnya 250rb'", () => {
    expect(looksLikeFinancialInput("yang terakhir salah, harusnya 250rb")).toBe(true);
  });

  it("detects 'hapus 50rb'", () => {
    expect(looksLikeFinancialInput("hapus yang 50rb")).toBe(true);
  });

  it("detects 'minus 50rb'", () => {
    expect(looksLikeFinancialInput("dapet minus 50rb")).toBe(true);
  });

  it("detects 'rugi 100rb'", () => {
    expect(looksLikeFinancialInput("rugi 100rb hari ini")).toBe(true);
  });
});

describe("looksLikeActionQuery", () => {
  it("detects 'daftar piutang'", () => {
    expect(looksLikeActionQuery("daftar piutang")).toBe(true);
  });

  it("detects 'riwayat pembayaran hutang Budi'", () => {
    expect(looksLikeActionQuery("riwayat pembayaran hutang Budi")).toBe(true);
  });

  it("detects 'target hari ini'", () => {
    expect(looksLikeActionQuery("target hari ini")).toBe(true);
  });

  it("detects 'rekap'", () => {
    expect(looksLikeActionQuery("rekap")).toBe(true);
  });

  it("does NOT flag 'halo bos'", () => {
    expect(looksLikeActionQuery("halo bos")).toBe(false);
  });

  it("detects 'hapus hutang Budi'", () => {
    expect(looksLikeActionQuery("hapus hutang Budi")).toBe(true);
  });

  it("detects 'batal goal helm'", () => {
    expect(looksLikeActionQuery("batal goal helm")).toBe(true);
  });

  it("detects 'batalkan cicilan gopay'", () => {
    expect(looksLikeActionQuery("batalkan cicilan gopay")).toBe(true);
  });

  it("detects 'hapus transaksi xyz'", () => {
    expect(looksLikeActionQuery("hapus transaksi yang tadi")).toBe(true);
  });

  it("detects 'kewajiban gopay sudah selesai'", () => {
    expect(looksLikeActionQuery("kewajiban gopay sudah selesai")).toBe(true);
  });

  it("detects 'hapus kewajiban kontrakan'", () => {
    expect(looksLikeActionQuery("hapus kewajiban kontrakan")).toBe(true);
  });
});

describe("shouldHaveToolCall", () => {
  it("returns true for financial input with numbers", () => {
    expect(shouldHaveToolCall("dapet 200rb")).toBe(true);
  });

  it("returns true for action query without numbers", () => {
    expect(shouldHaveToolCall("daftar piutang")).toBe(true);
  });

  it("returns false for greeting", () => {
    expect(shouldHaveToolCall("halo bos")).toBe(false);
  });

  it("returns true for obligation done command", () => {
    expect(shouldHaveToolCall("kewajiban gopay sudah selesai")).toBe(true);
  });
});
