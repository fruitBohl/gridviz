"use client";

import { useEffect, useMemo, useState } from "react";
import { metricValues, UNITS, type Metric } from "@/ingest/src/aggregate";
import type { DispatchInterval } from "@/ingest/src/dispatchis";
import { last24Hours, tradingDate, type DayFile, type Latest } from "@/ingest/src/output";
import { addDays, toMarketLabel } from "@/ingest/src/time";
import { formatValue } from "@/lib/format";
import { fetchDay } from "@/lib/load";
import { baseLayout, CHROME, hoverValue, seriesColor, seriesName, type ColorMode } from "@/lib/nem";
import { Banner } from "./Banner";
import { MeasurePicker } from "./MeasurePicker";
import { useColorMode } from "./useColorMode";
import { usePlotly, type Figure } from "./usePlotly";

const valueOf = (i: DispatchInterval, metric: Metric, id: string) => metricValues(i, metric).find(([k]) => k === id)?.[1] ?? null;

function buildFigure(intervals: DispatchInterval[], metric: Metric, id: string, mode: ColorMode): Figure {
  const chrome = CHROME[mode];
  const name = seriesName(id);
  return {
    traces: [
      {
        type: "scatter",
        mode: "lines",
        name,
        showlegend: false,
        x: intervals.map((i) => toMarketLabel(Date.parse(i.t))),
        y: intervals.map((i) => valueOf(i, metric, id)),
        line: { color: seriesColor(id, mode), width: 2 },
        hovertemplate: `${name}: ${hoverValue(metric)}<extra></extra>`,
      },
    ],
    layout: {
      ...baseLayout(mode),
      height: 360,
      // Keeps the user's zoom across refreshes until they pick another series
      uirevision: `${metric}-${id}`,
      margin: { l: 64, r: 16, t: 16, b: 40 },
      xaxis: { type: "date", tickformat: "%H:%M", hoverformat: "Interval ending %a %H:%M", gridcolor: chrome.grid, linecolor: chrome.axis },
      yaxis: { title: { text: UNITS[metric] }, gridcolor: chrome.grid, zerolinecolor: chrome.axis, autorange: true },
    },
  };
}

/** Refetches the day files each time the latest interval moves on, so it stays in step with the tables. */
export function LiveChart({ latest }: { latest: Latest }) {
  const [metric, setMetric] = useState<Metric>("price");
  const [picked, setPicked] = useState<string>();
  const [days, setDays] = useState<(DayFile | undefined)[]>();
  const [error, setError] = useState<string>();
  const mode = useColorMode();

  useEffect(() => {
    let cancelled = false;
    const today = tradingDate(latest.settlementDate);
    Promise.all([fetchDay(addDays(today, -1), today), fetchDay(today, today)]).then(
      (loaded) => {
        if (cancelled) return;
        setDays(loaded);
        setError(undefined);
      },
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [latest.settlementDate]);

  // latest is a new object on every poll, so key on the interval it holds
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const intervals = useMemo(() => (days ? last24Hours(days, latest) : undefined), [days, latest.settlementDate]);
  const ids = intervals ? metricValues(intervals[intervals.length - 1], metric).map(([id]) => id).sort() : [];
  const id = picked && ids.includes(picked) ? picked : ids[0];
  const figure = useMemo(() => (intervals && id ? buildFigure(intervals, metric, id, mode) : undefined), [intervals, metric, id, mode]);
  const { ref: plot, error: drawError } = usePlotly(figure);

  const values = intervals && id ? intervals.map((i) => valueOf(i, metric, id)).filter((v): v is number => v !== null) : [];

  return (
    <section className="flex flex-col gap-4" aria-label="Last 24 hours">
      <h2 className="text-2xl font-semibold tracking-tight">Last 24 hours</h2>
      <MeasurePicker metric={metric} onMetric={setMetric} ids={ids} id={id} onId={setPicked} />
      {!days && !error && <p className="text-sm text-zinc-500">Loading the last 24 hours…</p>}
      {error && <Banner>Couldn&apos;t load the last 24 hours: {error}</Banner>}
      {drawError && <Banner>Couldn&apos;t draw the chart: {drawError}</Banner>}
      <div ref={plot} className={intervals ? "w-full" : "hidden"} />
      {values.length > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {seriesName(id!)} over the last 24 hours: low {formatValue(metric, Math.min(...values))}, high{" "}
          {formatValue(metric, Math.max(...values))}, mean {formatValue(metric, values.reduce((a, b) => a + b, 0) / values.length)}.
        </p>
      )}
    </section>
  );
}
