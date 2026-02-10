/**
 * Photo Handler — Image-to-Text-to-Transaction
 *
 * Flow (v2 — with local parser):
 * 1. User sends photo (screenshot/receipt/note)
 * 2. Download from Telegram API
 * 3. OCR via OCR.space (extract text)
 * 4. Clean OCR text (remove noise)
 * 5. TRY local parser first (regex, 0ms, no AI)
 *    → If known format (Shopee) → record directly
 * 6. FALLBACK to AI pipeline (same as before)
 *    → If unknown format → AI parses text
 *
 * Performance:
 *   Known format: 3.5s OCR + 0ms parse = 3.5s total
 *   Unknown format: 3.5s OCR + 5-7s AI = 8-10s total
 *
 * Cost:
 *   Known format: 0 AI calls (saves daily budget)
 *   Unknown format: 1 AI call (same as before)
 */

import { Context } from "grammy";
import { Env } from "../config/env";
import { downloadTelegramPhoto, extractTextFromImage } from "../services/ocr";
import { runAI } from "../ai/engine";
import { getOrCreateUser } from "../services/user";
import { processToolCalls } from "../services/router";
import { getRecentConversation, saveConversation } from "../db/repository";
import { formatReply } from "../utils/formatter";
import { isRateLimited } from "../middleware/rateLimit";
import { tryParseOCR } from "../parsers/index";
import { recordTransactions } from "../services/transaction";

/**
 * Check if a photo message was already processed using KV.
 * Same pattern as message.ts dedup — prevents duplicate transactions
 * when Telegram retries webhook after timeout.
 *
 * KV key format: dedup:{chatId}:{messageId}
 * KV TTL: 300 seconds (5 minutes)
 */
const DEDUP_TTL_SECONDS = 300;

async function isDuplicatePhoto(
  kv: KVNamespace,
  chatId: number | undefined,
  messageId: number | undefined
): Promise<boolean> {
  if (!chatId || !messageId) return false;

  const key = `dedup:${chatId}:${messageId}`;

  try {
    const existing = await kv.get(key);
    if (existing) return true;

    // Mark as processed with TTL
    await kv.put(key, "1", { expirationTtl: DEDUP_TTL_SECONDS });
    return false;
  } catch (error) {
    // If KV fails, allow the request (fail-open)
    console.error("[Dedup:Photo] KV error, failing open:", error);
    return false;
  }
}

export async function handlePhoto(ctx: Context, env: Env): Promise<void> {
  if (!ctx.from || !ctx.message?.photo) return;

  const telegramId = String(ctx.from.id);

  // ============================================
  // IDEMPOTENCY GUARD (KV-based) — Bug 3 fix
  // ============================================
  const duplicate = await isDuplicatePhoto(
    env.RATE_LIMIT,
    ctx.chat?.id,
    ctx.message?.message_id
  );
  if (duplicate) {
    console.warn(`[Dedup:Photo] Skipping duplicate photo: ${ctx.chat?.id}:${ctx.message?.message_id}`);
    return;
  }

  // Rate limit check (KV-based)
  if (await isRateLimited(env.RATE_LIMIT, telegramId)) {
    try {
      await ctx.reply("⏳ Sabar bos, kebanyakan pesan nih. Tunggu bentar ya.");
    } catch (_) {}
    return;
  }

  // Check OCR API key
  if (!env.OCR_API_KEY) {
    await ctx.reply("⚠️ Fitur foto belum dikonfigurasi. Hubungi admin.");
    return;
  }

  try {
    // 1. Send "processing" indicator
    await ctx.reply("📷 Lagi baca gambarnya... tunggu bentar ya bos.");

    // 2. Get best quality photo (last in array = largest)
    const photos = ctx.message.photo;
    const bestPhoto = photos[photos.length - 1];

    // 3. Download photo from Telegram → base64
    let imageBase64: string;
    try {
      imageBase64 = await downloadTelegramPhoto(bestPhoto.file_id, env.BOT_TOKEN);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("FILE_TOO_LARGE")) {
        const sizeKB = error.message.split(":")[1];
        await ctx.reply(
          `⚠️ Foto terlalu besar (${sizeKB}KB). Maksimal 1MB ya bos.\n` +
          `💡 Coba kirim sebagai compressed photo, bukan file.`
        );
        return;
      }
      throw error;
    }

    // 4. OCR — extract text from image
    const ocrResult = await extractTextFromImage(imageBase64, env.OCR_API_KEY);

    if (!ocrResult.success || !ocrResult.text) {
      await ctx.reply(
        "🤔 Hmm, gue nggak bisa baca teksnya.\n\n" +
        "💡 Tips:\n" +
        "• Pastikan gambar jelas dan tidak blur\n" +
        "• Crop bagian yang penting aja\n" +
        "• Kalau screenshot, pastikan teks terlihat jelas\n\n" +
        "Atau ketik manual aja: <i>makan 25rb, bensin 30rb</i>",
        { parse_mode: "HTML" }
      );
      return;
    }

    console.log(`[Photo] OCR extracted ${ocrResult.text.length} chars from user ${telegramId}`);

    // 5. Get user
    const displayName = ctx.from.first_name ?? "Driver";
    const user = await getOrCreateUser(env.DB, telegramId, displayName);
    const caption = ctx.message.caption?.trim();

    // ============================================
    // 6a. LOCAL PARSER — Try known formats first
    //     (0ms, no AI cost, no timeout risk)
    // ============================================
    const cleanedForParser = cleanOCRForParser(ocrResult.text);
    const parseResult = tryParseOCR(cleanedForParser);

    if (parseResult && parseResult.transactions.length > 0) {
      // Count food vs package orders for metadata
      const foodCount = parseResult.transactions.filter(
        (t) => t.description.startsWith("ShopeeFood")
      ).length;
      const spxCount = parseResult.transactions.filter(
        (t) => t.description.startsWith("SPX")
      ).length;
      const otherCount = parseResult.transactions.length - foodCount - spxCount;

      console.log(
        `[Photo] ✅ Local parser: ${parseResult.format}, ` +
        `${parseResult.transactions.length} transactions ` +
        `(food=${foodCount}, spx=${spxCount}, other=${otherCount}), ` +
        `dateOffset=${parseResult.dateOffset}, ` +
        `confidence=${parseResult.confidence}`
      );

      // Record directly — reuse existing recordTransactions service
      const sourceText = `[📷 ${parseResult.format}] ${parseResult.transactions.length} orders`;
      const result = await recordTransactions(
        env.DB,
        user,
        { transactions: parseResult.transactions },
        sourceText
      );

      // Save conversation context
      await saveConversation(
        env.DB,
        user.id,
        "user",
        `[📷 foto ${parseResult.format}] ${parseResult.transactions.length} transaksi terdeteksi`
      );

      // Format and send reply
      const reply = formatReply([result], null);
      if (reply && reply.trim().length > 0) {
        // Build metadata label
        const parts: string[] = [];
        if (foodCount > 0) parts.push(`${foodCount} food`);
        if (spxCount > 0) parts.push(`${spxCount} paket`);
        if (otherCount > 0) parts.push(`${otherCount} lainnya`);
        const meta = `\n\n📋 <i>Auto-parsed dari Shopee (${parts.join(", ")})</i>`;

        await ctx.reply(reply + meta, { parse_mode: "HTML" });

        await saveConversation(
          env.DB,
          user.id,
          "assistant",
          `[parser: ${parseResult.format}]\n${reply}`
        );
      }

      return; // Done! No AI needed.
    }

    // ============================================
    // 6b. AI FALLBACK — Unknown format
    //     (existing flow, for receipts/handwriting/etc.)
    // ============================================
    console.log(
      `[Photo] Unknown format → AI fallback` +
      (parseResult ? ` (detected ${parseResult.format} but 0 transactions)` : "")
    );

    // Get conversation history for AI context
    const history = await getRecentConversation(env.DB, user.id, 3);
    const conversationHistory = history.map((h: any) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    }));

    // Build AI prompt (with truncation for token safety)
    const ocrPrompt = buildOCRPrompt(ocrResult.text, caption);

    // Save user message
    await saveConversation(env.DB, user.id, "user", `[📷 foto] ${caption || ""} → OCR: ${ocrResult.text.substring(0, 200)}...`);

    // Run AI pipeline
    const aiResult = await runAI(env, user.id, ocrPrompt, conversationHistory);

    // Process tool calls
    const results = await processToolCalls(
      env.DB,
      user,
      aiResult.toolCalls,
      ocrPrompt,
      env.RATE_LIMIT
    );

    // Format reply
    const reply = formatReply(results, aiResult.textResponse);

    if (reply && reply.trim().length > 0) {
      await ctx.reply(reply, { parse_mode: "HTML" });

      const toolNames = aiResult.toolCalls.map((tc: any) => tc.name).join(", ");
      await saveConversation(
        env.DB,
        user.id,
        "assistant",
        `[tools: ${toolNames}]\n${reply}`
      );
    }
  } catch (error) {
    console.error("[Photo] Handler error:", error);
    try {
      await ctx.reply(
        "⚠️ Gagal proses foto. Coba lagi ya bos.\n" +
        "Atau ketik manual: <i>makan 25rb, bensin 30rb</i>",
        { parse_mode: "HTML" }
      );
    } catch (_) {}
  }
}

/**
 * Clean OCR text for local parser.
 *
 * Less aggressive than AI cleaning — we want to preserve structure
 * for regex patterns. Only removes the most obvious noise.
 *
 * Unlike buildOCRPrompt cleaning:
 * - NO truncation (parser handles any length)
 * - NO char limit
 * - Keeps line structure intact for regex matching
 */
function cleanOCRForParser(text: string): string {
  let cleaned = text;

  // Remove address noise (biggest source of clutter)
  cleaned = cleaned.replace(/alamat pelanggan disembunyikan/gi, "");
  cleaned = cleaned.replace(/alamat pengirim disembunyikan/gi, "");

  // Tabs → spaces
  cleaned = cleaned.replace(/\t+/g, " ");

  // Remove pure noise lines but keep financial lines
  cleaned = cleaned
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^>\s*$/.test(trimmed)) return false;
      if (/^pesanan gabungan\s*$/i.test(trimmed)) return false;
      return true;
    })
    .join("\n");

  // Collapse excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();

  return cleaned;
}

// ============================================
// AI FALLBACK HELPERS (existing, unchanged)
// ============================================

const MAX_OCR_CHARS = 500;

const OCR_NOISE_PATTERNS = [
  /alamat pelanggan disembunyikan/gi,
  /alamat pengirim disembunyikan/gi,
  /^\s*$/gm,
];

const OCR_NOISE_LINES = [
  /^>\s*$/,
  /^\d\/\d+\s*$/,
  /^pesanan gabungan\s*$/i,
];

function buildOCRPrompt(ocrText: string, caption?: string): string {
  let cleanedText = ocrText;
  for (const pattern of OCR_NOISE_PATTERNS) {
    cleanedText = cleanedText.replace(pattern, "");
  }

  cleanedText = cleanedText.replace(/\t+/g, " ");

  cleanedText = cleanedText
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return !OCR_NOISE_LINES.some((p) => p.test(trimmed));
    })
    .join("\n");

  cleanedText = cleanedText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();

  let wasTruncated = false;
  if (cleanedText.length > MAX_OCR_CHARS) {
    const cutPoint = cleanedText.lastIndexOf("\n", MAX_OCR_CHARS);
    cleanedText = cleanedText.substring(0, cutPoint > 0 ? cutPoint : MAX_OCR_CHARS);
    wasTruncated = true;
  }

  console.log(
    `[Photo] OCR cleaned: ${ocrText.length} → ${cleanedText.length} chars` +
    (wasTruncated ? " (truncated)" : "")
  );

  let prompt = "";

  if (caption) {
    prompt += `User kirim foto dengan caption: "${caption}"\n\n`;
  } else {
    prompt += "User kirim foto. ";
  }

  prompt += `Berikut teks yang di-extract dari gambar:\n\n\"\"\"
${cleanedText}
\"\"\"\n\n`;

  prompt += "Tolong analisa teks di atas dan catat transaksi yang relevan (pemasukan/pengeluaran). ";
  prompt += "Jika teks berisi data keuangan, extract semua transaksi. ";
  prompt += "Jika teks tidak berisi data keuangan, jelaskan apa isi gambar tersebut.";

  if (wasTruncated) {
    prompt += "\n\nNOTE: Teks di atas sudah dipotong karena terlalu panjang. Catat transaksi yang terlihat saja.";
  }

  return prompt;
}
