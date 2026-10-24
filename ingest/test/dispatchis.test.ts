import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { aemoTimeToIso, parseDispatchIsCsv, parseDispatchIsZip } from "../src/dispatchis";

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
  const t = '"2026/10/24 15:05:00"';
  const csv = [
    "I,DISPATCH,PRICE,5,SETTLEMENTDATE,REGIONID,INTERVENTION,RRP",
    `D,DISPATCH,PRICE,5,${t},SA1,0,100`,
    `D,DISPATCH,PRICE,5,${t},SA1,1,999`,
    "I,DISPATCH,REGIONSUM,9,SETTLEMENTDATE,REGIONID,INTERVENTION,TOTALDEMAND,AVAILABLEGENERATION,NETINTERCHANGE",
    `D,DISPATCH,REGIONSUM,9,${t},SA1,0,1000,3000,10`,
    `D,DISPATCH,REGIONSUM,9,${t},SA1,1,1100,3100,20`,
    "I,DISPATCH,INTERCONNECTORRES,3,SETTLEMENTDATE,INTERCONNECTORID,INTERVENTION,MWFLOW,EXPORTLIMIT,IMPORTLIMIT",
    `D,DISPATCH,INTERCONNECTORRES,3,${t},V-SA,1,50,200,-200`,
    `D,DISPATCH,INTERCONNECTORRES,3,${t},V-SA,0,40,200,-200`,
  ].join("\n");
  const [interval] = parseDispatchIsCsv(csv);

  test("price comes from the pricing run (INTERVENTION=0)", () => {
    expect(interval.regions.SA1.price).toBe(100);
  });

  test("quantities come from the physical run (INTERVENTION=1), in any row order", () => {
    expect(interval.regions.SA1.demand).toBe(1100);
    expect(interval.interconnectors["V-SA"].mwFlow).toBe(50);
  });
});

describe("format changes fail loudly", () => {
  test("a missing column throws", () => {
    const csv = [
      "I,DISPATCH,PRICE,5,SETTLEMENTDATE,REGIONID,INTERVENTION,RRP",
      'D,DISPATCH,PRICE,5,"2026/10/24 15:05:00",SA1,0,100',
      "I,DISPATCH,REGIONSUM,9,SETTLEMENTDATE,REGIONID,INTERVENTION,TOTALDEMAND",
      'D,DISPATCH,REGIONSUM,9,"2026/10/24 15:05:00",SA1,0,1000',
      "I,DISPATCH,INTERCONNECTORRES,3,SETTLEMENTDATE,INTERCONNECTORID,INTERVENTION",
    ].join("\n");
    expect(() => parseDispatchIsCsv(csv)).toThrow("Missing column AVAILABLEGENERATION");
  });

  test("a missing table throws", () => {
    expect(() => parseDispatchIsCsv("I,DISPATCH,PRICE,5,SETTLEMENTDATE")).toThrow(
      "Table DISPATCH.REGIONSUM not found",
    );
  });

  test("a zip without a CSV throws", () => {
    expect(() => parseDispatchIsZip(zipSync({ "readme.txt": strToU8("hi") }))).toThrow("No CSV");
  });
});

test("aemoTimeToIso", () => {
  expect(aemoTimeToIso("2026/10/25 00:00:00")).toBe("2026-10-25T00:00:00+10:00");
  expect(() => aemoTimeToIso("2026-10-25 00:00")).toThrow();
});
