import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import { mergeTables, parseAemoCsv } from "./csv";
import { buildIntervals, type DispatchInterval } from "./dispatchis";
import { fetchListing, settlementFromName, USER_AGENT, type ReportFile } from "./nemweb";
import { createReport, type OddityReport } from "./oddities";
import { dayKey, mergeIntervals, tradingDate } from "./output";
import { parseFile } from "./run";
import { DISPATCHIS_COLUMNS } from "./schema";
import { FsStore } from "./store";

const MMSDM_URL = "https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM";
const DAILY_URL = "https://nemweb.com.au/Reports/Archive/DispatchIS_Reports/";
const MMSDM_TABLES = ["DISPATCHPRICE", "DISPATCHREGIONSUM", "DISPATCHINTERCONNECTORRES"] as const;

export type Source =
  | { kind: "mmsdm"; month: string; files: string[] }
  | { kind: "daily"; date: string }
  | { kind: "current"; date: string };

export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86_400_000) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

/** Prefer the monthly MMSDM archive, then the daily DispatchIS archive, then Current. */
export function planSources(dates: string[], mmsdm: Map<string, string[]>, daily: Set<string>): Source[] {
  const sources: Source[] = [];
  for (const date of dates) {
    const month = date.slice(0, 7);
    const files = mmsdm.get(month);
    if (files) {
      if (!sources.some((s) => s.kind === "mmsdm" && s.month === month)) sources.push({ kind: "mmsdm", month, files });
    } else {
      sources.push({ kind: daily.has(date) ? "daily" : "current", date });
    }
  }
  return sources;
}

/** Each listed file name, `#` decoded, for the three tables. Large tables can be split into FILE01, FILE02, ... */
export function parseMmsdmListing(html: string): string[] {
  const tables = MMSDM_TABLES.join("|");
  const pattern = new RegExp(`PUBLIC_ARCHIVE#(?:${tables})#FILE\\d+#\\d{12}\\.zip`, "gi");
  return [...new Set(html.replaceAll("%23", "#").match(pattern) ?? [])].sort();
}

export function readMmsdmMonth(zips: Uint8Array[]): DispatchInterval[] {
  const tables = zips.map((zip) => {
    const csv = Object.entries(unzipSync(zip)).find(([name]) => /\.csv$/i.test(name));
    if (!csv) throw new Error("No CSV in MMSDM zip");
    return parseAemoCsv(strFromU8(csv[1]), DISPATCHIS_COLUMNS);
  });
  return buildIntervals(mergeTables(tables));
}

/** The inner zips sort by interval then sequence number, so a republished interval wins when merged. */
export function readDailyArchive(zip: Uint8Array): DispatchInterval[] {
  const entries = Object.entries(unzipSync(zip))
    .filter(([name]) => /\.zip$/i.test(name))
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.flatMap(([name, inner]) =>
    parseFile({ name, url: name, settlementDate: settlementFromName(name) }, inner),
  );
}

function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

type Fetcher = { bytes(url: string, name: string): Promise<Uint8Array>; text(url: string): Promise<string | undefined> };

function nemweb(cacheDir: string, concurrency: number, log: (message: string) => void): Fetcher {
  const limit = limiter(concurrency);
  const get = (url: string) =>
    limit(() => fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(300_000) }));

  return {
    async bytes(url, name) {
      const path = join(cacheDir, name);
      try {
        return new Uint8Array(await readFile(path));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      const res = await get(url);
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      const body = new Uint8Array(await res.arrayBuffer());
      await mkdir(cacheDir, { recursive: true });
      await writeFile(`${path}.part`, body);
      await rename(`${path}.part`, path);
      log(`downloaded ${name} (${(body.length / 1e6).toFixed(1)} MB)`);
      return body;
    },
    async text(url) {
      const res = await get(url);
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      return res.text();
    },
  };
}

const mmsdmFolder = (month: string) => {
  const [y, m] = month.split("-");
  return `${MMSDM_URL}/${y}/MMSDM_${y}_${m}/MMSDM_Historical_Data_SQLLoader/DATA/`;
};

async function findMmsdmMonths(months: string[], fetcher: Fetcher): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  await Promise.all(
    months.map(async (month) => {
      const html = await fetcher.text(mmsdmFolder(month));
      if (!html) return;
      const files = parseMmsdmListing(html);
      if (MMSDM_TABLES.every((t) => files.some((f) => f.includes(`#${t}#`)))) found.set(month, files);
    }),
  );
  return found;
}

function summarise(sources: Source[]): string {
  const mmsdm = sources.flatMap((s) => (s.kind === "mmsdm" ? [s.month] : []));
  const range = (kind: Source["kind"]) => {
    const dates = sources.flatMap((s) => (s.kind === kind && "date" in s ? [s.date] : []));
    return dates.length ? `${dates.length} day(s), ${dates[0]} to ${dates.at(-1)}` : "none";
  };
  return [
    `MMSDM monthly: ${mmsdm.length ? `${mmsdm.length} month(s), ${mmsdm[0]} to ${mmsdm.at(-1)}` : "none"}`,
    `daily archive: ${range("daily")}`,
    `current:       ${range("current")}`,
  ].join("\n");
}

export type BackfillOptions = {
  from: string;
  to: string;
  outDir: string;
  cacheDir: string;
  concurrency: number;
  planOnly: boolean;
  log: (message: string) => void;
};

export async function backfill(o: BackfillOptions): Promise<OddityReport | undefined> {
  const fetcher = nemweb(o.cacheDir, o.concurrency, o.log);
  const dates = datesBetween(o.from, o.to);
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];

  const mmsdm = await findMmsdmMonths(months, fetcher);
  const dailyHtml = (await fetcher.text(DAILY_URL)) ?? "";
  const daily = new Set([...dailyHtml.matchAll(/PUBLIC_DISPATCHIS_(\d{4})(\d{2})(\d{2})\.zip/gi)].map((m) => `${m[1]}-${m[2]}-${m[3]}`));
  const sources = planSources(dates, mmsdm, daily);
  o.log(`plan for ${o.from} to ${o.to}:\n${summarise(sources)}`);
  if (o.planOnly) return undefined;

  let listing: Promise<ReportFile[]> | undefined;
  const download = async (source: Source): Promise<() => DispatchInterval[]> => {
    if (source.kind === "mmsdm") {
      const folder = mmsdmFolder(source.month);
      const zips = await Promise.all(
        source.files.map((name) => fetcher.bytes(folder + name.replaceAll("#", "%23"), name)),
      );
      return () => readMmsdmMonth(zips);
    }
    if (source.kind === "daily") {
      const name = `PUBLIC_DISPATCHIS_${source.date.replaceAll("-", "")}.zip`;
      const zip = await fetcher.bytes(DAILY_URL + name, name);
      return () => readDailyArchive(zip);
    }
    listing ??= fetchListing();
    const files = (await listing).filter((f) => tradingDate(f.settlementDate) === source.date);
    const zips = await Promise.all(files.map((f) => fetcher.bytes(f.url, f.name)));
    return () => files.flatMap((f, i) => parseFile(f, zips[i]));
  };

  const store = new FsStore(o.outDir);
  const report = createReport(o.from, o.to);
  const inRange = new Set(dates);
  const written = new Set<string>();
  const downloads = sources.map(() => undefined as Promise<() => DispatchInterval[]> | undefined);
  const prefetch = 3;
  for (let i = 0; i < sources.length; i++) {
    for (let j = i; j <= Math.min(i + prefetch, sources.length - 1); j++) downloads[j] ??= download(sources[j]);
    const intervals = (await downloads[i]!)();
    downloads[i] = undefined;

    const byDay = new Map<string, DispatchInterval[]>();
    for (const interval of intervals) {
      const date = tradingDate(interval.t);
      if (!inRange.has(date)) continue;
      if (!byDay.has(date)) byDay.set(date, []);
      byDay.get(date)!.push(interval);
    }
    for (const date of [...byDay.keys()].sort()) {
      if (written.has(date)) throw new Error(`${date} came from two sources; the plan's day boundaries are wrong`);
      written.add(date);
      const day = mergeIntervals(undefined, date, byDay.get(date)!);
      await store.putJson(dayKey(date), day);
      report.add(day);
    }
    const source = sources[i];
    o.log(`wrote ${byDay.size} day(s) from ${source.kind} ${source.kind === "mmsdm" ? source.month : source.date}`);
  }

  const result = report.finish();
  await store.putJson("oddities.json", result);
  return result;
}

function yesterdayInMarketTime(now = new Date()): string {
  const today = tradingDate(now.toISOString());
  return new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      from: { type: "string", default: "2024-10-01" },
      to: { type: "string", default: yesterdayInMarketTime() },
      out: { type: "string", default: "backfill-out" },
      "plan-only": { type: "boolean", default: false },
    },
  });
  const report = await backfill({
    from: values.from,
    to: values.to,
    outDir: values.out,
    cacheDir: ".cache/nemweb",
    concurrency: 4,
    planOnly: values["plan-only"],
    log: (message) => console.log(message),
  });
  if (report) {
    const { incompleteDays, missingDays, runs, interconnectors } = report;
    console.log(`\nmissing days: ${missingDays.length ? missingDays.join(", ") : "none"}`);
    console.log(`incomplete days: ${incompleteDays.length ? "" : "none"}`);
    for (const d of incompleteDays) console.log(`  ${d.date}: ${d.intervals} intervals`, JSON.stringify(d.missing), d.unexpected.join(" "));
    console.log("runs of flagged intervals:");
    for (const [kind, list] of Object.entries(runs)) {
      console.log(`  ${kind}: ${list.length} run(s), ${list.reduce((n, r) => n + r.intervals, 0)} interval(s)`);
    }
    console.log("interconnectors:");
    for (const [id, link] of Object.entries(interconnectors)) {
      console.log(`  ${id.padEnd(10)} ${link.first} to ${link.last}, ${link.intervals} intervals, ${link.missingInSpan} missing in span`);
    }
    console.log(`\nfull report: ${join(values.out, "oddities.json")}`);
  }
}
