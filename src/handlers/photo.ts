/**
 * Photo Handler — Image-to-Text-to-Transaction
 *
 * Flow:
 * 1. User sends photo (screenshot/receipt/note)
 * 2. Download from Telegram API
 * 3. OCR via OCR.space (extract text)
 * 4. Feed extracted text to AI pipeline (same as message handler)
 * 5. AI parses into transactions → reply
 *
 * Supports:
 * - Screenshots app ojol (Grab, Gojek, Maxim)
 * - Screenshots e-wallet (GoPay, OVO, Dana)
 * - Foto struk SPBU, nota makan, parkir
 * - Foto tulisan tangan
 * - Screenshot mutasi bank
 *
 * Cost: ~42 neurons (AI) + 0 (OCR free tier)
 * Latency: ~3-5 seconds
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

export async function handlePhoto(ctx: Context, env: Env): Promise<void> {
  if (!ctx.from || !ctx.message?.photo) return;

  const telegramId = String(ctx.from.id);

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

    // 5. Get user and conversation history
    const displayName = ctx.from.first_name ?? "Driver";
    const user = await getOrCreateUser(env.DB, telegramId, displayName);
    const history = await getRecentConversation(env.DB, user.id, 3);
    const conversationHistory = history.map((h: any) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    }));

    // 6. Build prompt: tell AI this is OCR-extracted text
    const caption = ctx.message.caption?.trim();
    const ocrPrompt = buildOCRPrompt(ocrResult.text, caption);

    // 7. Save user message (as OCR context)
    await saveConversation(env.DB, user.id, "user", `[📷 foto] ${caption || ""} → OCR: ${ocrResult.text.substring(0, 200)}...`);

    // 8. Run AI pipeline (same as text messages)
    const aiResult = await runAI(env, user.id, ocrPrompt, conversationHistory);

    // 9. Process tool calls
    const results = await processToolCalls(
      env.DB,
      user,
      aiResult.toolCalls,
      ocrPrompt
    );

    // 10. Format reply
    const reply = formatReply(results, aiResult.textResponse);

    if (reply && reply.trim().length > 0) {
      await ctx.reply(reply, { parse_mode: "HTML" });

      // Save assistant reply
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
 * Build AI prompt from OCR-extracted text.
 * Adds context so AI knows this is from an image, not typed text.
 */
function buildOCRPrompt(ocrText: string, caption?: string): string {
  let prompt = "";

  if (caption) {
    prompt += `User kirim foto dengan caption: "${caption}"\n\n`;
  } else {
    prompt += "User kirim foto. ";
  }

  prompt += `Berikut teks yang di-extract dari gambar:\n\n\"\"\"
${ocrText}
\"\"\"\n\n`;

  prompt += "Tolong analisa teks di atas dan catat transaksi yang relevan (pemasukan/pengeluaran). ";
  prompt += "Jika teks berisi data keuangan, extract semua transaksi. ";
  prompt += "Jika teks tidak berisi data keuangan, jelaskan apa isi gambar tersebut.";

  return prompt;
}
