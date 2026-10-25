/** Market time is AEST all year: UTC+10, no daylight saving. */
export const AEST_MS = 10 * 60 * 60 * 1000;
export const INTERVAL_MS = 5 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const toMarketIso = (ms: number) => `${new Date(ms + AEST_MS).toISOString().slice(0, 19)}+10:00`;

/** "2025-01-31 14:05": no offset, so charts show it as wall-clock market time. */
export const toMarketLabel = (ms: number) => new Date(ms + AEST_MS).toISOString().slice(0, 16).replace("T", " ");

export const startOfDayMs = (date: string) => Date.parse(`${date}T00:00:00+10:00`);

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return dates;
}
