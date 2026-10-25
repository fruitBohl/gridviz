import katex from "katex";
import "katex/dist/katex.min.css";
import { BATTERY } from "@/lib/battery";

// Rendered at build time; must match build_model in engine/src/battery/model.py
const OBJECTIVE = String.raw`\max \sum_{t \in T} p_t \,(d_t - c_t)\,\Delta`;
const CONSTRAINTS = String.raw`\begin{aligned}
s_t &= s_{t-1} + \eta\, c_t \Delta - \frac{d_t \Delta}{\eta} && \forall t \in T,\; s_{-1} = s_0 \\
c_t &\le P\, u_t && \forall t \in T \\
d_t &\le P\,(1 - u_t) && \forall t \in T \\
s_{287} &\ge s_0 \\
0 \le c_t, d_t &\le P,\quad 0 \le s_t \le E,\quad u_t \in \{0, 1\} && \forall t \in T
\end{aligned}`;

const math = (tex: string, displayMode = false) => ({ __html: katex.renderToString(tex, { displayMode }) });

const SYMBOLS: [string, string, string][] = [
  [String.raw`T`, "Intervals of the trading day", "0 … 287 (5-minute)"],
  [String.raw`p_t`, "Spot price (RRP) in interval t", "From AEMO, $/MWh"],
  [String.raw`c_t,\ d_t`, "Charge and discharge power", "MW, chosen by the solver"],
  [String.raw`s_t`, "Energy stored at the end of t (state of charge)", "MWh, chosen by the solver"],
  [String.raw`u_t`, "Mode: 1 allows charging, 0 allows discharging", "Binary, chosen by the solver"],
  [String.raw`P`, "Power limit", `${BATTERY.powerMw} MW`],
  [String.raw`E`, "Energy capacity", `${BATTERY.energyMwh} MWh`],
  [String.raw`\eta`, "One-way efficiency, the square root of round trip", `√${BATTERY.roundTripEfficiency} ≈ ${Math.sqrt(BATTERY.roundTripEfficiency).toFixed(3)}`],
  [String.raw`s_0`, "State of charge at the start, and the minimum at the end", `${BATTERY.startSocMwh} MWh`],
  [String.raw`\Delta`, "Interval length", "5/60 h"],
];

export function Formulation() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">Formulation</h2>
      <p className="text-zinc-600 dark:text-zinc-400">
        A mixed-integer program: maximise revenue from buying and selling at the spot price, given the battery&apos;s
        limits. The binary <span dangerouslySetInnerHTML={math("u_t")} /> stops it charging and discharging at once,
        which it would otherwise do on negative prices to burn energy through its losses.
      </p>
      <div className="overflow-x-auto" dangerouslySetInnerHTML={math(OBJECTIVE, true)} />
      <p className="text-zinc-600 dark:text-zinc-400">subject to</p>
      <div className="overflow-x-auto" dangerouslySetInnerHTML={math(CONSTRAINTS, true)} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Symbol</th>
              <th scope="col" className="px-4 py-2 font-medium">Meaning</th>
              <th scope="col" className="px-4 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {SYMBOLS.map(([tex, meaning, value]) => (
              <tr key={tex}>
                <th scope="row" className="px-4 py-2 font-normal" dangerouslySetInnerHTML={math(tex)} />
                <td className="px-4 py-2">{meaning}</td>
                <td className="px-4 py-2">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-zinc-500">
        Assumptions: the battery takes prices as given (it doesn&apos;t move them), knows the whole day&apos;s prices in
        advance, trades energy only, and ignores loss factors, ramp limits and degradation. HiGHS stops within 0.1% of
        the best possible revenue.
      </p>
    </section>
  );
}
