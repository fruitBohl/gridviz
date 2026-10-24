import type { DispatchInterval } from "./dispatchis";
import { PRICE_FLAGS, type SuspensionRegime } from "./flags";
import { INTERVAL_MS } from "./time";

export type EventKind = "intervention" | "suspended" | keyof typeof PRICE_FLAGS;

/** Consecutive flagged intervals; `first` and `last` are interval end times. */
export type EventRun = {
  kind: EventKind;
  first: string;
  last: string;
  intervals: number;
  regions?: string[];
  regime?: SuspensionRegime;
};

type Active = { kind: EventKind; regime?: SuspensionRegime; regions: string[] };

/** Keyed by kind, plus the regime for suspensions, so a change of regime starts a new run. */
function activeKinds(interval: DispatchInterval): Map<string, Active> {
  const active = new Map<string, Active>();
  const mark = (key: string, kind: EventKind, region?: string, regime?: SuspensionRegime) => {
    const found = active.get(key) ?? { kind, regime, regions: [] };
    if (region) found.regions.push(region);
    active.set(key, found);
  };
  if (interval.intervention) mark("intervention", "intervention");
  for (const [region, r] of Object.entries(interval.regions)) {
    if (r.suspension) mark(`suspended:${r.suspension}`, "suspended", region, r.suspension);
    for (const [kind, bit] of Object.entries(PRICE_FLAGS) as [EventKind, number][]) {
      if ((r.priceFlags ?? 0) & bit) mark(kind, kind, region);
    }
  }
  return active;
}

/** Feed intervals in time order. A missing interval ends a run. */
export function createEventTracker() {
  const done: EventRun[] = [];
  const open = new Map<string, EventRun & { lastMs: number; regionSet: Set<string> }>();

  const close = (key: string) => {
    const { kind, first, last, intervals, regionSet, regime } = open.get(key)!;
    const run: EventRun = { kind, first, last, intervals };
    if (regionSet.size > 0) run.regions = [...regionSet].sort();
    if (regime) run.regime = regime;
    done.push(run);
    open.delete(key);
  };

  return {
    add(interval: DispatchInterval) {
      const ms = Date.parse(interval.t);
      const active = activeKinds(interval);
      for (const key of [...open.keys()]) {
        if (!active.has(key) || open.get(key)!.lastMs + INTERVAL_MS !== ms) close(key);
      }
      for (const [key, { kind, regime, regions }] of active) {
        const run = open.get(key);
        if (run) {
          run.last = interval.t;
          run.lastMs = ms;
          run.intervals++;
          regions.forEach((r) => run.regionSet.add(r));
        } else {
          open.set(key, {
            kind,
            first: interval.t,
            last: interval.t,
            intervals: 1,
            lastMs: ms,
            regionSet: new Set(regions),
            ...(regime && { regime }),
          });
        }
      }
    },

    finish(): EventRun[] {
      for (const key of [...open.keys()]) close(key);
      return done.sort((a, b) => a.first.localeCompare(b.first) || a.kind.localeCompare(b.kind));
    },
  };
}
