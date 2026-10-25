import type { EventKind, EventRun } from "./events";
import { createEventTracker } from "./events";
import type { DayFile } from "./output";
import { datesBetween, INTERVAL_MS, toMarketIso } from "./time";

export const INTERVALS_PER_DAY = 288;

/** Interval end times for a trading day: 00:05 on the day through 00:00 the next day. */
export function expectedTimes(date: string): string[] {
  const start = Date.parse(`${date}T00:05:00+10:00`);
  return Array.from({ length: INTERVALS_PER_DAY }, (_, i) => toMarketIso(start + i * INTERVAL_MS));
}

export type OddityRun = Omit<EventRun, "kind">;

export type OddityReport = {
  from: string;
  to: string;
  missingDays: string[];
  incompleteDays: { date: string; intervals: number; missing: OddityRun[]; unexpected: string[] }[];
  runs: Partial<Record<EventKind, OddityRun[]>>;
  interconnectors: Record<string, { first: string; last: string; intervals: number; missingInSpan: number }>;
};

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
  const events = createEventTracker();
  const links = new Map<string, { first: string; last: string; intervals: number }>();

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
        events.add(interval);

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
      const runs: OddityReport["runs"] = {};
      for (const { kind, ...run } of events.finish()) (runs[kind] ??= []).push(run);
      const interconnectors: OddityReport["interconnectors"] = {};
      for (const [id, link] of [...links].sort(([a], [b]) => a.localeCompare(b))) {
        const span = (Date.parse(link.last) - Date.parse(link.first)) / INTERVAL_MS + 1;
        interconnectors[id] = { ...link, missingInSpan: span - link.intervals };
      }
      return {
        from,
        to,
        missingDays: datesBetween(from, to).filter((d) => !seenDays.has(d)),
        incompleteDays,
        runs,
        interconnectors,
      };
    },
  };
}
