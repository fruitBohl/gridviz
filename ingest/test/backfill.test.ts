import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { datesBetween, parseMmsdmListing, planSources, readDailyArchive, readMmsdmMonth } from "../src/backfill";
import { mergeTables, parseAemoCsv } from "../src/csv";
import { dispatchCsv, dispatchZip, validRows } from "./helpers";

test("datesBetween crosses month and year ends", () => {
  expect(datesBetween("2024-12-30", "2025-01-02")).toEqual(["2024-12-30", "2024-12-31", "2025-01-01", "2025-01-02"]);
});

describe("planSources", () => {
  const dates = datesBetween("2026-09-29", "2026-10-03");
  const mmsdm = new Map([["2026-09", ["a.zip"]]]);

  test("one MMSDM source per month, then the daily archive, then Current", () => {
    expect(planSources(dates, mmsdm, new Set(["2026-10-01", "2026-10-02"]))).toEqual([
      { kind: "mmsdm", month: "2026-09", files: ["a.zip"] },
      { kind: "daily", date: "2026-10-01" },
      { kind: "daily", date: "2026-10-02" },
      { kind: "current", date: "2026-10-03" },
    ]);
  });
});

test("parseMmsdmListing finds every part of the three tables, encoded or not", () => {
  const html = `
    <A HREF="/x/PUBLIC_ARCHIVE%23DISPATCHPRICE%23FILE01%23202410010000.zip">PUBLIC_ARCHIVE#DISPATCHPRICE#FILE01#202410010000.zip</A>
    <A HREF="/x/PUBLIC_ARCHIVE%23DISPATCHREGIONSUM%23FILE02%23202410010000.zip">x</A>
    <A HREF="/x/PUBLIC_ARCHIVE%23PREDISPATCHPRICE%23FILE01%23202410010000.zip">x</A>
    100% done`;
  expect(parseMmsdmListing(html)).toEqual([
    "PUBLIC_ARCHIVE#DISPATCHPRICE#FILE01#202410010000.zip",
    "PUBLIC_ARCHIVE#DISPATCHREGIONSUM#FILE02#202410010000.zip",
  ]);
});

describe("mergeTables", () => {
  const a = parseAemoCsv(dispatchCsv("2026/10/24 15:05:00"));
  const b = parseAemoCsv(dispatchCsv("2026/10/24 15:10:00"));

  test("concatenates rows of the same table", () => {
    expect(mergeTables([a, b]).get("DISPATCH.PRICE")!.rows).toHaveLength(10);
    expect(a.get("DISPATCH.PRICE")!.rows).toHaveLength(5);
  });

  test("files that disagree on a table's version are an error", () => {
    const v8 = parseAemoCsv(dispatchCsv("2026/10/24 15:10:00", { versions: { REGIONSUM: 8 } }));
    expect(() => mergeTables([a, v8])).toThrow("disagree on the table version");
  });
});

test("readMmsdmMonth on the real single-table fixtures", () => {
  const zip = (table: string) =>
    zipSync({ [`${table}.CSV`]: readFileSync(join(import.meta.dir, `fixtures/mmsdm/${table}_202410.CSV`)) });
  const intervals = readMmsdmMonth(["DISPATCHPRICE", "DISPATCHREGIONSUM", "DISPATCHINTERCONNECTORRES"].map(zip));
  expect(intervals.map((i) => i.t)).toEqual(["2024-10-01T00:05:00+10:00", "2024-10-17T10:25:00+10:00"]);
});

describe("readDailyArchive", () => {
  const inner = (hhmm: string, seq: string, price = "50") => {
    const t = `2026/10/01 ${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00`;
    return [`PUBLIC_DISPATCHIS_20261001${hhmm}_${seq}.zip`, dispatchZip(t, { price: validRows(t, price).price })] as const;
  };

  test("parses each inner zip, in interval order", () => {
    const outer = zipSync(Object.fromEntries([inner("0010", "0000000000000002"), inner("0005", "0000000000000001")]));
    expect(readDailyArchive(outer).map((i) => i.t)).toEqual(["2026-10-01T00:05:00+10:00", "2026-10-01T00:10:00+10:00"]);
  });

  test("a republished interval comes after the original, so it wins a merge", () => {
    const outer = zipSync(
      Object.fromEntries([inner("0005", "0000000000000009", "99"), inner("0005", "0000000000000001", "11")]),
    );
    expect(readDailyArchive(outer).map((i) => i.regions.NSW1.price)).toEqual([11, 99]);
  });

  test("an inner file whose contents don't match its name is an error", () => {
    const outer = zipSync({ "PUBLIC_DISPATCHIS_202610010005_1.zip": dispatchZip("2026/10/01 09:00:00") });
    expect(() => readDailyArchive(outer)).toThrow("expected one interval ending 2026-10-01T00:05:00+10:00");
  });

  test("non-zip entries are ignored", () => {
    expect(readDailyArchive(zipSync({ "readme.txt": strToU8("hi") }))).toEqual([]);
  });
});
