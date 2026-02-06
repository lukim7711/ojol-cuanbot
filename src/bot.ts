import { Bot, webhookCallback } from "grammy";
import { Env } from "./config/env";
import { handleStart } from "./handlers/start";
import { handleMessage } from "./handlers/message";

export function createBot(env: Env) {
  const bot = new Bot(env.BOT_TOKEN, {
    botInfo: JSON.parse(env.BOT_INFO),
  });

  // Commands
  bot.command("start", (ctx) => handleStart(ctx, env));
  bot.command("help", (ctx) => handleStart(ctx, env));
  bot.command("rekap", (ctx) => handleMessage(ctx, env, "rekap hari ini"));
  bot.command("hutang", (ctx) => handleMessage(ctx, env, "daftar hutang dan piutang"));

  // Catch-all: semua pesan teks → AI pipeline
  bot.on("message:text", (ctx) => handleMessage(ctx, env));

  // Error handler
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return {
    handleWebhook: webhookCallback(bot, "cloudflare-mod"),
  };
}
