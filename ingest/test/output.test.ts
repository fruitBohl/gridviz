import { describe, expect, test } from "bun:test";
import type { DispatchInterval } from "../src/dispatchis";
import { last24Hours, mergeIntervals, startOfTradingDay, toLatest, tradingDate } from "../src/output";

const at = (t: string, price = 1): DispatchInterval => ({
  t,
  regions: { NSW1: { price, demand: 1, availableGeneration: 1, netInterchange: 0 } },
  interconnectors: {},
});

describe("tradingDate", () => {
  test("the interval ending 00:00 belongs to the previous day", () => {
    expect(tradingDate("2026-10-25T00:00:00+10:00")).toBe("2026-10-24");
    expect(tradingDate("2026-10-25T00:05:00+10:00")).toBe("2026-10-25");
    expect(tradingDate("2026-10-24T23:55:00+10:00")).toBe("2026-10-24");
  });

  test("works across month and year ends", () => {
    expect(tradingDate("2027-01-01T00:00:00+10:00")).toBe("2026-12-31");
  });

  test("startOfTradingDay", () => {
    expect(startOfTradingDay("2026-10-24T15:05:00+10:00")).toBe("2026-10-24T00:05:00+10:00");
    expect(startOfTradingDay("2026-10-25T00:00:00+10:00")).toBe("2026-10-24T00:05:00+10:00");
  });
});

describe("mergeIntervals", () => {
  test("creates a day file when none exists", () => {
    expect(mergeIntervals(undefined, "2026-10-24", [at("2026-10-24T00:10:00+10:00")])).toEqual({
      tradingDate: "2026-10-24",
      intervals: [at("2026-10-24T00:10:00+10:00")],
    });
  });

  test("sorts, de-duplicates and lets the newer copy win", () => {
    const existing = {
      tradingDate: "2026-10-24",
      intervals: [at("2026-10-24T00:05:00+10:00"), at("2026-10-24T00:15:00+10:00", 1)],
    };
    const merged = mergeIntervals(existing, "2026-10-24", [
      at("2026-10-24T00:15:00+10:00", 2),
      at("2026-10-24T00:10:00+10:00"),
    ]);
    expect(merged.intervals.map((i) => i.t)).toEqual([
      "2026-10-24T00:05:00+10:00",
      "2026-10-24T00:10:00+10:00",
      "2026-10-24T00:15:00+10:00",
    ]);
    expect(merged.intervals[2].regions.NSW1.price).toBe(2);
  });
});

test("toLatest renames t to settlementDate", () => {
  const latest = toLatest(at("2026-10-24T15:05:00+10:00"), new Date("2026-10-24T05:01:09Z"));
  expect(latest).toEqual({
    settlementDate: "2026-10-24T15:05:00+10:00",
    generatedAt: "2026-10-24T05:01:09.000Z",
    regions: at("").regions,
    interconnectors: {},
  });
  expect("t" in latest).toBe(false);
});

describe("last24Hours", () => {
  test("keeps 24 hours across two day files and adds latest.json when the day file lags", () => {
    const now = new Date("2026-10-25T05:00:00Z");
    const yesterday = { tradingDate: "2026-10-24", intervals: [at("2026-10-24T14:55:00+10:00"), at("2026-10-24T15:05:00+10:00")] };
    const today = { tradingDate: "2026-10-25", intervals: [at("2026-10-25T14:55:00+10:00")] };
    const latest = toLatest(at("2026-10-25T15:00:00+10:00", 9), now);
    expect(last24Hours([yesterday, undefined, today], latest).map((i) => i.t)).toEqual([
      "2026-10-24T15:05:00+10:00",
      "2026-10-25T14:55:00+10:00",
      "2026-10-25T15:00:00+10:00",
    ]);
  });
});
