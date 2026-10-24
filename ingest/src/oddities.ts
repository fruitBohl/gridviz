import { PRICE_FLAGS, type DispatchInterval } from "./dispatchis";
import type { DayFile } from "./output";

const AEST_MS = 10 * 60 * 60 * 1000;
const INTERVAL_MS = 5 * 60 * 1000;
export const INTERVALS_PER_DAY = 288;

const toIso = (ms: number) => `${new Date(ms + AEST_MS).toISOString().slice(0, 19)}+10:00`;

/** Interval end times for a trading day: 00:05 on the day through 00:00 the next day. */
export function expectedTimes(date: string): string[] {
  const start = Date.parse(`${date}T00:05:00+10:00`);
  return Array.from({ length: INTERVALS_PER_DAY }, (_, i) => toIso(start + i * INTERVAL_MS));
}

export type OddityKind = "intervention" | "suspended" | keyof typeof PRICE_FLAGS;

/** Consecutive intervals of one kind; `first` and `last` are interval end times. */
export type OddityRun = { first: string; last: string; intervals: number; regions?: string[] };

export type OddityReport = {
  from: string;
  to: string;
  missingDays: string[];
  incompleteDays: { date: string; intervals: number; missing: OddityRun[]; unexpected: string[] }[];
  runs: Partial<Record<OddityKind, OddityRun[]>>;
  interconnectors: Record<string, { first: string; last: string; intervals: number; missingInSpan: number }>;
};

function activeKinds(interval: DispatchInterval): Map<OddityKind, string[]> {
  const active = new Map<OddityKind, string[]>();
  if (interval.intervention) active.set("intervention", []);
  for (const [region, r] of Object.entries(interval.regions)) {
    const kinds: OddityKind[] = [];
    if (r.suspended) kinds.push("suspended");
    for (const [kind, bit] of Object.entries(PRICE_FLAGS) as [OddityKind, number][]) {
      if ((r.priceFlags ?? 0) & bit) kinds.push(kind);
    }
    for (const kind of kinds) active.set(kind, [...(active.get(kind) ?? []), region]);
  }
  return active;
}

function toRuns(times: string[]): OddityRun[] {
  const runs: OddityRun[] = [];
  for (const t of times) {
    const last = runs.at(-1);
    if (last && Date.parse(t) - Date.parse(last.last) === INTERVAL_MS) {
      last.last = t;
      last.intervals++;
    } else {
      runs.push({ first: t, last: t, intervals: 1 });
    }
  }
  return runs;
}

/** Feed day files in date order; `finish` lists everything the plots should flag. */
export function createReport(from: string, to: string) {
  const seenDays = new Set<string>();
  const incompleteDays: OddityReport["incompleteDays"] = [];
  const runs: OddityReport["runs"] = {};
  const open = new Map<OddityKind, OddityRun & { lastMs: number; regionSet: Set<string> }>();
  const links = new Map<string, { first: string; last: string; intervals: number }>();

  const close = (kind: OddityKind) => {
    const { first, last, intervals, regionSet } = open.get(kind)!;
    const run: OddityRun = { first, last, intervals };
    if (regionSet.size > 0) run.regions = [...regionSet].sort();
    (runs[kind] ??= []).push(run);
    open.delete(kind);
  };

  return {
    add(day: DayFile) {
      seenDays.add(day.tradingDate);
      const expected = expectedTimes(day.tradingDate);
      const have = new Set(day.intervals.map((i) => i.t));
      const missing = expected.filter((t) => !have.has(t));
      const expectedSet = new Set(expected);
      const unexpected = day.intervals.map((i) => i.t).filter((t) => !expectedSet.has(t));
      if (missing.length > 0 || unexpected.length > 0) {
        incompleteDays.push({ date: day.tradingDate, intervals: day.intervals.length, missing: toRuns(missing), unexpected });
      }

      for (const interval of day.intervals) {
        const ms = Date.parse(interval.t);
        const active = activeKinds(interval);
        for (const kind of [...open.keys()]) {
          if (!active.has(kind) || open.get(kind)!.lastMs + INTERVAL_MS !== ms) close(kind);
        }
        for (const [kind, regions] of active) {
          const run = open.get(kind);
          if (run) {
            run.last = interval.t;
            run.lastMs = ms;
            run.intervals++;
            regions.forEach((r) => run.regionSet.add(r));
          } else {
            open.set(kind, { first: interval.t, last: interval.t, intervals: 1, lastMs: ms, regionSet: new Set(regions) });
          }
        }

        for (const id of Object.keys(interval.interconnectors)) {
          const link = links.get(id);
          if (link) {
            link.last = interval.t;
            link.intervals++;
          } else {
            links.set(id, { first: interval.t, last: interval.t, intervals: 1 });
          }
        }
      }
    },

    finish(): OddityReport {
      for (const kind of [...open.keys()]) close(kind);
      const days: string[] = [];
      for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86_400_000) {
        days.push(new Date(ms).toISOString().slice(0, 10));
      }
      const interconnectors: OddityReport["interconnectors"] = {};
      for (const [id, link] of [...links].sort(([a], [b]) => a.localeCompare(b))) {
        const span = (Date.parse(link.last) - Date.parse(link.first)) / INTERVAL_MS + 1;
        interconnectors[id] = { ...link, missingInSpan: span - link.intervals };
      }
      return {
        from,
        to,
        missingDays: days.filter((d) => !seenDays.has(d)),
        incompleteDays,
        runs,
        interconnectors,
      };
    },
  };
}
