/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
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
      const bot = createBot(env);
      return bot.handleWebhook(request);
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
