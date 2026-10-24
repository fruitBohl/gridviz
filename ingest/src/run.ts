import { parseDispatchIsZip, type DispatchInterval } from "./dispatchis";
import type { ReportFile } from "./nemweb";
import {
  dayKey,
  LATEST_KEY,
  mergeIntervals,
  startOfTradingDay,
  toLatest,
  tradingDate,
  type DayFile,
  type Latest,
} from "./output";
import type { Store } from "./store";

export type RunOptions = {
  store: Store;
  fetchListing: () => Promise<ReportFile[]>;
  fetchFile: (file: ReportFile) => Promise<Uint8Array>;
  archiveRaw?: boolean; // keep the original zips under raw/ (off for local runs)
  maxFiles?: number;
  concurrency?: number;
  now?: () => Date;
  log?: (message: string, fields?: Record<string, unknown>) => void;
};

export type RunResult = {
  processed: number;
  settlementDate?: string;
  daysWritten: string[];
};

// raw/dispatchis/2026/10/24/PUBLIC_DISPATCHIS_202610241505_....zip
const rawKey = (file: ReportFile) =>
  `raw/dispatchis/${file.settlementDate.slice(0, 10).replaceAll("-", "/")}/${file.name}`;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Catch up on every listed file newer than data/latest.json, then rewrite the touched day
// files and latest.json. latest.json is written last, so a failed run is redone next time.
export async function run({
  store,
  fetchListing,
  fetchFile,
  archiveRaw = true,
  maxFiles = 300,
  concurrency = 8,
  now = () => new Date(),
  log = () => {},
}: RunOptions): Promise<RunResult> {
  const latest = await store.getJson<Latest>(LATEST_KEY);
  const listing = await fetchListing();
  if (listing.length === 0) throw new Error("NEMWeb listing has no DispatchIS files");

  // First run (or no latest.json): seed from the start of the newest file's trading day
  const newest = listing[listing.length - 1].settlementDate;
  const pending = latest
    ? listing.filter((f) => f.settlementDate > latest.settlementDate)
    : listing.filter((f) => f.settlementDate >= startOfTradingDay(newest));

  const files = pending.slice(-maxFiles);
  if (pending.length > files.length) {
    log("skipping older files beyond maxFiles", { skipped: pending.length - files.length });
  }
  if (files.length === 0) {
    log("up to date", { settlementDate: latest?.settlementDate });
    return { processed: 0, settlementDate: latest?.settlementDate, daysWritten: [] };
  }

  const parsed = await mapLimit(files, concurrency, async (file) => {
    const zip = await fetchFile(file);
    if (archiveRaw) await store.putBytes(rawKey(file), zip, "application/zip");
    return parseDispatchIsZip(zip);
  });
  const intervals = parsed.flat();

  const byDay = new Map<string, DispatchInterval[]>();
  for (const interval of intervals) {
    const date = tradingDate(interval.t);
    byDay.set(date, [...(byDay.get(date) ?? []), interval]);
  }
  for (const [date, dayIntervals] of byDay) {
    const existing = await store.getJson<DayFile>(dayKey(date));
    await store.putJson(dayKey(date), mergeIntervals(existing, date, dayIntervals));
  }

  const last = intervals.reduce((a, b) => (b.t > a.t ? b : a));
  if (!latest || last.t > latest.settlementDate) {
    await store.putJson(LATEST_KEY, toLatest(last, now()));
  }

  const result = {
    processed: files.length,
    settlementDate: last.t > (latest?.settlementDate ?? "") ? last.t : latest?.settlementDate,
    daysWritten: [...byDay.keys()].sort(),
  };
  log("ingested", result);
  return result;
}
