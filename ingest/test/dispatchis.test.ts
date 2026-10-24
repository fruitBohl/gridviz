import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDispatchIsCsv, parseDispatchIsZip } from "../src/dispatchis";
import { dispatchCsv, validRows } from "./helpers";

// Real file downloaded from NEMWeb on 2026-10-24 (interval ending 15:05 AEST)
const FIXTURE = join(import.meta.dir, "fixtures/PUBLIC_DISPATCHIS_202610241505_0000000544621747.zip");

describe("parseDispatchIsZip on a real NEMWeb file", () => {
  const [interval, ...rest] = parseDispatchIsZip(new Uint8Array(readFileSync(FIXTURE)));

  test("one interval, labelled by its end time in AEST", () => {
    expect(rest).toHaveLength(0);
    expect(interval.t).toBe("2026-10-24T15:05:00+10:00");
  });

  test("all five regions with price and demand", () => {
    expect(Object.keys(interval.regions).sort()).toEqual(["NSW1", "QLD1", "SA1", "TAS1", "VIC1"]);
    expect(interval.regions.NSW1).toEqual({
      price: 87.71,
      demand: 5821.2,
      availableGeneration: 16753.82,
      netInterchange: 275.68,
    });
    expect(interval.regions.SA1.price).toBe(-5.22);
  });

  test("every interconnector, including NSW1-SA1", () => {
    expect(Object.keys(interval.interconnectors)).toHaveLength(7);
    expect(interval.interconnectors["NSW1-QLD1"]).toEqual({
      mwFlow: -277.51,
      exportLimit: 672.26,
      importLimit: -1119.77,
    });
    expect(interval.interconnectors["NSW1-SA1"].mwFlow).toBe(-135.82);
  });
});

describe("interventions", () => {
  const t = "2026/10/24 15:05:00";
  const valid = validRows(t);
  const sa = (rows: Record<string, string>[], overrides: Record<string, string>) => {
    const row = rows.find((r) => r.REGIONID === "SA1")!;
    return { ...row, ...overrides };
  };
  const csv = dispatchCsv(t, {
    price: [...valid.price.filter((r) => r.REGIONID !== "SA1"), sa(valid.price, { RRP: "100" }), sa(valid.price, { INTERVENTION: "1", RRP: "999" })],
    regionSum: [
      ...valid.regionSum.filter((r) => r.REGIONID !== "SA1"),
      sa(valid.regionSum, { TOTALDEMAND: "1000" }),
      sa(valid.regionSum, { INTERVENTION: "1", TOTALDEMAND: "1100" }),
    ],
    interconnector: [
      { ...valid.interconnector[0], INTERVENTION: "1", MWFLOW: "50" },
      { ...valid.interconnector[0], INTERVENTION: "0", MWFLOW: "40" },
    ],
  });
  const [interval] = parseDispatchIsCsv(csv);

  test("price comes from the pricing run (INTERVENTION=0)", () => {
    expect(interval.regions.SA1.price).toBe(100);
  });

  test("quantities come from the physical run (INTERVENTION=1), in any row order", () => {
    expect(interval.regions.SA1.demand).toBe(1100);
    expect(interval.interconnectors["V-SA"].mwFlow).toBe(50);
  });
});

describe("incomplete intervals fail loudly", () => {
  const t = "2026/10/24 15:05:00";
  const valid = validRows(t);

  test("a region missing from REGIONSUM", () => {
    const csv = dispatchCsv(t, { regionSum: valid.regionSum.filter((r) => r.REGIONID !== "TAS1") });
    expect(() => parseDispatchIsCsv(csv)).toThrow("no data for TAS1");
  });

  test("a region with demand but no price", () => {
    const csv = dispatchCsv(t, { price: valid.price.filter((r) => r.REGIONID !== "QLD1") });
    expect(() => parseDispatchIsCsv(csv)).toThrow("No pricing-run price for QLD1");
  });

  test("no interconnector rows", () => {
    expect(() => parseDispatchIsCsv(dispatchCsv(t, { interconnector: [] }))).toThrow("no rows");
  });
});
