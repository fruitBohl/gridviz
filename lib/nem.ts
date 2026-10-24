import type { Metric, PlotEventKind } from "@/ingest/src/aggregate";

export const REGION_IDS = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"] as const;

export const REGIONS: Record<string, { name: string; short: string }> = {
  NSW1: { name: "New South Wales", short: "NSW" },
  QLD1: { name: "Queensland", short: "QLD" },
  SA1: { name: "South Australia", short: "SA" },
  TAS1: { name: "Tasmania", short: "TAS" },
  VIC1: { name: "Victoria", short: "VIC" },
};

/** Positive flow runs from the first region to the second. */
export const INTERCONNECTORS: Record<string, { name: string; from: string; to: string }> = {
  "N-Q-MNSP1": { name: "Terranora", from: "NSW", to: "QLD" },
  "NSW1-QLD1": { name: "QNI", from: "NSW", to: "QLD" },
  "NSW1-SA1": { name: "EnergyConnect", from: "NSW", to: "SA" },
  "T-V-MNSP1": { name: "Basslink", from: "TAS", to: "VIC" },
  "V-S-MNSP1": { name: "Murraylink", from: "VIC", to: "SA" },
  "V-SA": { name: "Heywood", from: "VIC", to: "SA" },
  "VIC1-NSW1": { name: "VNI", from: "VIC", to: "NSW" },
};

export type ColorMode = "light" | "dark";

/**
 * Categorical slots, checked with the dataviz palette validator against this site's surfaces
 * (#ffffff and #0a0a0a): colour-blind safe for neighbouring slots in both modes. In light mode
 * aqua, yellow and magenta are under 3:1 contrast, so every chart also has a table view.
 */
const SLOTS: Record<ColorMode, string[]> = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const FALLBACK = "#898781";

/** Each region and interconnector keeps its colour on every chart, whatever else is shown. */
export function seriesColor(id: string, mode: ColorMode): string {
  const regionSlot = REGION_IDS.indexOf(id as (typeof REGION_IDS)[number]);
  const slot = regionSlot !== -1 ? regionSlot : Object.keys(INTERCONNECTORS).indexOf(id);
  return slot === -1 ? FALLBACK : SLOTS[mode][slot];
}

export function seriesName(id: string): string {
  if (REGIONS[id]) return REGIONS[id].short;
  const ic = INTERCONNECTORS[id];
  return ic ? `${ic.name} (${ic.from}→${ic.to})` : id;
}

export function shortSeriesName(id: string): string {
  return REGIONS[id]?.short ?? INTERCONNECTORS[id]?.name ?? id;
}

export const CHROME: Record<ColorMode, { text: string; muted: string; grid: string; axis: string }> = {
  light: { text: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7" },
  dark: { text: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", axis: "#383835" },
};

/** Bands use status colours, which never double as series colours, and always come with a label. */
export const EVENTS: Record<PlotEventKind, { label: string; color: string; description: string }> = {
  intervention: {
    label: "Intervention",
    color: "#fab219",
    description:
      "AEMO intervened in the market (for example, directing a generator to run). Prices come from the pricing run; demand and flows are what was physically dispatched.",
  },
  suspended: {
    label: "Market suspended",
    color: "#d03b3b",
    description: "The spot market was suspended in these regions, so prices weren't set by generators' bids.",
  },
  priceLimit: {
    label: "Price at the cap or floor",
    color: "#ec835a",
    description: "The price hit the market price cap or floor, so it was clamped to that limit.",
  },
  administeredPrice: {
    label: "Administered price",
    color: "#ec835a",
    description: "An administered price cap or floor applied after a run of very high or very low prices.",
  },
  manualPrice: {
    label: "Price set manually",
    color: "#ec835a",
    description: "AEMO manually overwrote the dispatch price.",
  },
  lossFactorScaling: {
    label: "Price scaled",
    color: "#ec835a",
    description: "The price was scaled by an inter-regional loss factor, usually because a neighbouring region's price was set another way.",
  },
  missingData: {
    label: "Missing data",
    color: "#898781",
    description: "No dispatch data for this period.",
  },
};

export const SUSPENSION_PRICING: Record<string, string> = {
  schedule: "Prices came from AEMO's suspension price schedule (30-minute prices), not from bids.",
  dispatch: "Prices still came from the dispatch engine while the market was suspended.",
};

/**
 * One-hue ordinal ramp for ranked days, strongest for the most extreme. Checked with the dataviz
 * validator in ordinal mode against #ffffff and #0a0a0a.
 */
export const RANK_RAMP: Record<ColorMode, string[]> = {
  light: ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef"],
  dark: ["#cde2fb", "#86b6ef", "#3987e5", "#256abf", "#184f95"],
};

export const CHARTS: { metric: Metric; title: string; note: string }[] = [
  { metric: "price", title: "Spot price", note: "Regional reference price (RRP), $/MWh." },
  {
    metric: "demand",
    title: "Demand",
    note: "AEMO's TOTALDEMAND, MW: demand met by scheduled and semi-scheduled generation and imports. Rooftop solar and small generators aren't included, so sunny middays pull it down.",
  },
  {
    metric: "netInterchange",
    title: "Net interchange",
    note: "Positive means the region is exporting to its neighbours; negative means importing. MW.",
  },
  {
    metric: "interconnectorFlow",
    title: "Interconnector flow",
    note: "Positive flow runs in the direction of the name, for example NSW→QLD. MW.",
  },
];
