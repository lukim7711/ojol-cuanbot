/**
 * Get current date/time in WIB (UTC+7) — properly calculated
 */
function getWIBDate(): Date {
  const now = new Date();
  // Get UTC time, then add 7 hours for WIB
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + 7 * 60 * 60 * 1000);
}

/**
 * Format Date to YYYY-MM-DD string using local components (not toISOString)
 */
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Hitung tanggal berdasarkan offset dari hari ini (WIB)
 */
export function getDateFromOffset(offset: number = 0): string {
  const wib = getWIBDate();
  wib.setDate(wib.getDate() + offset);
  return formatDate(wib);
}

/**
 * Hitung date range berdasarkan period
 */
export function getDateRange(period: string): { start: string; end: string } {
  const wib = getWIBDate();
  const today = formatDate(wib);

  switch (period) {
    case "today":
      return { start: today, end: today };

    case "yesterday": {
      const y = new Date(wib);
      y.setDate(y.getDate() - 1);
      const yd = formatDate(y);
      return { start: yd, end: yd };
    }

    case "this_week": {
      const day = wib.getDay(); // 0=Sun
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(wib);
      monday.setDate(monday.getDate() + mondayOffset);
      return { start: formatDate(monday), end: today };
    }

    case "this_month": {
      const firstDay = `${today.substring(0, 7)}-01`;
      return { start: firstDay, end: today };
    }

    default:
      return { start: today, end: today };
  }
}
