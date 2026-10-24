import type { DispatchInterval } from "./dispatchis";

// Shapes of the public JSON files under data/ (read by the /live page)
export type Latest = Omit<DispatchInterval, "t"> & {
  settlementDate: string;
  generatedAt: string;
};

export type DayFile = {
  tradingDate: string; // YYYY-MM-DD
  intervals: DispatchInterval[];
};

export const LATEST_KEY = "data/latest.json";
export const dayKey = (tradingDate: string) => `data/days/${tradingDate}.json`;

const AEST_MS = 10 * 60 * 60 * 1000;
const INTERVAL_MS = 5 * 60 * 1000;

// Intervals are labelled by their end time, so the one ending 00:00 belongs to the previous
// trading day (AEMO's convention): shift back 5 minutes, then take the AEST calendar date.
export function tradingDate(t: string): string {
  return new Date(Date.parse(t) - INTERVAL_MS + AEST_MS).toISOString().slice(0, 10);
}

// End of the first interval (00:05 AEST) of the trading day that `t` belongs to
export function startOfTradingDay(t: string): string {
  return `${tradingDate(t)}T00:05:00+10:00`;
}

export function mergeIntervals(
  existing: DayFile | undefined,
  date: string,
  intervals: DispatchInterval[],
): DayFile {
  const byTime = new Map((existing?.intervals ?? []).map((i) => [i.t, i]));
  for (const interval of intervals) byTime.set(interval.t, interval);
  return {
    tradingDate: date,
    intervals: [...byTime.values()].sort((a, b) => a.t.localeCompare(b.t)),
  };
}

export function toLatest(interval: DispatchInterval, now: Date): Latest {
  const { t, ...rest } = interval;
  return { settlementDate: t, generatedAt: now.toISOString(), ...rest };
}
