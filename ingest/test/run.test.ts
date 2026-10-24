import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import type { ReportFile } from "../src/nemweb";
import type { DayFile, Latest } from "../src/output";
import { run } from "../src/run";
import type { Store } from "../src/store";

class MemoryStore implements Store {
  objects = new Map<string, unknown>();
  async getJson<T>(key: string) {
    return this.objects.get(key) as T | undefined;
  }
  async putJson(key: string, value: unknown) {
    this.objects.set(key, structuredClone(value));
  }
  async putBytes(key: string, body: Uint8Array) {
    this.objects.set(key, body);
  }
}

// A minimal DispatchIS zip for one interval ending at `hhmm` on `date` (AEST)
function dispatchZip(date: string, hhmm: string, price: number): Uint8Array {
  const t = `"${date.replaceAll("-", "/")} ${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00"`;
  const csv = [
    "I,DISPATCH,PRICE,5,SETTLEMENTDATE,REGIONID,INTERVENTION,RRP",
    `D,DISPATCH,PRICE,5,${t},NSW1,0,${price}`,
    "I,DISPATCH,REGIONSUM,9,SETTLEMENTDATE,REGIONID,INTERVENTION,TOTALDEMAND,AVAILABLEGENERATION,NETINTERCHANGE",
    `D,DISPATCH,REGIONSUM,9,${t},NSW1,0,5000,9000,0`,
    "I,DISPATCH,INTERCONNECTORRES,3,SETTLEMENTDATE,INTERCONNECTORID,INTERVENTION,MWFLOW,EXPORTLIMIT,IMPORTLIMIT",
  ].join("\n");
  return zipSync({ "PUBLIC_DISPATCHIS.CSV": strToU8(csv) });
}

const file = (date: string, hhmm: string): ReportFile => ({
  name: `PUBLIC_DISPATCHIS_${date.replaceAll("-", "")}${hhmm}_1.zip`,
  url: `https://example.test/${date}${hhmm}.zip`,
  settlementDate: `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00+10:00`,
});

let store: MemoryStore;
let listing: ReportFile[];
let fetched: string[];

const options = () => ({
  store,
  fetchListing: async () => listing,
  fetchFile: async (f: ReportFile) => {
    fetched.push(f.settlementDate);
    return dispatchZip(f.settlementDate.slice(0, 10), f.settlementDate.slice(11, 16).replace(":", ""), 50);
  },
  now: () => new Date("2026-10-24T05:01:00Z"),
});

beforeEach(() => {
  store = new MemoryStore();
  fetched = [];
  // The previous trading day's last two intervals, then the first two of 2026-10-24
  listing = [file("2026-10-23", "2355"), file("2026-10-24", "0000"), file("2026-10-24", "0005"), file("2026-10-24", "0010")];
});

test("first run seeds from the start of the newest file's trading day", async () => {
  const result = await run(options());

  expect(fetched).toEqual(["2026-10-24T00:05:00+10:00", "2026-10-24T00:10:00+10:00"]);
  expect(result).toEqual({ processed: 2, settlementDate: "2026-10-24T00:10:00+10:00", daysWritten: ["2026-10-24"] });

  const latest = (await store.getJson<Latest>("data/latest.json"))!;
  expect(latest.settlementDate).toBe("2026-10-24T00:10:00+10:00");
  expect(latest.generatedAt).toBe("2026-10-24T05:01:00.000Z");

  const day = (await store.getJson<DayFile>("data/days/2026-10-24.json"))!;
  expect(day.intervals.map((i) => i.t)).toEqual(["2026-10-24T00:05:00+10:00", "2026-10-24T00:10:00+10:00"]);

  expect(store.objects.has("raw/dispatchis/2026/10/24/PUBLIC_DISPATCHIS_202610240010_1.zip")).toBe(true);
});

test("a second run with nothing new does no work", async () => {
  await run(options());
  fetched = [];
  const result = await run(options());
  expect(fetched).toEqual([]);
  expect(result.processed).toBe(0);
});

test("later runs catch up on every missed interval and append to the day file", async () => {
  await run(options());
  fetched = [];
  listing.push(file("2026-10-24", "0015"), file("2026-10-24", "0020"));

  const result = await run(options());

  expect(fetched).toEqual(["2026-10-24T00:15:00+10:00", "2026-10-24T00:20:00+10:00"]);
  expect(result.settlementDate).toBe("2026-10-24T00:20:00+10:00");
  const day = (await store.getJson<DayFile>("data/days/2026-10-24.json"))!;
  expect(day.intervals).toHaveLength(4);
});

test("intervals are split across trading days at the 00:00 boundary", async () => {
  await store.putJson("data/latest.json", { settlementDate: "2026-10-23T23:50:00+10:00" });

  const result = await run(options());

  expect(result.daysWritten).toEqual(["2026-10-23", "2026-10-24"]);
  const prev = (await store.getJson<DayFile>("data/days/2026-10-23.json"))!;
  expect(prev.intervals.map((i) => i.t)).toEqual(["2026-10-23T23:55:00+10:00", "2026-10-24T00:00:00+10:00"]);
});

test("maxFiles keeps the newest files", async () => {
  await store.putJson("data/latest.json", { settlementDate: "2026-10-23T23:50:00+10:00" });
  await run({ ...options(), maxFiles: 2 });
  expect(fetched).toEqual(["2026-10-24T00:05:00+10:00", "2026-10-24T00:10:00+10:00"]);
});

test("archiveRaw: false keeps no zips", async () => {
  await run({ ...options(), archiveRaw: false });
  expect([...store.objects.keys()].some((k) => k.startsWith("raw/"))).toBe(false);
});

test("a failed download leaves latest.json alone, so the next run retries", async () => {
  await run(options());
  listing.push(file("2026-10-24", "0015"));
  const failing = { ...options(), fetchFile: async () => Promise.reject(new Error("timeout")) };

  await expect(run(failing)).rejects.toThrow("timeout");
  expect((await store.getJson<Latest>("data/latest.json"))!.settlementDate).toBe("2026-10-24T00:10:00+10:00");
});

test("the real fixture runs end to end", async () => {
  const zip = new Uint8Array(
    readFileSync(join(import.meta.dir, "fixtures/PUBLIC_DISPATCHIS_202610241505_0000000544621747.zip")),
  );
  const real = file("2026-10-24", "1505");
  const result = await run({ ...options(), fetchListing: async () => [real], fetchFile: async () => zip });

  expect(result.settlementDate).toBe("2026-10-24T15:05:00+10:00");
  const latest = (await store.getJson<Latest>("data/latest.json"))!;
  expect(Object.keys(latest.regions)).toHaveLength(5);
});
