"use client";

import { useMemo, useState } from "react";
import type { Metric } from "@/ingest/src/aggregate";
import { extremesKey, RANKINGS, TOP_N, type Direction, type ExtremesFile, type Ranking } from "@/ingest/src/extremes";
import { INTERVALS_PER_DAY } from "@/ingest/src/oddities";
import { INTERVAL_MS, startOfDayMs, toMarketLabel } from "@/ingest/src/time";
import { formatValue, labelMs, weekdayDate } from "@/lib/format";
import { baseLayout, CHROME, hoverValue, INTERCONNECTORS, RANK_RAMP, type ColorMode } from "@/lib/nem";
import { Banner } from "./Banner";
import { Disclosure } from "./Disclosure";
import { MeasurePicker } from "./MeasurePicker";
import { RadioGroup } from "./RadioGroup";
import { Table } from "./Table";
import { useColorMode } from "./useColorMode";
import { useJson } from "./useJson";
import { usePlotly, type Figure } from "./usePlotly";

/** Interval end times on a placeholder date, so every day shares one time-of-day axis. */
const TIMES = Array.from({ length: INTERVALS_PER_DAY }, (_, i) =>
  toMarketLabel(startOfDayMs("2000-01-01") + (i + 1) * INTERVAL_MS),
);

const RANKING_LABELS: Record<Ranking, string> = { mean: "Daily mean", peak: "5-minute peak" };

function directionHint(metric: Metric, id: string, direction: Direction): string | undefined {
  if (metric === "netInterchange") return direction === "highest" ? "most exporting" : "most importing";
  const ic = INTERCONNECTORS[id];
  if (metric !== "interconnectorFlow" || !ic) return undefined;
  return direction === "highest" ? `most toward ${ic.from}→${ic.to}` : `most toward ${ic.to}→${ic.from}`;
}

function valueLabel(direction: Direction, ranking: Ranking): string {
  if (ranking === "mean") return "Daily mean";
  return direction === "highest" ? "Highest 5-minute value" : "Lowest 5-minute value";
}

const dateLabel = (date: string) => weekdayDate.format(new Date(labelMs(date)));

function buildFigure(file: ExtremesFile, id: string, direction: Direction, ranking: Ranking, mode: ColorMode): Figure {
  const chrome = CHROME[mode];
  const valueFormat = hoverValue(file.metric);
  const traces = file.ranks[id][direction][ranking]
    .map((d, i) => ({
      type: "scatter" as const,
      mode: "lines" as const,
      name: `${i + 1}. ${dateLabel(d.date)}`,
      x: TIMES,
      y: file.profiles[id][d.date],
      line: { color: RANK_RAMP[mode][i], width: 2 },
      hovertemplate: `${dateLabel(d.date)}: ${valueFormat}<extra></extra>`,
    }))
    .reverse();

  return {
    traces,
    layout: {
      ...baseLayout(mode),
      height: 380,
      margin: { l: 64, r: 16, t: 16, b: 40 },
      legend: { orientation: "h", x: 0, y: -0.15, yanchor: "top", traceorder: "reversed", font: { color: chrome.text } },
      xaxis: {
        type: "date",
        tickformat: "%H:%M",
        hoverformat: "Interval ending %H:%M",
        dtick: 3 * 60 * 60 * 1000,
        gridcolor: chrome.grid,
        linecolor: chrome.axis,
      },
      yaxis: { title: { text: file.unit }, gridcolor: chrome.grid, zerolinecolor: chrome.axis, autorange: true },
    },
  };
}

function ProfileChart({
  file,
  id,
  direction,
  ranking,
}: {
  file: ExtremesFile;
  id: string;
  direction: Direction;
  ranking: Ranking;
}) {
  const mode = useColorMode();
  const figure = useMemo(() => buildFigure(file, id, direction, ranking, mode), [file, id, direction, ranking, mode]);
  const { ref, error } = usePlotly(figure);
  const hint = directionHint(file.metric, id, direction);
  const days = file.ranks[id][direction][ranking];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-lg font-medium">
        {direction === "highest" ? "Highest" : "Lowest"} {TOP_N} days{hint && ` (${hint})`}
      </h3>
      {error && <Banner>Couldn&apos;t draw the chart: {error}</Banner>}
      <div ref={ref} className="w-full" />
      <Disclosure summary="Table">
        <Table
          headers={["Trading day", valueLabel(direction, ranking)]}
          rows={days.map((d, i) => [`${i + 1}. ${dateLabel(d.date)}`, formatValue(file.metric, d.value)])}
        />
      </Disclosure>
    </div>
  );
}

export function ExtremeDays() {
  const [metric, setMetric] = useState<Metric>("price");
  const [ranking, setRanking] = useState<Ranking>("mean");
  const [picked, setPicked] = useState<string>();
  const { data: file, error: failed, loading } = useJson<ExtremesFile>(`/${extremesKey(metric)}`);
  const ids = file ? Object.keys(file.ranks) : [];
  const id = picked && ids.includes(picked) ? picked : ids[0];

  return (
    <section className="flex flex-col gap-4" aria-label="Extreme days">
      <h2 className="text-2xl font-semibold tracking-tight">Extreme days</h2>
      <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        The {TOP_N} highest and lowest trading days for each region or interconnector, drawn across the day in 5-minute
        intervals. Rank them by the daily mean, or by the single most extreme 5-minute interval of the day. Only
        complete days count, and the ranking is updated nightly
        {file && <>, most recently through {weekdayDate.format(new Date(labelMs(file.throughDate)))}</>}.
      </p>

      <MeasurePicker metric={metric} onMetric={setMetric} ids={ids} id={id} onId={setPicked}>
        <RadioGroup
          label="Rank by"
          options={RANKINGS.map((r) => ({ value: r, label: RANKING_LABELS[r] }))}
          value={ranking}
          onChange={setRanking}
        />
      </MeasurePicker>

      {!file && !failed && <p className="text-sm text-zinc-500">Loading extreme days…</p>}
      {failed && <Banner>Couldn&apos;t load the extreme days: {failed}</Banner>}
      {file && id && !failed && (
        <div className={`grid gap-8 transition-opacity lg:grid-cols-2 ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
          <ProfileChart file={file} id={id} direction="highest" ranking={ranking} />
          <ProfileChart file={file} id={id} direction="lowest" ranking={ranking} />
        </div>
      )}
    </section>
  );
}
