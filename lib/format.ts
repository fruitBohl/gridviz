import type { Metric } from "@/ingest/src/aggregate";

/** Labels have no offset and are market time, so read them as +10:00. */
export const labelMs = (label: string) =>
  Date.parse(`${label.length === 10 ? `${label}T00:00` : label.replace(" ", "T")}:00+10:00`);

export const day = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "medium" });
export const time = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", timeStyle: "short" });

export function formatValue(metric: Metric, v: number | null): string {
  if (v === null) return "–";
  return metric === "price"
    ? v.toLocaleString("en-AU", { style: "currency", currency: "AUD" })
    : `${Math.round(v).toLocaleString("en-AU")} MW`;
}

export const weekdayDate = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Brisbane",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
