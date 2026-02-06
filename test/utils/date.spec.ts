import { describe, it, expect } from "vitest";
import { getDateFromOffset, getDateRange } from "../../src/utils/date";

describe("getDateFromOffset", () => {
  it("returns a date string in YYYY-MM-DD format", () => {
    const result = getDateFromOffset(0);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("offset -1 returns a date before offset 0", () => {
    const today = getDateFromOffset(0);
    const yesterday = getDateFromOffset(-1);
    expect(new Date(yesterday).getTime()).toBeLessThan(
      new Date(today).getTime()
    );
  });

  it("offset 1 returns a date after offset 0", () => {
    const today = getDateFromOffset(0);
    const tomorrow = getDateFromOffset(1);
    expect(new Date(tomorrow).getTime()).toBeGreaterThan(
      new Date(today).getTime()
    );
  });

  it("default offset is 0 (today)", () => {
    const withDefault = getDateFromOffset();
    const withZero = getDateFromOffset(0);
    expect(withDefault).toBe(withZero);
  });

  it("offset -7 returns exactly 7 days before today", () => {
    const today = new Date(getDateFromOffset(0));
    const weekAgo = new Date(getDateFromOffset(-7));
    const diffDays = (today.getTime() - weekAgo.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(7);
  });
});

describe("getDateRange", () => {
  it("'today' returns same start and end date", () => {
    const range = getDateRange("today");
    expect(range.start).toBe(range.end);
    expect(range.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("'yesterday' returns same start and end, one day before today", () => {
    const range = getDateRange("yesterday");
    expect(range.start).toBe(range.end);
    const todayRange = getDateRange("today");
    expect(new Date(range.start).getTime()).toBeLessThan(
      new Date(todayRange.start).getTime()
    );
  });

  it("'this_week' start <= end, end is today", () => {
    const range = getDateRange("this_week");
    const todayRange = getDateRange("today");
    expect(range.end).toBe(todayRange.end);
    expect(new Date(range.start).getTime()).toBeLessThanOrEqual(
      new Date(range.end).getTime()
    );
  });

  it("'this_week' range is at most 7 days", () => {
    const range = getDateRange("this_week");
    const start = new Date(range.start);
    const end = new Date(range.end);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeLessThanOrEqual(6); // Mon-Sun = max 6 days diff
    expect(diffDays).toBeGreaterThanOrEqual(0);
  });

  it("'this_month' start is first day of current month", () => {
    const range = getDateRange("this_month");
    expect(range.start).toMatch(/-01$/);
  });

  it("'this_month' end is today", () => {
    const range = getDateRange("this_month");
    const todayRange = getDateRange("today");
    expect(range.end).toBe(todayRange.end);
  });

  it("unknown period defaults to today", () => {
    const range = getDateRange("unknown_period");
    const todayRange = getDateRange("today");
    expect(range.start).toBe(todayRange.start);
    expect(range.end).toBe(todayRange.end);
  });
});
