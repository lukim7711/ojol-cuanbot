/**
 * Hitung tanggal berdasarkan offset dari hari ini (WIB)
 */
export function getDateFromOffset(offset: number = 0): string {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000); // UTC → WIB
  now.setDate(now.getDate() + offset);
  return now.toISOString().split("T")[0]; // YYYY-MM-DD
}

/**
 * Hitung date range berdasarkan period
 */
export function getDateRange(period: string): { start: string; end: string } {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const today = now.toISOString().split("T")[0];

  switch (period) {
    case "today":
      return { start: today, end: today };

    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yd = y.toISOString().split("T")[0];
      return { start: yd, end: yd };
    }

    case "this_week": {
      const day = now.getDay(); // 0=Sun
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(monday.getDate() + mondayOffset);
      return { start: monday.toISOString().split("T")[0], end: today };
    }

    case "this_month": {
      const firstDay = `${today.substring(0, 7)}-01`;
      return { start: firstDay, end: today };
    }

    default:
      return { start: today, end: today };
  }
}
