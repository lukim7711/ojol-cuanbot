import { describe, it, expect } from "vitest";
import { isCasualChat } from "../../src/ai/engine";

describe("isCasualChat", () => {
  // ============================================
  // TRUE: Messages that should NOT trigger tool calls
  // ============================================
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

  // ============================================
  // FALSE: Messages that SHOULD trigger tool calls
  // ============================================
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

  // ============================================
  // Edge cases
  // ============================================
  describe("edge cases", () => {
    it("long casual message → false (>6 words bypass)", () => {
      expect(isCasualChat("halo bos gue mau nanya dong tentang fitur baru")).toBe(false);
    });

    it("empty string → false", () => {
      expect(isCasualChat("")).toBe(false);
    });

    it("financial with greeting prefix → false", () => {
      // This is 4+ words with financial context, NOT casual
      expect(isCasualChat("hai bos rokok goceng makan 20rb")).toBe(false);
    });
  });
});
