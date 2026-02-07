import { describe, it, expect } from "vitest";

describe("Smart Debt - Interest Calculation", () => {
  function calculateInterest(
    principal: number, rate: number, type: string, tenorMonths: number | null
  ) {
    if (type === "none" || rate <= 0) {
      if (tenorMonths && tenorMonths > 0) {
        return { totalWithInterest: principal, installmentAmount: Math.round(principal / tenorMonths) };
      }
      return { totalWithInterest: principal, installmentAmount: null };
    }
    if (type === "flat") {
      const months = tenorMonths || 1;
      const totalInterest = Math.round(principal * rate * months);
      const total = principal + totalInterest;
      const installment = Math.round(total / months);
      return { totalWithInterest: total, installmentAmount: installment };
    }
    if (type === "daily") {
      const days = (tenorMonths || 1) * 30;
      const totalInterest = Math.round(principal * rate * days);
      const total = principal + totalInterest;
      return { totalWithInterest: total, installmentAmount: null };
    }
    return { totalWithInterest: principal, installmentAmount: null };
  }

  it("flat interest: 1.5jt, 2%/bulan, 6 bulan", () => {
    const result = calculateInterest(1500000, 0.02, "flat", 6);
    expect(result.totalWithInterest).toBe(1680000); // 1.5jt + (1.5jt * 2% * 6)
    expect(result.installmentAmount).toBe(280000); // 1.68jt / 6
  });

  it("flat interest: 500rb, 5%/bulan, 3 bulan", () => {
    const result = calculateInterest(500000, 0.05, "flat", 3);
    expect(result.totalWithInterest).toBe(575000);
    expect(result.installmentAmount).toBe(191667);
  });

  it("daily interest: 500rb, 0.1%/hari, 1 bulan", () => {
    const result = calculateInterest(500000, 0.001, "daily", 1);
    expect(result.totalWithInterest).toBe(515000); // 500k + (500k * 0.1% * 30)
    expect(result.installmentAmount).toBeNull();
  });

  it("no interest with tenor: split into installments", () => {
    const result = calculateInterest(3000000, 0, "none", 6);
    expect(result.totalWithInterest).toBe(3000000);
    expect(result.installmentAmount).toBe(500000);
  });

  it("no interest no tenor: returns principal", () => {
    const result = calculateInterest(500000, 0, "none", null);
    expect(result.totalWithInterest).toBe(500000);
    expect(result.installmentAmount).toBeNull();
  });
});

describe("Smart Debt - Overdue Detection", () => {
  function getDebtStatus(dueDate: string | null, nextPayment: string | null, today: string) {
    const checkDate = nextPayment || dueDate;
    if (!checkDate) return { status: "no_due", daysLeft: 0, isOverdue: false };
    const dueMs = new Date(checkDate).getTime();
    const todayMs = new Date(today).getTime();
    const diffDays = Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { status: "overdue", daysLeft: diffDays, isOverdue: true };
    if (diffDays <= 3) return { status: "urgent", daysLeft: diffDays, isOverdue: false };
    if (diffDays <= 7) return { status: "soon", daysLeft: diffDays, isOverdue: false };
    return { status: "ok", daysLeft: diffDays, isOverdue: false };
  }

  it("overdue: due date was 3 days ago", () => {
    const result = getDebtStatus("2026-02-04", null, "2026-02-07");
    expect(result.isOverdue).toBe(true);
    expect(result.daysLeft).toBe(-3);
  });

  it("urgent: due in 2 days", () => {
    const result = getDebtStatus("2026-02-09", null, "2026-02-07");
    expect(result.status).toBe("urgent");
    expect(result.daysLeft).toBe(2);
  });

  it("soon: due in 5 days", () => {
    const result = getDebtStatus("2026-02-12", null, "2026-02-07");
    expect(result.status).toBe("soon");
    expect(result.daysLeft).toBe(5);
  });

  it("ok: due in 30 days", () => {
    const result = getDebtStatus("2026-03-09", null, "2026-02-07");
    expect(result.status).toBe("ok");
    expect(result.daysLeft).toBe(30);
  });

  it("no due date: returns no_due", () => {
    const result = getDebtStatus(null, null, "2026-02-07");
    expect(result.status).toBe("no_due");
  });

  it("uses nextPayment over dueDate when both exist", () => {
    // dueDate is far away, but nextPayment is overdue
    const result = getDebtStatus("2026-08-07", "2026-02-05", "2026-02-07");
    expect(result.isOverdue).toBe(true);
    expect(result.daysLeft).toBe(-2);
  });
});

describe("Smart Debt - Next Payment Calculation", () => {
  function calculateNextPaymentDate(current: string, freq: string): string {
    const [y, m, d] = current.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (freq === "daily") date.setDate(date.getDate() + 1);
    else if (freq === "weekly") date.setDate(date.getDate() + 7);
    else date.setMonth(date.getMonth() + 1);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, "0");
    const nd = String(date.getDate()).padStart(2, "0");
    return `${ny}-${nm}-${nd}`;
  }

  it("monthly: Feb 10 → Mar 10", () => {
    expect(calculateNextPaymentDate("2026-02-10", "monthly")).toBe("2026-03-10");
  });

  it("weekly: Feb 7 → Feb 14", () => {
    expect(calculateNextPaymentDate("2026-02-07", "weekly")).toBe("2026-02-14");
  });

  it("daily: Feb 7 → Feb 8", () => {
    expect(calculateNextPaymentDate("2026-02-07", "daily")).toBe("2026-02-08");
  });

  it("monthly year rollover: Dec 15 → Jan 15", () => {
    expect(calculateNextPaymentDate("2026-12-15", "monthly")).toBe("2027-01-15");
  });
});
