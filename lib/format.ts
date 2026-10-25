import type { Metric } from "@/ingest/src/aggregate";

/** Labels have no offset and are market time, so read them as +10:00. */
export const labelMs = (label: string) =>
  Date.parse(`${label.length === 10 ? `${label}T00:00` : label.replace(" ", "T")}:00+10:00`);

/** NEM market time is AEST all year; Brisbane has no daylight saving. */
export const dateTime = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short" });
export const day = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "medium" });
export const time = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", timeStyle: "short" });

export const formatPrice = (v: number) => v.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
export const formatMw = (v: number) => `${Math.round(v).toLocaleString("en-AU")} MW`;

export function formatValue(metric: Metric, v: number | null): string {
  if (v === null) return "–";
  return metric === "price" ? formatPrice(v) : formatMw(v);
}

export const weekdayDate = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Brisbane",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
