import { METRICS, metricValues, round2, UNITS, type Metric, type PlotFile } from "./aggregate";
import { INTERVALS_PER_DAY } from "./oddities";
import type { DayFile } from "./output";
import { INTERVAL_MS, startOfDayMs } from "./time";

export const DIRECTIONS = ["highest", "lowest"] as const;
export type Direction = (typeof DIRECTIONS)[number];
/** "mean" ranks days by their daily mean; "peak" by their single most extreme 5-minute interval. */
export const RANKINGS = ["mean", "peak"] as const;
export type Ranking = (typeof RANKINGS)[number];
export const TOP_N = 5;

export type ExtremeDay = { date: string; value: number };

export type ExtremesFile = {
  metric: Metric;
  unit: PlotFile["unit"];
  generatedAt: string;
  throughDate: string;
  /** Per series, most extreme first. */
  ranks: Record<string, Record<Direction, Record<Ranking, ExtremeDay[]>>>;
  /** Per series and ranked date: one value per interval, the first ending 00:05. */
  profiles: Record<string, Record<string, number[]>>;
};

export const extremesKey = (metric: Metric) => `data/plots/${metric}-extremes.json`;

type DayStats = { date: string; mean: number; max: number; min: number; profile: number[] };

const score = (d: DayStats, direction: Direction, ranking: Ranking) =>
  ranking === "mean" ? d.mean : direction === "highest" ? d.max : d.min;

/** Peak ties are common at the market price cap, so they go to the more extreme mean. */
function rank(days: DayStats[], direction: Direction, ranking: Ranking): DayStats[] {
  const sign = direction === "highest" ? -1 : 1;
  return [...days]
    .sort(
      (a, b) =>
        sign * (score(a, direction, ranking) - score(b, direction, ranking)) ||
        sign * (a.mean - b.mean) ||
        a.date.localeCompare(b.date),
    )
    .slice(0, TOP_N);
}

function prune(days: DayStats[]): DayStats[] {
  const keep = new Set(DIRECTIONS.flatMap((d) => RANKINGS.flatMap((r) => rank(days, d, r))));
  return days.filter((d) => keep.has(d));
}

/**
 * Finds the most extreme trading days per series. Only days where the series has all 288
 * intervals count, so a partly missing day or a link's first day can't rank on a partial mean.
 * Feed days in any order; only the current candidates are kept in memory.
 */
export function createExtremes() {
  const kept = new Map<Metric, Map<string, DayStats[]>>(METRICS.map((m) => [m, new Map()]));

  return {
    add(day: DayFile) {
      const start = startOfDayMs(day.tradingDate);
      const profiles = new Map<Metric, Map<string, number[]>>(METRICS.map((m) => [m, new Map()]));
      for (const interval of day.intervals) {
        const i = (Date.parse(interval.t) - start) / INTERVAL_MS - 1;
        if (i < 0 || i >= INTERVALS_PER_DAY) continue;
        for (const metric of METRICS) {
          const byId = profiles.get(metric)!;
          for (const [id, value] of metricValues(interval, metric)) {
            if (!byId.has(id)) byId.set(id, Array(INTERVALS_PER_DAY));
            byId.get(id)![i] = value;
          }
        }
      }

      for (const [metric, byId] of profiles) {
        for (const [id, profile] of byId) {
          if (Object.keys(profile).length !== INTERVALS_PER_DAY) continue;
          const stats: DayStats = {
            date: day.tradingDate,
            mean: round2(profile.reduce((a, b) => a + b, 0) / INTERVALS_PER_DAY),
            max: Math.max(...profile),
            min: Math.min(...profile),
            profile,
          };
          const candidates = kept.get(metric)!;
          candidates.set(id, prune([...(candidates.get(id) ?? []), stats]));
        }
      }
    },

    finish(throughDate: string, { generatedAt = new Date() }: { generatedAt?: Date } = {}): ExtremesFile[] {
      return METRICS.map((metric) => {
        const ranks: ExtremesFile["ranks"] = {};
        const profiles: ExtremesFile["profiles"] = {};
        for (const [id, days] of [...kept.get(metric)!].sort(([a], [b]) => a.localeCompare(b))) {
          profiles[id] = {};
          const byDirection = {} as ExtremesFile["ranks"][string];
          for (const direction of DIRECTIONS) {
            byDirection[direction] = {} as Record<Ranking, ExtremeDay[]>;
            for (const ranking of RANKINGS) {
              byDirection[direction][ranking] = rank(days, direction, ranking).map((d) => {
                profiles[id][d.date] = d.profile;
                return { date: d.date, value: score(d, direction, ranking) };
              });
            }
          }
          ranks[id] = byDirection;
        }
        return { metric, unit: UNITS[metric], generatedAt: generatedAt.toISOString(), throughDate, ranks, profiles };
      });
    },
  };
}
