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
 * PENTING: & harus di-escape DULUAN sebelum < dan >
 * agar tidak terjadi double-escaping (&lt; → &amp;lt;)
 */
export function sanitizeString(str: string): string {
  return str
    .replace(/&/g, "&amp;")  // & harus pertama!
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .substring(0, 200); // limit panjang
}
