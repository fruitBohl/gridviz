import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { parseAemoCsv } from "../src/csv";
import { buildIntervals, parseDispatchIsCsv, parseDispatchIsZip } from "../src/dispatchis";
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

test("buildIntervals on the fixture's tables matches parseDispatchIsZip", () => {
  const zip = new Uint8Array(readFileSync(FIXTURE));
  const [csv] = Object.values(unzipSync(zip));
  expect(buildIntervals(parseAemoCsv(strFromU8(csv)))).toEqual(parseDispatchIsZip(zip));
});

// Real rows cut from the October 2024 MMSDM monthly archive: the intervals ending 2024-10-01 00:05
// and 2024-10-17 10:25, when SA1 hit the $17,500/MWh market price cap
describe("buildIntervals on MMSDM single-table files", () => {
  const read = (table: string) =>
    parseAemoCsv(readFileSync(join(import.meta.dir, `fixtures/mmsdm/${table}_202410.CSV`), "utf8"));
  const tables = new Map([
    ...read("DISPATCHPRICE"),
    ...read("DISPATCHREGIONSUM"),
    ...read("DISPATCHINTERCONNECTORRES"),
  ]);

  const [first, capped] = buildIntervals(tables);

  test("the three files merge into intervals with all five regions", () => {
    expect(tables.get("DISPATCH.REGIONSUM")!.version).toBe(8);
    expect(buildIntervals(tables).map((i) => i.t)).toEqual(["2024-10-01T00:05:00+10:00", "2024-10-17T10:25:00+10:00"]);
    expect(Object.keys(first.regions).sort()).toEqual(["NSW1", "QLD1", "SA1", "TAS1", "VIC1"]);
    expect(first.regions.NSW1).toStrictEqual({
      price: 104.1,
      demand: 7403.93,
      availableGeneration: 9577.42,
      netInterchange: -611.27,
    });
  });

  test("a price at the market price cap carries APCFLAG 4; other regions carry no flags", () => {
    expect(capped.regions.SA1.price).toBe(17500);
    expect(capped.regions.SA1.priceFlags).toBe(4);
    expect(capped.regions.VIC1).not.toContainKey("priceFlags");
    expect(capped).not.toContainKey("intervention");
  });

  test("interconnectors as they were in 2024, before NSW1-SA1", () => {
    expect(Object.keys(first.interconnectors).sort()).toEqual([
      "N-Q-MNSP1",
      "NSW1-QLD1",
      "T-V-MNSP1",
      "V-S-MNSP1",
      "V-SA",
      "VIC1-NSW1",
    ]);
    expect(first.interconnectors["NSW1-QLD1"]).toEqual({ mwFlow: 302.24, exportLimit: 381.87, importLimit: -842.11 });
  });

  test("a single table on its own is not enough", () => {
    expect(() => buildIntervals(read("DISPATCHREGIONSUM"))).toThrow("DISPATCH.PRICE: table not found");
  });
});

// Real rows from the March 2026 MMSDM archive: NSW1's market suspension with schedule pricing
// started at 11:45 on 2026-03-23 (AEMO suspension 202603231145.1)
describe("buildIntervals on the 2026-03-23 NSW market suspension", () => {
  const read = (table: string) =>
    parseAemoCsv(readFileSync(join(import.meta.dir, `fixtures/mmsdm/${table}_202603.CSV`), "utf8"));
  const [start, later] = buildIntervals(
    new Map([...read("DISPATCHPRICE"), ...read("DISPATCHREGIONSUM"), ...read("DISPATCHINTERCONNECTORRES")]),
  );

  test("NSW1 is suspended with schedule pricing; the other regions are not", () => {
    expect(start.t).toBe("2026-03-23T11:45:00+10:00");
    expect(start.regions.NSW1.suspension).toBe("schedule");
    expect(start.regions.QLD1).not.toContainKey("suspension");
  });

  test("VIC1's price was scaled by a loss factor during the suspension", () => {
    expect(later.t).toBe("2026-03-23T13:40:00+10:00");
    expect(later.regions.VIC1.priceFlags).toBe(16);
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

  test("the interval is flagged as an intervention", () => {
    expect(interval.intervention).toBe(true);
  });

  test("an INTERVENTION=1 row in any one table is enough", () => {
    const [flagged] = parseDispatchIsCsv(
      dispatchCsv(t, { interconnector: [valid.interconnector[0], { ...valid.interconnector[0], INTERVENTION: "1" }] }),
    );
    expect(flagged.intervention).toBe(true);
  });

  test("a normal interval has no intervention key", () => {
    expect(parseDispatchIsCsv(dispatchCsv(t))[0]).not.toContainKey("intervention");
  });
});

describe("price flags", () => {
  const t = "2026/10/24 15:05:00";
  const valid = validRows(t);
  const withSa = (overrides: Record<string, string>) =>
    parseDispatchIsCsv(
      dispatchCsv(t, { price: valid.price.map((r) => (r.REGIONID === "SA1" ? { ...r, ...overrides } : r)) }),
    )[0].regions;

  test("APCFLAG is kept as the raw bit field, on that region only", () => {
    const regions = withSa({ APCFLAG: "5" });
    expect(regions.SA1.priceFlags).toBe(5);
    expect(regions.NSW1).not.toContainKey("priceFlags");
  });

  test("a market suspension keeps its pricing regime", () => {
    expect(withSa({ MARKETSUSPENDEDFLAG: "1" }).SA1.suspension).toBe("dispatch");
    const regions = withSa({ MARKETSUSPENDEDFLAG: "2" });
    expect(regions.SA1.suspension).toBe("schedule");
    expect(regions.NSW1).not.toContainKey("suspension");
  });

  test("flags come from the pricing run, not the intervention run", () => {
    const sa = valid.price.find((r) => r.REGIONID === "SA1")!;
    const [interval] = parseDispatchIsCsv(
      dispatchCsv(t, {
        price: [...valid.price.filter((r) => r !== sa), sa, { ...sa, INTERVENTION: "1", APCFLAG: "1" }],
      }),
    );
    expect(interval.regions.SA1).not.toContainKey("priceFlags");
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
