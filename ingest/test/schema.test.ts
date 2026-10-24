import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { parseDispatchIsCsv, parseDispatchIsZip } from "../src/dispatchis";
import { aemoTimeToIso, AemoFormatError } from "../src/schema";
import { COLUMNS, dispatchCsv, validRows } from "./helpers";

const t = "2026/10/24 15:05:00";
const valid = validRows(t);
const withRow = <K extends "price" | "regionSum" | "interconnector">(key: K, overrides: Record<string, string>) => ({
  [key]: valid[key].map((r, i) => (i === 0 ? { ...r, ...overrides } : r)),
});

function formatError(csv: string): AemoFormatError {
  try {
    parseDispatchIsCsv(csv);
  } catch (err) {
    expect(err).toBeInstanceOf(AemoFormatError);
    return err as AemoFormatError;
  }
  throw new Error("expected an AemoFormatError");
}

test("a valid file parses", () => {
  expect(parseDispatchIsCsv(dispatchCsv(t))).toHaveLength(1);
});

describe("table structure", () => {
  test("a table version bump", () => {
    const err = formatError(dispatchCsv(t, { versions: { REGIONSUM: 10 } }));
    expect(err.message).toContain("DISPATCH.REGIONSUM: AEMO sent version 10, the parser accepts 8 or 9");
  });

  test("REGIONSUM v8, as in the 2024 MMSDM archive, is accepted", () => {
    expect(parseDispatchIsCsv(dispatchCsv(t, { versions: { REGIONSUM: 8 } }))).toHaveLength(1);
  });

  test("an older REGIONSUM version is rejected", () => {
    const err = formatError(dispatchCsv(t, { versions: { REGIONSUM: 7 } }));
    expect(err.message).toContain("DISPATCH.REGIONSUM: AEMO sent version 7, the parser accepts 8 or 9");
  });

  test("a missing table", () => {
    const csv = dispatchCsv(t).replaceAll("INTERCONNECTORRES", "INTERCONNECTORRES_V2");
    expect(formatError(csv).message).toContain("DISPATCH.INTERCONNECTORRES: table not found");
  });

  test("a renamed column", () => {
    const columns = COLUMNS.PRICE.map((c) => (c === "RRP" ? "REGIONAL_PRICE" : c));
    const err = formatError(dispatchCsv(t, { columns: { PRICE: columns } }));
    expect(err.message).toContain("DISPATCH.PRICE: rows don't match the schema");
    expect(err.message).toContain("RRP");
  });

  test("extra columns are fine", () => {
    const columns = [...COLUMNS.REGIONSUM, "SOMENEWCOLUMN"];
    expect(parseDispatchIsCsv(dispatchCsv(t, { columns: { REGIONSUM: columns } }))).toHaveLength(1);
  });
});

describe("field values", () => {
  test.each([
    ["an empty number", "regionSum", { TOTALDEMAND: "" }, "TOTALDEMAND"],
    ["a non-numeric number", "interconnector", { MWFLOW: "n/a" }, "MWFLOW"],
    ["a price below the market floor", "price", { RRP: "-1000.01" }, "market price floor"],
    ["negative available generation", "regionSum", { AVAILABLEGENERATION: "-1" }, "AVAILABLEGENERATION"],
    ["an unknown region", "price", { REGIONID: "WA1" }, "REGIONID"],
    ["an unknown INTERVENTION flag", "regionSum", { INTERVENTION: "2" }, "INTERVENTION"],
    ["a reformatted timestamp", "price", { SETTLEMENTDATE: "2026-10-24T15:05:00" }, "YYYY/MM/DD HH:MM:SS"],
    ["a malformed interconnector ID", "interconnector", { INTERCONNECTORID: "vic sa" }, "interconnector ID"],
    ["a non-integer APCFLAG", "price", { APCFLAG: "0.5" }, "bit field"],
    ["an APCFLAG with an unknown bit", "price", { APCFLAG: "32" }, "APCFLAG"],
    ["an unknown MARKETSUSPENDEDFLAG", "price", { MARKETSUSPENDEDFLAG: "Y" }, "MARKETSUSPENDEDFLAG"],
  ] as const)("%s", (_, key, overrides, expected) => {
    expect(formatError(dispatchCsv(t, withRow(key, overrides))).message).toContain(expected);
  });

  test("the error says which row failed", () => {
    expect(formatError(dispatchCsv(t, withRow("regionSum", { TOTALDEMAND: "" }))).message).toMatch(
      /at \[0\]\.TOTALDEMAND/,
    );
  });

  test("the market floor itself is accepted", () => {
    const [interval] = parseDispatchIsCsv(dispatchCsv(t, withRow("price", { RRP: "-1000" })));
    expect(interval.regions.NSW1.price).toBe(-1000);
  });
});

test("a zip without a CSV", () => {
  expect(() => parseDispatchIsZip(zipSync({ "readme.txt": strToU8("hi") }))).toThrow(AemoFormatError);
});

test("aemoTimeToIso", () => {
  expect(aemoTimeToIso("2026/10/25 00:00:00")).toBe("2026-10-25T00:00:00+10:00");
  expect(() => aemoTimeToIso("2026-10-25 00:00")).toThrow(AemoFormatError);
});
