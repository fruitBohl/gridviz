import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlotFile } from "../src/aggregate";
import { expectedTimes } from "../src/oddities";
import { dayKey, type DayFile } from "../src/output";
import { rebuild } from "../src/rebuild";
import { FsStore, S3Store } from "../src/store";

const root = mkdtempSync(join(tmpdir(), "gridviz-rebuild-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const day = (date: string): DayFile => ({
  tradingDate: date,
  intervals: expectedTimes(date).map((t) => ({
    t,
    regions: { NSW1: { price: 50, demand: 1000, availableGeneration: 2000, netInterchange: 0 } },
    interconnectors: { "V-SA": { mwFlow: 100, exportLimit: 600, importLimit: -500 } },
  })),
});

test("rebuilds the plot and extremes files through yesterday in market time, logging missing days", async () => {
  const store = new FsStore(root);
  for (const date of ["2026-10-20", "2026-10-21", "2026-10-23", "2026-10-24"]) await store.putJson(dayKey(date), day(date));
  const logs: [string, Record<string, unknown> | undefined][] = [];

  const result = await rebuild({
    store,
    from: "2026-10-20",
    // 00:30 AEST on 2026-10-24, when the schedule runs
    now: () => new Date("2026-10-23T14:30:00Z"),
    log: (message, fields) => logs.push([message, fields]),
  });

  expect(result.throughDate).toBe("2026-10-23");
  expect(result.missingDays).toEqual(["2026-10-22"]);
  expect(logs[0]).toEqual(["missing day files", { missingDays: ["2026-10-22"] }]);
  expect(readdirSync(join(root, "data/plots")).sort()).toEqual([
    "demand-daily.json",
    "demand-extremes.json",
    "interconnectorFlow-daily.json",
    "interconnectorFlow-extremes.json",
    "netInterchange-daily.json",
    "netInterchange-extremes.json",
    "price-daily.json",
    "price-extremes.json",
  ]);

  const daily = (await store.getJson<PlotFile>("data/plots/price-daily.json"))!;
  expect(daily.throughDate).toBe("2026-10-23");
  expect(daily.t).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  expect(daily.series.NSW1).toEqual([50, 50, null, 50]);
  expect(daily.events).toEqual([{ kind: "missingData", start: "2026-10-22 00:00", end: "2026-10-23 00:00" }]);
});

test("S3Store sends the cache-control it's given, or 60 s by default", async () => {
  const sent: Record<string, unknown>[] = [];
  const s3 = { send: async (command: { input: Record<string, unknown> }) => void sent.push(command.input) };
  const store = new S3Store(s3 as never, "bucket");
  await store.putJson("data/latest.json", {});
  await store.putJson("data/plots/price-daily.json", {}, { cacheControl: "public, max-age=3600" });
  expect(sent.map((input) => input.CacheControl)).toEqual(["public, max-age=60", "public, max-age=3600"]);
});
