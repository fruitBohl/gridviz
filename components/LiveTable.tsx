"use client";

import { useEffect, useState } from "react";
import type { Latest } from "@/ingest/src/output";
import { INTERCONNECTORS, REGIONS } from "@/lib/nem";
import { Banner } from "./Banner";

const REFRESH_MS = 60_000;
const STALE_AFTER_MS = 15 * 60_000;

const price = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const mw = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
/** NEM market time is AEST all year; Brisbane has no daylight saving. */
const aest = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Brisbane",
  dateStyle: "medium",
  timeStyle: "short",
});

type State =
  | { status: "loading" }
  | { status: "ok"; data: Latest }
  | { status: "error"; message: string; data?: Latest };

export function LiveTable() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/data/latest.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`/data/latest.json returned ${res.status}`);
        const data = (await res.json()) as Latest;
        if (!cancelled) setState({ status: "ok", data });
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            status: "error",
            message: (err as Error).message,
            data: prev.status === "loading" ? undefined : prev.data,
          }));
        }
      } finally {
        if (!cancelled) setNow(Date.now());
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (state.status === "loading") {
    return <p className="text-sm text-zinc-500">Loading the latest dispatch interval…</p>;
  }

  const data = state.data;
  const age = data ? now - Date.parse(data.settlementDate) : 0;

  return (
    <div className="flex flex-col gap-8">
      {state.status === "error" && (
        <Banner>Couldn&apos;t refresh the data: {state.message}</Banner>
      )}
      {data && age > STALE_AFTER_MS && (
        <Banner>
          This data is {Math.round(age / 60_000)} minutes old. The ingest may be failing.
        </Banner>
      )}

      {data && (
        <>
          <p className="text-sm text-zinc-500">
            5-minute interval ending {aest.format(new Date(data.settlementDate))} AEST
          </p>

          <section className="flex flex-col gap-3">
            <h2 className="text-2xl font-semibold tracking-tight">Regions</h2>
            <Table
              headers={["Region", "Price ($/MWh)", "Demand (MW)", "Net interchange (MW)"]}
              rows={Object.entries(data.regions)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([id, r]) => [
                  REGIONS[id]?.name ?? id,
                  price.format(r.price),
                  mw.format(r.demand),
                  `${r.netInterchange > 0 ? "Exporting" : "Importing"} ${mw.format(Math.abs(r.netInterchange))}`,
                ])}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-2xl font-semibold tracking-tight">Interconnectors</h2>
            <Table
              headers={["Interconnector", "Flow", "MW"]}
              rows={Object.entries(data.interconnectors)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([id, ic]) => {
                  const known = INTERCONNECTORS[id];
                  const [from, to] = known ? [known.from, known.to] : id.split("-");
                  const forward = ic.mwFlow >= 0;
                  return [
                    known?.name ?? id,
                    forward ? `${from} → ${to}` : `${to} → ${from}`,
                    mw.format(Math.abs(ic.mwFlow)),
                  ];
                })}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
          <tr>
            {headers.map((h, i) => (
              <th key={h} scope="col" className={`px-4 py-2 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((cells) => (
            <tr key={cells[0]}>
              {cells.map((cell, i) => (
                <td key={i} className={`px-4 py-2 ${i > 0 ? "text-right tabular-nums" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
