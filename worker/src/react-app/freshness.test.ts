import { describe, it, expect } from "vitest";
import {
  freshnessColor,
  relativeTime,
  FRESH_HOURS,
  STALE_HOURS,
} from "./freshness";

const NOW = new Date("2026-05-18T18:00:00Z").getTime();

function isoMinusHours(h: number): string {
  return new Date(NOW - h * 60 * 60 * 1000).toISOString();
}

describe("freshnessColor", () => {
  it("green below the FRESH_HOURS threshold", () => {
    expect(freshnessColor(0)).toBe("var(--vote-yea)");
    expect(freshnessColor(FRESH_HOURS - 0.1)).toBe("var(--vote-yea)");
  });
  it("amber between FRESH_HOURS and STALE_HOURS", () => {
    expect(freshnessColor(FRESH_HOURS)).toBe("var(--vote-nv)");
    expect(freshnessColor(18)).toBe("var(--vote-nv)");
    expect(freshnessColor(STALE_HOURS - 0.1)).toBe("var(--vote-nv)");
  });
  it("red at and above STALE_HOURS", () => {
    expect(freshnessColor(STALE_HOURS)).toBe("var(--vote-nay)");
    expect(freshnessColor(48)).toBe("var(--vote-nay)");
  });
});

describe("relativeTime", () => {
  it('returns "just now" within the first hour', () => {
    expect(relativeTime(isoMinusHours(0.1), NOW)).toMatchObject({
      label: "just now",
    });
    expect(relativeTime(isoMinusHours(0.99), NOW)).toMatchObject({
      label: "just now",
    });
  });
  it('returns "Xh ago" between 1 and 24 hours', () => {
    expect(relativeTime(isoMinusHours(2), NOW).label).toBe("2h ago");
    expect(relativeTime(isoMinusHours(23), NOW).label).toBe("23h ago");
  });
  it('returns "Xd ago" past 24 hours', () => {
    expect(relativeTime(isoMinusHours(24), NOW).label).toBe("1d ago");
    expect(relativeTime(isoMinusHours(72), NOW).label).toBe("3d ago");
  });
  it("parses SQLite's space-separated UTC timestamps", () => {
    // datetime('now') returns 'YYYY-MM-DD HH:MM:SS' — no T, no Z. The component
    // can't crash on that or freshness silently breaks.
    const sqlite = "2026-05-18 12:00:00";
    const result = relativeTime(sqlite, NOW);
    expect(result.hoursAgo).toBeCloseTo(6, 1);
    expect(result.label).toBe("6h ago");
  });
  it('clamps future timestamps to "just now"', () => {
    // Clock skew between Worker and browser could put 'now' slightly ahead.
    const future = new Date(NOW + 60_000).toISOString();
    expect(relativeTime(future, NOW)).toMatchObject({
      label: "just now",
      hoursAgo: 0,
    });
  });
});
