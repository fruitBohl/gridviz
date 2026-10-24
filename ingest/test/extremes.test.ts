import { describe, expect, test } from "bun:test";
import type { DispatchInterval } from "../src/dispatchis";
import { createExtremes, type ExtremesFile } from "../src/extremes";
import { expectedTimes } from "../src/oddities";
import type { DayFile } from "../src/output";
import { addDays } from "../src/time";

const generatedAt = new Date("2026-10-24T05:00:00Z");

const interval = (t: string, price: number, flows: Record<string, number> = { "V-SA": 100 }): DispatchInterval => ({
  t,
  regions: { SA1: { price, demand: 1000, availableGeneration: 2000, netInterchange: -10 } },
  interconnectors: Object.fromEntries(Object.entries(flows).map(([id, mwFlow]) => [id, { mwFlow, exportLimit: 600, importLimit: -500 }])),
});

const day = (date: string, price: (n: number) => number | undefined, flows?: (n: number) => Record<string, number>): DayFile => ({
  tradingDate: date,
  intervals: expectedTimes(date).flatMap((t, n) => {
    const p = price(n);
    return p === undefined ? [] : [interval(t, p, flows?.(n))];
  }),
});

const finish = (days: DayFile[]) => {
  const extremes = createExtremes();
  days.forEach((d) => extremes.add(d));
  return Object.fromEntries(extremes.finish("2026-10-31", { generatedAt }).map((f) => [f.metric, f])) as Record<
    ExtremesFile["metric"],
    ExtremesFile
  >;
};

/** Day i of October has a flat price of 10 * i, except the 3rd, which is low all day bar one spike. */
const october = Array.from({ length: 8 }, (_, i) => {
  const date = addDays("2026-10-01", i);
  return i === 2 ? day(date, (n) => (n === 100 ? 15000 : 1)) : day(date, () => 10 * (i + 1));
});

describe("ranking", () => {
  const { price } = finish(october);

  test("by daily mean, most extreme first, top 5 only", () => {
    const spikeMean = Math.round(((287 + 15000) / 288) * 100) / 100;
    expect(price.ranks.SA1.highest.mean).toEqual([
      { date: "2026-10-08", value: 80 },
      { date: "2026-10-07", value: 70 },
      { date: "2026-10-06", value: 60 },
      { date: "2026-10-03", value: spikeMean },
      { date: "2026-10-05", value: 50 },
    ]);
    expect(price.ranks.SA1.lowest.mean.map((d) => d.value)).toEqual([10, 20, 40, 50, spikeMean]);
  });

  test("by peak, a single spike or dip ranks the day", () => {
    expect(price.ranks.SA1.highest.peak[0]).toEqual({ date: "2026-10-03", value: 15000 });
    expect(price.ranks.SA1.lowest.peak[0]).toEqual({ date: "2026-10-03", value: 1 });
  });

  test("profiles hold every interval of each ranked day and nothing else", () => {
    const ranked = new Set(Object.values(price.ranks.SA1).flatMap((r) => Object.values(r).flatMap((days) => days.map((d) => d.date))));
    expect(Object.keys(price.profiles.SA1).sort()).toEqual([...ranked].sort());
    expect(price.profiles.SA1["2026-10-03"]).toHaveLength(288);
    expect(price.profiles.SA1["2026-10-03"][100]).toBe(15000);
  });

  test("doesn't depend on the order days are added", () => {
    expect(finish([...october].reverse())).toEqual(finish(october));
  });
});

test("peak ties go to the more extreme mean", () => {
  const capped = (date: string, base: number) => day(date, (n) => (n === 0 ? 17500 : base));
  const { price } = finish([capped("2026-10-01", 50), capped("2026-10-02", 90), capped("2026-10-03", 70)]);
  expect(price.ranks.SA1.highest.peak.map((d) => d.date)).toEqual(["2026-10-02", "2026-10-03", "2026-10-01"]);
});

test("days missing any interval for a series don't rank", () => {
  const { price, interconnectorFlow } = finish([
    day("2026-10-01", (n) => (n === 5 ? undefined : 999)),
    day("2026-10-02", () => 50, (n): Record<string, number> => (n < 144 ? { "V-SA": 100 } : { "V-SA": 100, "NSW1-SA1": 900 })),
    day("2026-10-03", () => 60, () => ({ "V-SA": 100, "NSW1-SA1": 30 })),
  ]);
  expect(price.ranks.SA1.highest.mean.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-02"]);
  expect(interconnectorFlow.ranks["NSW1-SA1"].highest.mean).toEqual([{ date: "2026-10-03", value: 30 }]);
});
