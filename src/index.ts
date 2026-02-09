/**
 * CuanBot — Cloudflare Worker Entry Point
 * Handles webhook verification, health checks, and bot routing.
 */

import { createBot } from "./bot";
import { Env } from "./config/env";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Health check (GET)
    if (request.method === "GET") {
      return new Response("🏍️ CuanBot is running!", { status: 200 });
    }

    // Webhook handler (POST from Telegram)
    if (request.method === "POST") {
      // ── Webhook Secret Verification ──
      // Telegram sends X-Telegram-Bot-Api-Secret-Token header if secret_token
      // was set via setWebhook. Reject unauthorized requests.
      if (env.WEBHOOK_SECRET) {
        const headerSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (headerSecret !== env.WEBHOOK_SECRET) {
          console.warn("[Security] Invalid webhook secret. Rejecting request.");
          return new Response("Unauthorized", { status: 401 });
        }
      }

      try {
        const bot = createBot(env);
        return await bot.handleWebhook(request);
      } catch (error) {
        // Global safety net — never let the worker crash unhandled
        console.error("[Worker] Unhandled error in webhook handler:", error);
        // Return 200 to Telegram so it doesn't retry endlessly
        return new Response("OK", { status: 200 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
