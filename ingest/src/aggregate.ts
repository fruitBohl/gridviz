import type { DispatchInterval } from "./dispatchis";
import { createEventTracker, type EventKind } from "./events";
import type { SuspensionRegime } from "./flags";
import type { DayFile } from "./output";
import { addDays, INTERVAL_MS, startOfDayMs, toMarketLabel } from "./time";

export const METRICS = ["price", "demand", "netInterchange", "interconnectorFlow"] as const;
export type Metric = (typeof METRICS)[number];
export const RESOLUTIONS = ["hourly", "daily"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export type PlotEventKind = Exclude<EventKind, "vollOverride"> | "missingData";

export type PlotEvent = {
  kind: PlotEventKind;
  /** Start of the first affected interval and end of the last, market time, no offset. */
  start: string;
  end: string;
  regions?: string[];
  regime?: SuspensionRegime;
};

export type PlotFile = {
  metric: Metric;
  resolution: Resolution;
  unit: "$/MWh" | "MW";
  generatedAt: string;
  /** Last complete day included; the page adds days after this one. */
  throughDate: string;
  /** Bucket starts in market time with no offset: "2025-01-31 14:00" or "2025-01-31". */
  t: string[];
  /** Mean per bucket; null where the series has no data. Every array has the length of `t`. */
  series: Record<string, (number | null)[]>;
  events: PlotEvent[];
  firstSeen: Record<string, string>;
  lastSeen: Record<string, string>;
  /** The last bucket is still filling up (today, or the current hour). */
  partialLast?: true;
};

export const plotKey = (metric: Metric, resolution: Resolution) => `data/plots/${metric}-${resolution}.json`;

const UNITS: Record<Metric, PlotFile["unit"]> = {
  price: "$/MWh",
  demand: "MW",
  netInterchange: "MW",
  interconnectorFlow: "MW",
};

/** Interventions and missing data affect every chart; the rest only change how prices were set. */
const PRICE_ONLY: PlotEventKind[] = ["administeredPrice", "priceLimit", "manualPrice", "lossFactorScaling", "suspended"];

function values(interval: DispatchInterval, metric: Metric): [string, number][] {
  if (metric === "interconnectorFlow") {
    return Object.entries(interval.interconnectors).map(([id, ic]) => [id, ic.mwFlow]);
  }
  return Object.entries(interval.regions).map(([id, r]) => [id, r[metric]]);
}

const bucketKey = (resolution: Resolution, startMs: number) => {
  const label = toMarketLabel(startMs);
  return resolution === "daily" ? label.slice(0, 10) : `${label.slice(0, 13)}:00`;
};

const bucketMs = (key: string) => Date.parse(`${key.length === 10 ? `${key}T00:00` : key.replace(" ", "T")}:00+10:00`);

export function nextBucket(resolution: Resolution, key: string): string {
  return bucketKey(resolution, bucketMs(key) + (resolution === "daily" ? 24 : 1) * 60 * 60 * 1000);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

type Totals = { sum: number[]; count: number[] };

export type AggregatorOptions = {
  /** First trading day expected; data starting later counts as missing. */
  from?: string;
};

export type FinishOptions = {
  generatedAt?: Date;
  /** The last day is still in progress, so its missing end isn't a gap. */
  open?: boolean;
};

/**
 * Turns day files into mean values per bucket. Feed days in date order, one at a time, so two
 * years never have to sit in memory at once. Buckets go by interval start (t - 5 min), so the
 * interval ending 01:00 is in the 00:00 hour and the one ending 00:00 is in the previous day.
 */
export function createAggregator(resolution: Resolution, options: AggregatorOptions = {}) {
  const t: string[] = [];
  const totals = new Map<Metric, Map<string, Totals>>(METRICS.map((m) => [m, new Map()]));
  const seen = new Map<Metric, Map<string, { first: string; last: string }>>(METRICS.map((m) => [m, new Map()]));
  const tracker = createEventTracker();
  const missing: PlotEvent[] = [];
  const fromMs = options.from === undefined ? undefined : startOfDayMs(options.from);
  let lastMs = fromMs;

  const ensureBucket = (key: string) => {
    if (t.length === 0) t.push(fromMs === undefined ? key : bucketKey(resolution, fromMs));
    while (t[t.length - 1] < key) t.push(nextBucket(resolution, t[t.length - 1]));
    return t.length - 1;
  };

  const gap = (fromMs: number, toMs: number) => {
    missing.push({ kind: "missingData", start: toMarketLabel(fromMs), end: toMarketLabel(toMs) });
  };

  return {
    add(day: DayFile) {
      for (const interval of day.intervals) {
        const ms = Date.parse(interval.t);
        if (lastMs !== undefined && ms <= lastMs) {
          throw new Error(`${interval.t}: intervals must be added in time order`);
        }
        if (lastMs !== undefined && ms - lastMs > INTERVAL_MS) gap(lastMs, ms - INTERVAL_MS);
        lastMs = ms;

        const i = ensureBucket(bucketKey(resolution, ms - INTERVAL_MS));
        tracker.add(interval);
        for (const metric of METRICS) {
          const byId = totals.get(metric)!;
          const seenById = seen.get(metric)!;
          for (const [id, value] of values(interval, metric)) {
            let total = byId.get(id);
            if (!total) byId.set(id, (total = { sum: [], count: [] }));
            total.sum[i] = (total.sum[i] ?? 0) + value;
            total.count[i] = (total.count[i] ?? 0) + 1;
            const s = seenById.get(id);
            if (s) s.last = toMarketLabel(ms);
            else seenById.set(id, { first: toMarketLabel(ms - INTERVAL_MS), last: toMarketLabel(ms) });
          }
        }
      }
    },

    finish(throughDate: string, { generatedAt = new Date(), open = false }: FinishOptions = {}): PlotFile[] {
      const endMs = startOfDayMs(addDays(throughDate, 1));
      if (!open && lastMs !== undefined && lastMs < endMs) {
        gap(lastMs, endMs);
        ensureBucket(bucketKey(resolution, endMs - INTERVAL_MS));
      }

      const events: PlotEvent[] = [
        ...missing,
        ...tracker
          .finish()
          .filter((run) => run.kind !== "vollOverride")
          .map(({ kind, first, last, regions, regime }) => ({
            kind: kind as PlotEventKind,
            start: toMarketLabel(Date.parse(first) - INTERVAL_MS),
            end: toMarketLabel(Date.parse(last)),
            ...(regions && { regions }),
            ...(regime && { regime }),
          })),
      ].sort((a, b) => a.start.localeCompare(b.start) || a.kind.localeCompare(b.kind));

      return METRICS.map((metric) => {
        const ids = [...totals.get(metric)!.keys()].sort();
        const series: PlotFile["series"] = {};
        for (const id of ids) {
          const { sum, count } = totals.get(metric)!.get(id)!;
          series[id] = t.map((_, i) => (count[i] ? round2(sum[i] / count[i]) : null));
        }
        const seenById = seen.get(metric)!;
        return {
          metric,
          resolution,
          unit: UNITS[metric],
          generatedAt: generatedAt.toISOString(),
          throughDate,
          t: [...t],
          series,
          events: events.filter((e) => metric === "price" || !PRICE_ONLY.includes(e.kind)),
          firstSeen: Object.fromEntries(ids.map((id) => [id, seenById.get(id)!.first])),
          lastSeen: Object.fromEntries(ids.map((id) => [id, seenById.get(id)!.last])),
          ...(open && t.length > 0 && { partialLast: true as const }),
        };
      });
    },
  };
}

const sameEvent = (a: PlotEvent, b: PlotEvent) =>
  a.kind === b.kind && a.regime === b.regime && a.end === b.start;

/**
 * Adds the newest days, aggregated in the browser, after the history file. History buckets at or
 * after the tail's first bucket are dropped, and events that meet at the join become one.
 */
export function appendTail(history: PlotFile, tail: PlotFile): PlotFile {
  if (history.metric !== tail.metric || history.resolution !== tail.resolution) {
    throw new Error(`can't append ${tail.metric}-${tail.resolution} to ${history.metric}-${history.resolution}`);
  }
  if (tail.t.length === 0) return history;

  let keep = history.t.findIndex((key) => key >= tail.t[0]);
  if (keep === -1) keep = history.t.length;
  const filler: string[] = [];
  let last = history.t[keep - 1];
  while (last !== undefined && nextBucket(history.resolution, last) < tail.t[0]) {
    last = nextBucket(history.resolution, last);
    filler.push(last);
  }

  const nulls = (n: number) => Array<null>(n).fill(null);
  const ids = [...new Set([...Object.keys(history.series), ...Object.keys(tail.series)])].sort();
  const series: PlotFile["series"] = {};
  for (const id of ids) {
    series[id] = [
      ...(history.series[id]?.slice(0, keep) ?? nulls(keep)),
      ...nulls(filler.length),
      ...(tail.series[id] ?? nulls(tail.t.length)),
    ];
  }

  const events = [...history.events];
  for (const e of tail.events) {
    const join = events.findIndex((h) => sameEvent(h, e));
    if (join === -1) {
      events.push(e);
      continue;
    }
    const merged = { ...events[join], end: e.end };
    const regions = [...new Set([...(events[join].regions ?? []), ...(e.regions ?? [])])].sort();
    events[join] = regions.length > 0 ? { ...merged, regions } : merged;
  }

  const pick = (a: Record<string, string>, b: Record<string, string>, choose: (x: string, y: string) => string) =>
    Object.fromEntries(ids.filter((id) => id in a || id in b).map((id) => [id, a[id] && b[id] ? choose(a[id], b[id]) : (a[id] ?? b[id])]));

  return {
    ...history,
    throughDate: tail.throughDate,
    t: [...history.t.slice(0, keep), ...filler, ...tail.t],
    series,
    events: events.sort((a, b) => a.start.localeCompare(b.start) || a.kind.localeCompare(b.kind)),
    firstSeen: pick(history.firstSeen, tail.firstSeen, (x, y) => (x < y ? x : y)),
    lastSeen: pick(history.lastSeen, tail.lastSeen, (x, y) => (x > y ? x : y)),
    ...(tail.partialLast && { partialLast: true }),
  };
}
