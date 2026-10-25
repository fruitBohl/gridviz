"use client";

import { useMemo, useState } from "react";
import type { Annotation, Data, Layout, PlotlyHTMLElement, Shape } from "plotly.js-dist-min";
import { appendTail, plotKey, type Metric, type PlotEvent, type PlotFile } from "@/ingest/src/aggregate";
import { toMarketLabel } from "@/ingest/src/time";
import { day, formatValue, labelMs, time } from "@/lib/format";
import { baseLayout, CHARTS, CHROME, EVENTS, hoverValue, seriesColor, seriesName, SUSPENSION_PRICING, type ColorMode } from "@/lib/nem";
import { Banner } from "./Banner";
import { Disclosure } from "./Disclosure";
import { MeasurePicker } from "./MeasurePicker";
import { Table } from "./Table";
import { useColorMode } from "./useColorMode";
import { useJson } from "./useJson";
import { usePlotly, type Figure } from "./usePlotly";

function formatRange(e: PlotEvent): string {
  const start = new Date(labelMs(e.start));
  const end = new Date(labelMs(e.end));
  const sameDay = day.format(start) === day.format(new Date(labelMs(e.end) - 1));
  return sameDay
    ? `${day.format(start)}, ${time.format(start)}–${time.format(end)}`
    : `${day.format(start)} ${time.format(start)} – ${day.format(end)} ${time.format(end)}`;
}

const PRICE_KINDS = new Set(["priceLimit", "administeredPrice", "manualPrice", "lossFactorScaling"]);

/** Market-wide events have no regions; the rest only apply to the regions they list. */
const appliesTo = (e: PlotEvent, id: string) => !e.regions || e.regions.includes(id);

function buildFigure(data: PlotFile, id: string, mode: ColorMode): Figure {
  const chrome = CHROME[mode];
  const n = data.t.length;
  const partial = Boolean(data.partialLast) && n >= 2;
  const valueFormat = hoverValue(data.metric);

  const color = seriesColor(id, mode);
  const name = seriesName(id);
  const y = data.series[id];
  const traces: Data[] = [
    {
      type: "scatter",
      mode: "lines",
      name,
      showlegend: false,
      x: partial ? data.t.slice(0, n - 1) : data.t,
      y: partial ? y.slice(0, n - 1) : y,
      line: { color, width: 2 },
      hovertemplate: `${name}: ${valueFormat}<extra></extra>`,
    },
  ];
  // The last point is still filling in, so it hangs off a dotted segment
  if (partial) {
    traces.push({
      type: "scatter",
      mode: "lines",
      name,
      showlegend: false,
      x: data.t.slice(n - 2),
      y: y.slice(n - 2),
      line: { color, width: 2, dash: "dot" },
      hoverinfo: ["skip", "all"],
      hovertemplate: `${name}: ${valueFormat} (partial)<extra></extra>`,
    });
  }

  const shapes: Partial<Shape>[] = data.events.filter((e) => appliesTo(e, id)).map((e) => ({
    type: "rect",
    xref: "x",
    yref: "paper",
    x0: e.start,
    x1: e.end,
    y0: 0,
    y1: 1,
    fillcolor: EVENTS[e.kind].color,
    opacity: 0.25,
    line: { width: 0 },
    layer: "below",
  }));

  const annotations: Partial<Annotation>[] = [];
  const dataStart = labelMs(data.t[0]);
  const dataEnd = Math.max(...Object.values(data.lastSeen).map(labelMs));
  const marks: [string, string][] = [];
  if (labelMs(data.firstSeen[id]) > dataStart) marks.push([data.firstSeen[id], "starts"]);
  if (dataEnd - labelMs(data.lastSeen[id]) > 24 * 60 * 60 * 1000) marks.push([data.lastSeen[id], "stops"]);
  for (const [at, what] of marks) {
    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: at,
      x1: at,
      y0: 0,
      y1: 1,
      line: { color, width: 1.5, dash: "dot" },
    });
    annotations.push({
      x: at,
      xref: "x",
      y: 1,
      yref: "paper",
      yanchor: "top",
      xanchor: "right",
      text: `${name} ${what} ${day.format(new Date(labelMs(at)))}`,
      showarrow: false,
      font: { color: chrome.text, size: 11 },
    });
  }

  const layout: Partial<Layout> = {
    ...baseLayout(mode),
    height: 420,
    margin: { l: 64, r: 16, t: 40, b: 16 },
    xaxis: {
      type: "date",
      gridcolor: chrome.grid,
      linecolor: chrome.axis,
      hoverformat: "%a %d %b %Y",
      rangeslider: { visible: true, thickness: 0.08, bgcolor: "rgba(0,0,0,0)", bordercolor: chrome.axis },
    },
    yaxis: {
      title: { text: data.unit },
      gridcolor: chrome.grid,
      zerolinecolor: chrome.axis,
      autorange: true,
    },
    shapes,
    annotations,
  };
  return { traces, layout };
}

export function DailyMeans({ tails }: { tails?: Partial<Record<Metric, PlotFile>> }) {
  const [metric, setMetric] = useState<Metric>("price");
  const [picked, setPicked] = useState<string>();
  const { data: file, error: failed, loading } = useJson<PlotFile>(`/${plotKey(metric)}`);
  const mode = useColorMode();
  const tail = file && tails?.[file.metric];
  const data = useMemo(() => (file && tail ? appendTail(file, tail) : file), [file, tail]);
  const ids = data ? Object.keys(data.series) : [];
  const id = picked && ids.includes(picked) ? picked : ids[0];
  const figure = useMemo(() => (data && id ? buildFigure(data, id, mode) : undefined), [data, id, mode]);
  const { ref: plot, error: drawError } = usePlotly(figure);
  const events = data && id ? data.events.filter((e) => appliesTo(e, id)) : [];
  const title = CHARTS.find((c) => c.metric === (file?.metric ?? metric))!.title;

  const zoomTo = async (e: PlotEvent) => {
    const div = plot.current as PlotlyHTMLElement | null;
    if (!div) return;
    const Plotly = (await import("plotly.js-dist-min")).default;
    const pad = 10 * 86_400_000;
    // Dotted keys change one attribute; a nested { xaxis } object would replace the whole axis
    await Plotly.relayout(div, {
      "xaxis.range": [toMarketLabel(labelMs(e.start) - pad), toMarketLabel(labelMs(e.end) + pad)],
      "yaxis.autorange": true,
    } as Partial<Layout>);
    div.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section className="flex flex-col gap-4" aria-label="Daily means">
      <h2 className="text-2xl font-semibold tracking-tight">Daily means</h2>
      <MeasurePicker metric={metric} onMetric={setMetric} ids={ids} id={id} onId={setPicked} />
      {!file && !failed && <p className="text-sm text-zinc-500">Loading {title.toLowerCase()}…</p>}
      {failed && <Banner>Couldn&apos;t load the chart: {failed}</Banner>}
      {drawError && <Banner>Couldn&apos;t draw the chart: {drawError}</Banner>}
      <div className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-50" : ""} ${failed ? "hidden" : ""}`} aria-busy={loading}>
        {id && (
          <h3 className="text-lg font-medium">
            {seriesName(id)}: {title.toLowerCase()}
          </h3>
        )}
        <div ref={plot} className={file ? "w-full" : "hidden"} />
        {data && (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {data.partialLast && "The dotted last point is today, still filling up. "}
              Drag across the chart or the slider under it to zoom in; double-click to zoom back out.
            </p>
            <EventKey events={events} />
            <EventList events={events} onZoom={zoomTo} />
            <TableView data={data} />
          </>
        )}
      </div>
    </section>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-3 shrink-0 rounded-sm" style={{ backgroundColor: color, opacity: 0.6 }} />;
}

function EventKey({ events }: { events: PlotEvent[] }) {
  const kinds = new Set(events.map((e) => (PRICE_KINDS.has(e.kind) ? "price" : e.kind)));
  if (kinds.size === 0) return null;
  const items: [string, string][] = [];
  if (kinds.has("intervention")) items.push([EVENTS.intervention.color, EVENTS.intervention.label]);
  if (kinds.has("suspended")) items.push([EVENTS.suspended.color, EVENTS.suspended.label]);
  if (kinds.has("price")) items.push([EVENTS.priceLimit.color, "Price capped, floored or adjusted"]);
  if (kinds.has("missingData")) items.push([EVENTS.missingData.color, EVENTS.missingData.label]);
  return (
    <div className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
      <p>Shaded bands mark periods that weren&apos;t normal market operation. Most last minutes, so zoom in to see them.</p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Shaded bands">
        {items.map(([color, label]) => (
          <li key={label} className="flex items-center gap-2">
            <Swatch color={color} />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventList({ events, onZoom }: { events: PlotEvent[]; onZoom: (e: PlotEvent) => void }) {
  if (events.length === 0) return null;
  return (
    <Disclosure summary={`${events.length} flagged ${events.length === 1 ? "period" : "periods"} on this chart`}>
      <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {events.map((e) => (
          <li key={`${e.kind}-${e.start}`} className="flex items-start gap-3 px-4 py-2">
            <span className="mt-1">
              <Swatch color={EVENTS[e.kind].color} />
            </span>
            <div className="flex flex-1 flex-col gap-0.5">
              <p>
                <span className="font-medium">{EVENTS[e.kind].label}</span>
                {e.regions && ` in ${e.regions.map(seriesName).join(", ")}`} · {formatRange(e)} (AEST)
              </p>
              <p className="text-zinc-600 dark:text-zinc-400">
                {EVENTS[e.kind].description}
                {e.regime && ` ${SUSPENSION_PRICING[e.regime]}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onZoom(e)}
              className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:text-foreground dark:border-zinc-700 dark:text-zinc-400"
            >
              Zoom
            </button>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}

function TableView({ data }: { data: PlotFile }) {
  const rows = Object.entries(data.series).map(([id, values]) => {
    const known = values.filter((v): v is number => v !== null);
    const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
    const min = known.length ? Math.min(...known) : null;
    const max = known.length ? Math.max(...known) : null;
    return [
      seriesName(id),
      ...[values.at(-1) ?? null, mean, min, max].map((v) => formatValue(data.metric, v)),
      day.format(new Date(labelMs(data.firstSeen[id]))),
    ];
  });
  return (
    <Disclosure summary="Table">
      <Table
        headers={["Series", `Latest daily mean${data.partialLast ? " (partial)" : ""}`, "Mean of daily means", "Lowest", "Highest", "Data from"]}
        rows={rows}
      />
    </Disclosure>
  );
}
