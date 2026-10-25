import { createAggregator, plotKey } from "./aggregate";
import { createExtremes, extremesKey } from "./extremes";
import { dayKey, yesterday, type DayFile } from "./output";
import type { Store } from "./store";
import { datesBetween } from "./time";

export const HISTORY_START = "2024-10-01";
const PLOT_CACHE_CONTROL = "public, max-age=3600";

export type RebuildOptions = {
  store: Store;
  from?: string;
  now?: () => Date;
  concurrency?: number;
  log?: (message: string, fields?: Record<string, unknown>) => void;
};

export type RebuildResult = { throughDate: string; days: number; missingDays: string[]; written: string[] };

/** Rebuilds every plot and extremes file from the day files, from `from` to yesterday in market time. */
export async function rebuild({
  store,
  from = HISTORY_START,
  now = () => new Date(),
  concurrency = 16,
  log = () => {},
}: RebuildOptions): Promise<RebuildResult> {
  const generatedAt = now();
  const throughDate = yesterday(generatedAt);
  const dates = datesBetween(from, throughDate);

  const aggregator = createAggregator({ from });
  const extremes = createExtremes();
  const pending: Promise<DayFile | undefined>[] = [];
  const missingDays: string[] = [];
  for (let i = 0; i < dates.length; i++) {
    for (let j = pending.length; j < Math.min(i + concurrency, dates.length); j++) {
      pending[j] = store.getJson<DayFile>(dayKey(dates[j]));
    }
    const day = await pending[i];
    delete pending[i];
    if (!day) {
      missingDays.push(dates[i]);
      continue;
    }
    aggregator.add(day);
    extremes.add(day);
  }
  if (missingDays.length > 0) log("missing day files", { missingDays });

  const files = [
    ...aggregator.finish(throughDate, { generatedAt }).map((file) => [plotKey(file.metric), file] as const),
    ...extremes.finish(throughDate, { generatedAt }).map((file) => [extremesKey(file.metric), file] as const),
  ];
  const written: string[] = [];
  for (const [key, file] of files) {
    await store.putJson(key, file, { cacheControl: PLOT_CACHE_CONTROL });
    written.push(key);
  }

  const result = { throughDate, days: dates.length - missingDays.length, missingDays, written };
  log("rebuilt plots", result);
  return result;
}
