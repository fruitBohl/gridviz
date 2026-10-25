"use client";

import { useEffect, useState } from "react";
import type { Latest } from "@/ingest/src/output";
import { dateTime, formatMw, formatPrice } from "@/lib/format";
import { INTERCONNECTORS, REGIONS } from "@/lib/nem";
import { Banner } from "./Banner";
import { LiveChart } from "./LiveChart";
import { Table } from "./Table";

const REFRESH_MS = 60_000;
const STALE_AFTER_MS = 15 * 60_000;

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
            5-minute interval ending {dateTime.format(new Date(data.settlementDate))} AEST
          </p>

          {/* 3:2 fits the widest rows of each table at max-w-4xl */}
          <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section className="flex flex-col gap-3">
              <h2 className="text-2xl font-semibold tracking-tight">Regions</h2>
              <Bordered>
                <Table
                  headers={["Region", "Price ($/MWh)", "Demand", "Net interchange"]}
                  rows={Object.entries(data.regions)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([id, r]) => [
                      REGIONS[id]?.name ?? id,
                      formatPrice(r.price),
                      formatMw(r.demand),
                      `${r.netInterchange > 0 ? "Exporting" : "Importing"} ${formatMw(Math.abs(r.netInterchange))}`,
                    ])}
                />
              </Bordered>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-2xl font-semibold tracking-tight">Interconnectors</h2>
              <Bordered>
                <Table
                  headers={["Interconnector", "Direction", "Flow"]}
                  rows={Object.entries(data.interconnectors)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([id, ic]) => {
                      const known = INTERCONNECTORS[id];
                      const [from, to] = known ? [known.from, known.to] : id.split("-");
                      const forward = ic.mwFlow >= 0;
                      return [
                        known?.name ?? id,
                        forward ? `${from} → ${to}` : `${to} → ${from}`,
                        formatMw(Math.abs(ic.mwFlow)),
                      ];
                    })}
                />
              </Bordered>
            </section>
          </div>

          <LiveChart latest={data} />
        </>
      )}
    </div>
  );
}

function Bordered({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 [&_tbody]:text-xs [&_tbody]:whitespace-nowrap">
      {children}
    </div>
  );
}
