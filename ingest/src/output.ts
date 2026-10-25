import type { DispatchInterval } from "./dispatchis";
import { addDays, AEST_MS, DAY_MS, INTERVAL_MS } from "./time";

export type Latest = Omit<DispatchInterval, "t"> & {
  settlementDate: string;
  generatedAt: string;
};

export type DayFile = {
  tradingDate: string;
  intervals: DispatchInterval[];
};

export const LATEST_KEY = "data/latest.json";
export const dayKey = (tradingDate: string) => `data/days/${tradingDate}.json`;

/** Intervals are labelled by their end time, so the one ending 00:00 belongs to the previous trading day. */
export function tradingDate(t: string): string {
  return new Date(Date.parse(t) - INTERVAL_MS + AEST_MS).toISOString().slice(0, 10);
}

/** The last complete trading day. */
export const yesterday = (now: Date) => addDays(tradingDate(now.toISOString()), -1);

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

/**
 * The 24 hours up to the latest interval. latest.json is added too, as CloudFront can still be
 * serving a day file from before it.
 */
export function last24Hours(days: (DayFile | undefined)[], latest: Latest): DispatchInterval[] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped, not part of an interval
  const { settlementDate: t, generatedAt, ...rest } = latest;
  const endMs = Date.parse(t);
  const intervals = [...days.flatMap((d) => d?.intervals ?? []), { t, ...rest }];
  const inWindow = intervals.filter((i) => Date.parse(i.t) > endMs - DAY_MS && Date.parse(i.t) <= endMs);
  return mergeIntervals(undefined, tradingDate(t), inWindow).intervals;
}
