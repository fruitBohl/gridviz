import { describe, expect, test } from "bun:test";
import type { DispatchInterval, RegionInterval } from "../src/dispatchis";
import { createReport, expectedTimes } from "../src/oddities";
import type { DayFile } from "../src/output";

const region = (extra: Partial<RegionInterval> = {}): RegionInterval => ({
  price: 50,
  demand: 1,
  availableGeneration: 1,
  netInterchange: 0,
  ...extra,
});

const interval = (t: string, extra: Partial<DispatchInterval> = {}, regionExtra: Record<string, Partial<RegionInterval>> = {}): DispatchInterval => ({
  t,
  regions: Object.fromEntries(["NSW1", "QLD1", "SA1", "TAS1", "VIC1"].map((r) => [r, region(regionExtra[r])])),
  interconnectors: { "V-SA": { mwFlow: 1, exportLimit: 1, importLimit: -1 } },
  ...extra,
});

const fullDay = (date: string, edit: (i: DispatchInterval, n: number) => DispatchInterval = (i) => i): DayFile => ({
  tradingDate: date,
  intervals: expectedTimes(date).map((t, n) => edit(interval(t), n)),
});

test("expectedTimes runs from 00:05 to 00:00 the next day", () => {
  const times = expectedTimes("2024-12-31");
  expect(times).toHaveLength(288);
  expect(times[0]).toBe("2024-12-31T00:05:00+10:00");
  expect(times.at(-1)).toBe("2025-01-01T00:00:00+10:00");
});

test("complete days give an empty report", () => {
  const report = createReport("2026-10-01", "2026-10-02");
  report.add(fullDay("2026-10-01"));
  report.add(fullDay("2026-10-02"));
  const result = report.finish();
  expect(result.missingDays).toEqual([]);
  expect(result.incompleteDays).toEqual([]);
  expect(result.runs).toEqual({});
  expect(result.interconnectors["V-SA"].missingInSpan).toBe(0);
});

test("missing days and missing intervals", () => {
  const report = createReport("2026-10-01", "2026-10-03");
  const day = fullDay("2026-10-01");
  day.intervals.splice(10, 3);
  report.add(day);
  report.add(fullDay("2026-10-03"));
  const result = report.finish();
  expect(result.missingDays).toEqual(["2026-10-02"]);
  expect(result.incompleteDays).toEqual([
    {
      date: "2026-10-01",
      intervals: 285,
      missing: [{ first: "2026-10-01T00:55:00+10:00", last: "2026-10-01T01:05:00+10:00", intervals: 3 }],
      unexpected: [],
    },
  ]);
});

describe("runs of flagged intervals", () => {
  const report = createReport("2026-10-01", "2026-10-02");
  report.add(
    fullDay("2026-10-01", (i, n) => {
      if (n >= 286) return { ...i, intervention: true };
      if (n === 100) return interval(i.t, {}, { SA1: { priceFlags: 4 } });
      if (n === 101) return interval(i.t, {}, { VIC1: { priceFlags: 5 } });
      if (n === 200) return interval(i.t, {}, { TAS1: { suspended: true } });
      return i;
    }),
  );
  report.add(fullDay("2026-10-02", (i, n) => (n < 2 ? { ...i, intervention: true } : i)));
  const { runs } = report.finish();

  test("an intervention run continues across the day boundary", () => {
    expect(runs.intervention).toEqual([
      { first: "2026-10-01T23:55:00+10:00", last: "2026-10-02T00:10:00+10:00", intervals: 4 },
    ]);
  });

  test("APCFLAG bits are decoded, adjacent intervals merge and regions are collected", () => {
    expect(runs.priceLimit).toEqual([
      { first: "2026-10-01T08:25:00+10:00", last: "2026-10-01T08:30:00+10:00", intervals: 2, regions: ["SA1", "VIC1"] },
    ]);
    expect(runs.administeredPrice).toEqual([
      { first: "2026-10-01T08:30:00+10:00", last: "2026-10-01T08:30:00+10:00", intervals: 1, regions: ["VIC1"] },
    ]);
  });

  test("market suspension", () => {
    expect(runs.suspended).toEqual([
      { first: "2026-10-01T16:45:00+10:00", last: "2026-10-01T16:45:00+10:00", intervals: 1, regions: ["TAS1"] },
    ]);
  });
});

test("a run is split by a missing interval", () => {
  const report = createReport("2026-10-01", "2026-10-01");
  const day = fullDay("2026-10-01", (i, n) => (n < 3 ? { ...i, intervention: true } : i));
  day.intervals.splice(1, 1);
  report.add(day);
  expect(report.finish().runs.intervention).toHaveLength(2);
});

test("an interconnector that starts part-way through", () => {
  const report = createReport("2026-10-01", "2026-10-01");
  report.add(
    fullDay("2026-10-01", (i, n) =>
      n >= 100 ? { ...i, interconnectors: { ...i.interconnectors, "NSW1-SA1": { mwFlow: 1, exportLimit: 1, importLimit: -1 } } } : i,
    ),
  );
  expect(report.finish().interconnectors["NSW1-SA1"]).toEqual({
    first: "2026-10-01T08:25:00+10:00",
    last: "2026-10-02T00:00:00+10:00",
    intervals: 188,
    missingInSpan: 0,
  });
});
