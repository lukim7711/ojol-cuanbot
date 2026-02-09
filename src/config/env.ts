export interface Env {
  BOT_TOKEN: string;
  BOT_INFO: string;
  DB: D1Database;
  AI: Ai;
  /** Optional: Telegram webhook secret for request verification */
  WEBHOOK_SECRET?: string;
}
