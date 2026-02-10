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

    // 9. Process tool calls (pass KV for delete confirmation)
    const results = await processToolCalls(
      env.DB,
      user,
      aiResult.toolCalls,
      ocrPrompt,
      env.RATE_LIMIT
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
 * Maximum OCR text length to send to AI.
 *
 * Bug #9 fix (v2): Reduced from 800 → 500.
 * At 800 chars, cleaned text (746 chars) still caused 3030 when
 * combined with system prompt (~500 tokens) + tool defs (~800 tokens).
 *
 * Token budget estimate:
 *   Llama Scout context: ~8192 tokens
 *   System prompt: ~500 tokens
 *   Tool definitions (4 tools): ~800 tokens
 *   OCR text (500 chars): ~150 tokens
 *   Wrapper prompt: ~100 tokens
 *   Response budget: ~500 tokens
 *   Safety margin: ~6000 tokens
 */
const MAX_OCR_CHARS = 500;

/**
 * Noise patterns commonly found in OCR output from ojol screenshots.
 * These lines add no financial value and waste tokens.
 */
const OCR_NOISE_PATTERNS = [
  /alamat pelanggan disembunyikan/gi,
  /alamat pengirim disembunyikan/gi,
  /^\s*$/gm,                          // blank lines
  /\t+/g,                             // tab characters → space
];

/**
 * Lines that contain only non-financial noise (no Rp amount).
 * Used as secondary filter after pattern removal.
 */
const OCR_NOISE_LINES = [
  /^>\s*$/,                            // lone ">" from UI
  /^\d\/\d+\s*$/,                      // lone "1/9" without amount
  /^pesanan gabungan\s*$/i,            // standalone label
];

/**
 * Build AI prompt from OCR-extracted text.
 * Adds context so AI knows this is from an image, not typed text.
 *
 * Bug #9 fix (v2): Aggressive cleaning + lower truncation limit.
 * Pipeline:
 *   1. Remove known noise patterns (addresses, tabs, blanks)
 *   2. Remove noise-only lines (UI artifacts)
 *   3. Collapse whitespace
 *   4. Truncate to MAX_OCR_CHARS at last complete line
 */
function buildOCRPrompt(ocrText: string, caption?: string): string {
  // Step 1: Clean noise patterns
  let cleanedText = ocrText;
  for (const pattern of OCR_NOISE_PATTERNS) {
    cleanedText = cleanedText.replace(pattern, pattern === /\t+/g ? " " : "");
  }

  // Replace tabs with spaces (the regex replace above may not catch all)
  cleanedText = cleanedText.replace(/\t+/g, " ");

  // Step 2: Remove noise-only lines
  cleanedText = cleanedText
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return !OCR_NOISE_LINES.some((p) => p.test(trimmed));
    })
    .join("\n");

  // Step 3: Collapse multiple newlines and spaces
  cleanedText = cleanedText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();

  // Step 4: Truncate if too long
  let wasTruncated = false;
  if (cleanedText.length > MAX_OCR_CHARS) {
    // Try to cut at last complete line within limit
    const cutPoint = cleanedText.lastIndexOf("\n", MAX_OCR_CHARS);
    cleanedText = cleanedText.substring(0, cutPoint > 0 ? cutPoint : MAX_OCR_CHARS);
    wasTruncated = true;
  }

  console.log(
    `[Photo] OCR cleaned: ${ocrText.length} → ${cleanedText.length} chars` +
    (wasTruncated ? " (truncated)" : "")
  );

  // Step 5: Build prompt
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
