import { describe, expect, test } from "bun:test";
import { appendTail, createAggregator, METRICS, type PlotFile } from "../src/aggregate";
import type { DispatchInterval, RegionInterval } from "../src/dispatchis";
import { expectedTimes } from "../src/oddities";
import type { DayFile } from "../src/output";

const REGIONS = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"];
const generatedAt = new Date("2026-10-24T05:00:00Z");

const interval = (t: string, price = 50, extra: Partial<DispatchInterval> = {}, regionExtra: Partial<RegionInterval> = {}): DispatchInterval => ({
  t,
  regions: Object.fromEntries(
    REGIONS.map((r) => [r, { price, demand: 1000, availableGeneration: 2000, netInterchange: -10, ...regionExtra }]),
  ),
  interconnectors: { "V-SA": { mwFlow: 100, exportLimit: 600, importLimit: -500 } },
  ...extra,
});

const day = (date: string, edit: (t: string, n: number) => DispatchInterval | undefined = (t) => interval(t)): DayFile => ({
  tradingDate: date,
  intervals: expectedTimes(date).flatMap((t, n) => edit(t, n) ?? []),
});

const run = (days: DayFile[], throughDate: string, options = {}) => {
  const agg = createAggregator(options);
  days.forEach((d) => agg.add(d));
  return agg.finish(throughDate, { generatedAt });
};
const runOpen = (days: DayFile[]) => {
  const agg = createAggregator();
  days.forEach((d) => agg.add(d));
  return agg.finish(days.at(-1)!.tradingDate, { generatedAt, open: true });
};
const byMetric = (files: PlotFile[]) => Object.fromEntries(files.map((f) => [f.metric, f]));

test("the interval ending 00:00 goes into the previous day", () => {
  const d = day("2026-10-01", (t) => interval(t, t.endsWith("T00:00:00+10:00") ? 950 : 50));
  const daily = byMetric(run([d], "2026-10-01")).price;
  expect(daily.t).toEqual(["2026-10-01"]);
  expect(daily.series.NSW1).toEqual([Math.round(((287 * 50 + 950) / 288) * 100) / 100]);
});

test("a partial day is the mean of the intervals it has", () => {
  const d = day("2026-10-01", (t, n) => (n < 3 ? interval(t, [10, 20, 60][n]) : undefined));
  const price = byMetric(runOpen([d])).price;
  expect(price.t).toEqual(["2026-10-01"]);
  expect(price.series.SA1).toEqual([30]);
  expect(price.partialLast).toBe(true);
});

describe("an interconnector that appears part-way through", () => {
  const days = [
    day("2026-09-30"),
    day("2026-10-01", (t, n) =>
      n < 144
        ? interval(t)
        : interval(t, 50, { interconnectors: { "V-SA": { mwFlow: 100, exportLimit: 600, importLimit: -500 }, "NSW1-SA1": { mwFlow: -40, exportLimit: 150, importLimit: -150 } } }),
    ),
  ];
  const flow = byMetric(run(days, "2026-10-01")).interconnectorFlow;

  test("is null before its first interval", () => {
    expect(flow.series["NSW1-SA1"]).toEqual([null, -40]);
    expect(flow.series["V-SA"].every((v) => v === 100)).toBe(true);
  });

  test("records when each series was first and last seen", () => {
    expect(flow.firstSeen).toEqual({ "NSW1-SA1": "2026-10-01 12:00", "V-SA": "2026-09-30 00:00" });
    expect(flow.lastSeen).toEqual({ "NSW1-SA1": "2026-10-02 00:00", "V-SA": "2026-10-02 00:00" });
  });

  test("every series has the same length as t", () => {
    for (const file of run(days, "2026-10-01")) {
      for (const values of Object.values(file.series)) expect(values).toHaveLength(file.t.length);
    }
  });
});

describe("events", () => {
  const days = [
    day("2026-10-01", (t, n) => {
      if (n >= 286) return interval(t, 50, { intervention: true });
      if (n === 100 || n === 101) return interval(t, 17500, {}, { priceFlags: 4 });
      if (n === 200) return interval(t, 50, {}, { priceFlags: 2 });
      if (n === 150) return undefined;
      return interval(t);
    }),
    day("2026-10-02", (t, n) => (n < 2 ? interval(t, 50, { intervention: true }) : interval(t))),
  ];
  const files = byMetric(run(days, "2026-10-03"));

  test("adjacent flagged intervals merge, including across midnight", () => {
    expect(files.demand.events).toContainEqual({ kind: "intervention", start: "2026-10-01 23:50", end: "2026-10-02 00:10" });
    expect(files.price.events).toContainEqual({
      kind: "priceLimit",
      start: "2026-10-01 08:20",
      end: "2026-10-01 08:30",
      regions: REGIONS,
    });
  });

  test("a missing interval and a whole missing day each give one missingData event", () => {
    const missing = files.demand.events.filter((e) => e.kind === "missingData");
    expect(missing).toEqual([
      { kind: "missingData", start: "2026-10-01 12:30", end: "2026-10-01 12:35" },
      { kind: "missingData", start: "2026-10-03 00:00", end: "2026-10-04 00:00" },
    ]);
    expect(files.demand.t.at(-1)).toBe("2026-10-03");
    expect(files.demand.series.NSW1.at(-1)).toBeNull();
  });

  test("price-only kinds stay off the other charts; VoLL override is not charted", () => {
    expect(files.price.events.map((e) => e.kind)).toEqual(["priceLimit", "missingData", "intervention", "missingData"]);
    expect(files.netInterchange.events.some((e) => e.kind === "priceLimit")).toBe(false);
  });
});

test("data that starts after `from` begins with a missingData event and empty buckets", () => {
  const files = byMetric(run([day("2026-10-03")], "2026-10-03", { from: "2026-10-01" }));
  expect(files.price.t).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  expect(files.price.series.NSW1).toEqual([null, null, 50]);
  expect(files.price.events).toEqual([{ kind: "missingData", start: "2026-10-01 00:00", end: "2026-10-03 00:00" }]);
});

test("intervals out of order are an error", () => {
  const agg = createAggregator();
  agg.add(day("2026-10-02"));
  expect(() => agg.add(day("2026-10-01"))).toThrow("time order");
});

describe("history plus a tail aggregated separately equals one aggregation of everything", () => {
  const all = [
    day("2026-10-01"),
    day("2026-10-02", (t, n) => (n >= 280 ? interval(t, 300, { intervention: true }) : interval(t, 40 + n))),
    day("2026-10-03", (t, n) =>
      n < 4
        ? interval(t, 300, { intervention: true })
        : interval(t, 60, { interconnectors: { "NSW1-SA1": { mwFlow: 5, exportLimit: 1, importLimit: -1 } } }),
    ),
    day("2026-10-05", (t, n) => (n < 100 ? interval(t) : undefined)),
  ];

  test("with a missing day in the tail", () => {
    const finish = (days: DayFile[], through: string, from: string, open: boolean) => {
      const agg = createAggregator({ from });
      days.forEach((d) => agg.add(d));
      return agg.finish(through, { generatedAt, open });
    };
    const whole = finish(all, "2026-10-05", "2026-10-01", true);
    const history = finish(all.slice(0, 2), "2026-10-02", "2026-10-01", false);
    const tail = finish(all.slice(2), "2026-10-05", "2026-10-03", true);
    METRICS.forEach((_, i) => expect(appendTail(history[i], tail[i])).toEqual(whole[i]));
  });

  test("a history that runs past the tail's start is cut back", () => {
    const history = run(all.slice(0, 3), "2026-10-03")[0];
    const tail = run(all.slice(2, 3), "2026-10-03")[0];
    const joined = appendTail(history, tail);
    expect(joined.t).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(joined.series.NSW1).toEqual(history.series.NSW1);
  });
});
