/**
 * AI Module Utilities
 * Shared helpers used across NLU, Executor, and Engine.
 */

/**
 * Get current date in WIB (UTC+7) as YYYY-MM-DD string
 */
export function getWIBDateString(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const wib = new Date(utcMs + 7 * 60 * 60 * 1000);
  const year = wib.getFullYear();
  const month = String(wib.getMonth() + 1).padStart(2, "0");
  const day = String(wib.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
