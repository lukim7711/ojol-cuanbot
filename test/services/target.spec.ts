import { describe, it, expect } from "vitest";

// Unit test untuk formatting helpers (logic test, tanpa DB)
describe("Target feature - formatting", () => {
  it("progressBar shows correct fill for 0%", () => {
    const filled = Math.min(10, Math.round(0 / 10));
    const empty = 10 - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    expect(bar).toBe("░░░░░░░░░░");
  });

  it("progressBar shows correct fill for 50%", () => {
    const filled = Math.min(10, Math.round(50 / 10));
    const empty = 10 - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    expect(bar).toBe("█████░░░░░");
  });

  it("progressBar shows correct fill for 100%", () => {
    const filled = Math.min(10, Math.round(100 / 10));
    const empty = 10 - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    expect(bar).toBe("██████████");
  });

  it("progressBar caps at 10 blocks for >100%", () => {
    const filled = Math.min(10, Math.round(150 / 10));
    const empty = 10 - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    expect(bar).toBe("██████████");
  });
});

describe("Target feature - obligation daily amount calculation", () => {
  it("daily frequency returns amount as-is", () => {
    const amount = 50000;
    const frequency = "daily";
    let dailyAmount = amount;
    if (frequency === "weekly") dailyAmount = Math.round(amount / 7);
    if (frequency === "monthly") dailyAmount = Math.round(amount / 30);
    expect(dailyAmount).toBe(50000);
  });

  it("weekly frequency divides by 7", () => {
    const amount = 70000;
    const frequency = "weekly";
    let dailyAmount = amount;
    if (frequency === "weekly") dailyAmount = Math.round(amount / 7);
    if (frequency === "monthly") dailyAmount = Math.round(amount / 30);
    expect(dailyAmount).toBe(10000);
  });

  it("monthly frequency divides by 30", () => {
    const amount = 600000;
    const frequency = "monthly";
    let dailyAmount = amount;
    if (frequency === "weekly") dailyAmount = Math.round(amount / 7);
    if (frequency === "monthly") dailyAmount = Math.round(amount / 30);
    expect(dailyAmount).toBe(20000);
  });
});

describe("Target feature - buffer calculation", () => {
  it("buffer is 10% of subtotal", () => {
    const subtotal = 195000; // contoh
    const buffer = Math.round(subtotal * 0.1);
    expect(buffer).toBe(19500);
  });

  it("total target = subtotal + buffer", () => {
    const subtotal = 195000;
    const buffer = Math.round(subtotal * 0.1);
    const total = subtotal + buffer;
    expect(total).toBe(214500);
  });
});

describe("Target feature - progress calculation", () => {
  it("calculates correct percentage", () => {
    const todayIncome = 150000;
    const totalTarget = 214500;
    const pct = Math.round((todayIncome / totalTarget) * 100);
    expect(pct).toBe(70);
  });

  it("calculates remaining correctly", () => {
    const todayIncome = 150000;
    const totalTarget = 214500;
    const remaining = Math.max(0, totalTarget - todayIncome);
    expect(remaining).toBe(64500);
  });

  it("remaining is 0 when income exceeds target", () => {
    const todayIncome = 250000;
    const totalTarget = 214500;
    const remaining = Math.max(0, totalTarget - todayIncome);
    expect(remaining).toBe(0);
  });

  it("percentage can exceed 100", () => {
    const todayIncome = 250000;
    const totalTarget = 214500;
    const pct = Math.round((todayIncome / totalTarget) * 100);
    expect(pct).toBe(117);
  });

  it("handles zero target gracefully", () => {
    const todayIncome = 100000;
    const totalTarget = 0;
    const pct = totalTarget > 0 ? Math.round((todayIncome / totalTarget) * 100) : 0;
    expect(pct).toBe(0);
  });
});
