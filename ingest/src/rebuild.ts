import { createAggregator, plotKey } from "./aggregate";
import { dayKey, tradingDate, type DayFile } from "./output";
import type { Store } from "./store";
import { addDays } from "./time";

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

/** Rebuilds every plot file from the day files, from `from` to yesterday in market time. */
export async function rebuild({
  store,
  from = HISTORY_START,
  now = () => new Date(),
  concurrency = 16,
  log = () => {},
}: RebuildOptions): Promise<RebuildResult> {
  const generatedAt = now();
  const throughDate = addDays(tradingDate(generatedAt.toISOString()), -1);
  const dates: string[] = [];
  for (let d = from; d <= throughDate; d = addDays(d, 1)) dates.push(d);

  const aggregators = [createAggregator("hourly", { from }), createAggregator("daily", { from })];
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
    aggregators.forEach((agg) => agg.add(day));
  }
  if (missingDays.length > 0) log("missing day files", { missingDays });

  const written: string[] = [];
  for (const agg of aggregators) {
    for (const file of agg.finish(throughDate, { generatedAt })) {
      const key = plotKey(file.metric, file.resolution);
      await store.putJson(key, file, { cacheControl: PLOT_CACHE_CONTROL });
      written.push(key);
    }
  }

  const result = { throughDate, days: dates.length - missingDays.length, missingDays, written };
  log("rebuilt plots", result);
  return result;
}
