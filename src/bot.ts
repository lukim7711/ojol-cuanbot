import { Bot, webhookCallback } from "grammy";
import { Env } from "./config/env";
import { handleStart } from "./handlers/start";
import { handleMessage } from "./handlers/message";
import { handleReset, handleConfirmReset } from "./handlers/reset";
import { handleRekap } from "./handlers/rekap";
import { handleTarget } from "./handlers/target";
import { handleHutang } from "./handlers/hutang";
import { handlePhoto } from "./handlers/photo";

export function createBot(env: Env) {
  const bot = new Bot(env.BOT_TOKEN, {
    botInfo: JSON.parse(env.BOT_INFO),
  });

  // === ZERO-TOKEN COMMANDS (direct service, no AI) ===
  bot.command("start", (ctx) => handleStart(ctx, env));
  bot.command("help", (ctx) => handleStart(ctx, env));
  bot.command("reset", (ctx) => handleReset(ctx, env));
  bot.command("confirm_reset", (ctx) => handleConfirmReset(ctx, env));
  
  // Query shortcuts — 0 neurons per request
  bot.command("rekap", (ctx) => handleRekap(ctx, env));
  bot.command("target", (ctx) => handleTarget(ctx, env));
  bot.command("hutang", (ctx) => handleHutang(ctx, env));

  // === IMAGE-TO-TEXT (OCR.space + AI) ===
  bot.on("message:photo", (ctx) => handlePhoto(ctx, env));

  // === AI PIPELINE (natural language) ===
  // Catch-all: semua pesan teks tanpa slash → AI (~42 neurons)
  bot.on("message:text", (ctx) => handleMessage(ctx, env));

  // Error handler
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return {
    handleWebhook: webhookCallback(bot, "cloudflare-mod"),
  };
}
