export interface Env {
  BOT_TOKEN: string;
  BOT_INFO: string;
  DB: D1Database;
  AI: Ai;
  /** Cloudflare KV for rate limiting and message dedup */
  RATE_LIMIT: KVNamespace;
  /** Optional: Telegram webhook secret for request verification */
  WEBHOOK_SECRET?: string;
  /** Optional: OCR.space API key for image-to-text feature */
  OCR_API_KEY?: string;
}
