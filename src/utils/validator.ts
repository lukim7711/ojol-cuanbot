/**
 * Validasi amount yang dihasilkan AI sebelum insert ke DB
 */
export function validateAmount(amount: any): number | null {
  const num = Number(amount);
  if (isNaN(num) || num <= 0 || num > 100_000_000 || !Number.isInteger(num)) {
    return null;
  }
  return num;
}

/**
 * Sanitize string untuk mencegah injection di reply
 */
export function sanitizeString(str: string): string {
  return str
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&/g, "&amp;")
    .substring(0, 200); // limit panjang
}
