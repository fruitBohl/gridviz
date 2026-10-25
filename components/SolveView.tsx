"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout } from "plotly.js-dist-min";
import type { DayFile } from "@/ingest/src/output";
import { tradingDate } from "@/ingest/src/output";
import { HISTORY_START } from "@/ingest/src/rebuild";
import { addDays, toMarketLabel } from "@/ingest/src/time";
import { SOLVE_API, type Offer, type SolveResult } from "@/lib/battery";
import { formatPrice, weekdayDate } from "@/lib/format";
import { fetchDay } from "@/lib/load";
import { baseLayout, CHROME, REGION_IDS, REGIONS, seriesColor, type ColorMode } from "@/lib/nem";
import { Banner } from "./Banner";
import { RadioGroup } from "./RadioGroup";
import { Table } from "./Table";
import { useColorMode } from "./useColorMode";
import { usePlotly, type Figure } from "./usePlotly";

type Region = (typeof REGION_IDS)[number];

const INTERVALS = 288;

type DayState = { date: string } & ({ status: "ok"; day: DayFile } | { status: "missing" } | { status: "error"; message: string });

type SolveState =
  | { status: "idle" }
  | { status: "solving"; key: string }
  | { status: "ok"; key: string; result: SolveResult }
  | { status: "error"; key: string; message: string };

/** Interval end labels (+10:00) as the "YYYY-MM-DD HH:MM" market time Plotly reads. */
const toLabels = (t: string[]) => t.map((iso) => toMarketLabel(Date.parse(iso)));

function prices(day: DayFile, region: Region): number[] | undefined {
  if (day.intervals.length !== INTERVALS || day.intervals.some((i) => !i.regions[region])) return undefined;
  return day.intervals.map((i) => i.regions[region].price);
}

function axis(mode: ColorMode, title: string): Partial<Layout["yaxis"]> {
  return { title: { text: title }, gridcolor: CHROME[mode].grid, linecolor: CHROME[mode].axis, zerolinecolor: CHROME[mode].axis };
}

function priceFigure(t: string[], y: number[], region: Region, mode: ColorMode): Figure {
  return {
    traces: [
      {
        type: "scatter",
        mode: "lines",
        x: toLabels(t),
        y,
        line: { color: seriesColor(region, mode), width: 2, shape: "hv" },
        hovertemplate: "$%{y:,.2f}/MWh<extra></extra>",
      },
    ],
    layout: {
      ...baseLayout(mode),
      height: 300,
      margin: { l: 64, r: 16, t: 16, b: 40 },
      showlegend: false,
      xaxis: { type: "date", gridcolor: CHROME[mode].grid, linecolor: CHROME[mode].axis, hoverformat: "%H:%M" },
      yaxis: axis(mode, "$/MWh"),
    },
  };
}

function scheduleFigure(r: SolveResult, mode: ColorMode): Figure {
  const x = toLabels(r.t);
  return {
    traces: [
      {
        type: "bar",
        name: "Net power (discharge − charge)",
        x,
        y: r.dischargeMw.map((d, i) => d - r.chargeMw[i]),
        marker: { color: seriesColor(r.region, mode) },
        hovertemplate: "%{y:,.1f} MW<extra>Net power</extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        name: "State of charge",
        x,
        y: r.socMwh,
        yaxis: "y2",
        line: { color: CHROME[mode].text, width: 2, dash: "dot" },
        hovertemplate: "%{y:,.1f} MWh<extra>State of charge</extra>",
      },
    ],
    layout: {
      ...baseLayout(mode),
      height: 340,
      margin: { l: 64, r: 64, t: 16, b: 40 },
      bargap: 0,
      legend: { orientation: "h", y: -0.2 },
      xaxis: { type: "date", gridcolor: CHROME[mode].grid, linecolor: CHROME[mode].axis, hoverformat: "%H:%M" },
      yaxis: { ...axis(mode, "MW"), range: [-r.battery.powerMw * 1.05, r.battery.powerMw * 1.05] },
      yaxis2: { ...axis(mode, "MWh"), overlaying: "y", side: "right", range: [0, r.battery.energyMwh * 1.05], showgrid: false },
    },
  };
}

function Chart({ figure, label }: { figure: Figure; label: string }) {
  const { ref, error } = usePlotly(figure);
  if (error) return <Banner>Couldn&apos;t draw the chart: {error}</Banner>;
  return <div ref={ref} role="img" aria-label={label} />;
}

async function requestSolve(region: Region, date: string): Promise<SolveResult> {
  const res = await fetch(`${SOLVE_API}?${new URLSearchParams({ region, date })}`);
  const body = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(body?.error ?? `the solver returned ${res.status}`);
  return body as SolveResult;
}

const mw = (v: number) => (v === 0 ? "–" : v.toFixed(1));

function BidTable({ gen, load, interval }: { gen: Offer; load: Offer; interval: number }) {
  const rows = gen.prices.map((_, b) => [
    `Band ${b + 1}`,
    formatPrice(gen.prices[b]),
    mw(gen.bands[interval][b]),
    formatPrice(load.prices[b]),
    mw(load.bands[interval][b]),
  ]);
  rows.push(["MaxAvail", "", mw(gen.maxAvail[interval]), "", mw(load.maxAvail[interval])]);
  return <Table headers={["", "GEN price", "GEN MW", "LOAD price", "LOAD MW"]} rows={rows} />;
}

function Results({ result, mode }: { result: SolveResult; mode: ColorMode }) {
  const [interval, setInterval] = useState(() => Math.max(0, result.dischargeMw.findIndex((d) => d > 0)));
  const figure = useMemo(() => scheduleFigure(result, mode), [result, mode]);
  const gap = result.relaxedRevenue - result.revenue;
  const at = toLabels([result.t[interval]])[0];

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-2xl font-semibold tracking-tight">Result</h2>
      <Table
        headers={["", "Value"]}
        rows={[
          ["Revenue (MIP)", formatPrice(result.revenue)],
          ["Revenue with u relaxed to [0, 1]", formatPrice(result.relaxedRevenue)],
          ["Extra revenue from relaxing u", formatPrice(gap)],
          ["Intervals charging and discharging at once (relaxed)", String(result.simultaneousIntervals)],
          ["Solve time (MIP + relaxed)", `${result.solveSeconds.toFixed(2)} s`],
        ]}
      />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {result.simultaneousIntervals > 0
          ? "Without the binary, the battery charges and discharges at once in some intervals, burning energy through its losses while prices are negative. That is the extra revenue above, and why the model needs u to be 0 or 1."
          : "Relaxing u makes no difference today: with no reason to burn energy, the battery never wants to charge and discharge at once."}
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-medium">Schedule</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Bars are net power: up is discharging (selling), down is charging (buying). The dotted line is the energy stored.
        </p>
        <Chart figure={figure} label={`Battery schedule for ${result.region} on ${result.tradingDate}`} />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-medium">Bid</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The schedule as an AEMO offer: 10 price bands per side, fixed for the day, with MW per band and MaxAvail each
          interval. Planned discharge sits in the lowest GEN band (sell at any price) and planned charge in the highest
          LOAD band (pay any price). The rest of the 100 MW sits at the other end, switched off by MaxAvail.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span>
            Interval ending <span className="tabular-nums">{at.slice(11)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={result.t.length - 1}
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
            aria-valuetext={`Interval ending ${at.slice(11)}`}
          />
        </label>
        <BidTable gen={result.bid.gen} load={result.bid.load} interval={interval} />
      </div>
    </section>
  );
}

export function SolveView() {
  const mode = useColorMode();
  const [today] = useState(() => tradingDate(new Date().toISOString()));
  const yesterday = addDays(today, -1);
  const [region, setRegion] = useState<Region>("SA1");
  const [date, setDate] = useState(yesterday);
  const [loaded, setLoaded] = useState<DayState>();
  const [solve, setSolve] = useState<SolveState>({ status: "idle" });
  const key = `${region}|${date}`;

  useEffect(() => {
    let cancelled = false;
    fetchDay(date, today).then(
      (d) => !cancelled && setLoaded(d ? { date, status: "ok", day: d } : { date, status: "missing" }),
      (err: Error) => !cancelled && setLoaded({ date, status: "error", message: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [date, today]);

  // Until the chosen date's file arrives, the previous one is stale
  const day = loaded?.date === date ? loaded : { status: "loading" as const };
  const dayPrices = day.status === "ok" ? prices(day.day, region) : undefined;
  const figure = useMemo(() => {
    if (loaded?.date !== date || loaded.status !== "ok") return undefined;
    const y = prices(loaded.day, region);
    return y && priceFigure(loaded.day.intervals.map((i) => i.t), y, region, mode);
  }, [loaded, date, region, mode]);

  async function onSolve() {
    setSolve({ status: "solving", key });
    try {
      setSolve({ status: "ok", key, result: await requestSolve(region, date) });
    } catch (err) {
      setSolve({ status: "error", key, message: (err as Error).message });
    }
  }

  // A result only shows for the region and day it was solved for
  const current = solve.status !== "idle" && solve.key === key ? solve : undefined;
  const solving = solve.status === "solving";
  const status =
    current?.status === "solving" ? "Solving…" : current?.status === "error" ? `Couldn't solve: ${current.message}` : "";

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Data</h2>
        <div className="flex flex-wrap items-end gap-4">
          <RadioGroup
            label="Region"
            options={REGION_IDS.map((id) => ({ value: id, label: REGIONS[id].short, title: REGIONS[id].name }))}
            value={region}
            onChange={setRegion}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Trading day</span>
            <input
              type="date"
              min={HISTORY_START}
              max={yesterday}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
            />
          </label>
          <button
            type="button"
            onClick={onSolve}
            disabled={!dayPrices || solving}
            className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
          >
            {solving ? "Solving…" : "Solve"}
          </button>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {REGIONS[region].name}, {weekdayDate.format(new Date(`${date}T12:00:00+10:00`))}: 288 five-minute spot prices,
          the only data the model needs besides the battery&apos;s limits. Times are market time (AEST).
        </p>
        {day.status === "loading" && <p className="text-sm text-zinc-500">Loading prices…</p>}
        {day.status === "missing" && <Banner>There&apos;s no data for {date}.</Banner>}
        {day.status === "error" && <Banner>Couldn&apos;t load prices: {day.message}</Banner>}
        {day.status === "ok" && !dayPrices && (
          <Banner>{date} is incomplete for {REGIONS[region].short}, so it can&apos;t be solved.</Banner>
        )}
        {figure && <Chart figure={figure} label={`Spot price for ${REGIONS[region].short} on ${date}`} />}
        <p aria-live="polite" className="text-sm">
          {status}
        </p>
      </section>

      {current?.status === "ok" && <Results key={key} result={current.result} mode={mode} />}
    </div>
  );
}
