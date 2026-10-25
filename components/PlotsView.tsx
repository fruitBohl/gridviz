"use client";

import { useEffect, useState } from "react";
import { createAggregator, plotKey, type Metric, type PlotFile } from "@/ingest/src/aggregate";
import { tradingDate } from "@/ingest/src/output";
import { addDays, datesBetween } from "@/ingest/src/time";
import { fetchDay, loadJson } from "@/lib/load";
import { Banner } from "./Banner";
import { DailyMeans } from "./DailyMeans";
import { ExtremeDays } from "./ExtremeDays";

const STALE_AFTER_DAYS = 7;

type Tails = Partial<Record<Metric, PlotFile>>;

type TailState =
  | { status: "loading" }
  | { status: "ok"; tails: Tails; throughDate: string; missingDays: number }
  | { status: "error"; message: string };

/**
 * The plot files run to the last daily rebuild. The days after it, today included, come from the
 * same day files the ingest Lambda writes every 5 minutes, aggregated here the same way.
 */
async function loadTails(): Promise<Extract<TailState, { status: "ok" }>> {
  const { throughDate } = await loadJson<PlotFile>(`/${plotKey("price")}`);

  const today = tradingDate(new Date().toISOString());
  const dates = datesBetween(addDays(throughDate, 1), today);
  const days = await Promise.all(dates.map((d) => fetchDay(d, today)));

  const tails: Tails = {};
  const agg = createAggregator({ from: addDays(throughDate, 1) });
  days.forEach((d) => d && agg.add(d));
  for (const file of agg.finish(today, { open: true })) tails[file.metric] = file;
  return { status: "ok", tails, throughDate, missingDays: dates.length - 1 };
}

export function PlotsView() {
  const [tail, setTail] = useState<TailState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadTails().then(
      (state) => !cancelled && setTail(state),
      (err: Error) => !cancelled && setTail({ status: "error", message: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-10">
      {tail.status === "loading" && <p className="text-sm text-zinc-500">Adding today&apos;s data…</p>}

      {tail.status === "error" && (
        <Banner>Couldn&apos;t add the most recent days, so the charts end at the last daily rebuild: {tail.message}</Banner>
      )}
      {tail.status === "ok" && tail.missingDays > STALE_AFTER_DAYS && (
        <Banner>
          The history was last rebuilt for {tail.throughDate}, {tail.missingDays} days ago. The charts still include the
          days since, but the daily rebuild may be failing.
        </Banner>
      )}

      <DailyMeans tails={tail.status === "ok" ? tail.tails : undefined} />

      <ExtremeDays />
    </div>
  );
}
