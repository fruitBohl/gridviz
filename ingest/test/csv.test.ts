import { describe, expect, test } from "bun:test";
import { parseAemoCsv, splitCsvLine } from "../src/csv";

describe("splitCsvLine", () => {
  test("plain and quoted fields", () => {
    expect(splitCsvLine('D,DISPATCH,PRICE,5,"2026/10/24 15:05:00",1,NSW1')).toEqual([
      "D",
      "DISPATCH",
      "PRICE",
      "5",
      "2026/10/24 15:05:00",
      "1",
      "NSW1",
    ]);
  });

  test("commas and escaped quotes inside quotes, empty fields", () => {
    expect(splitCsvLine('a,"b,c","say ""hi""",,')).toEqual(["a", "b,c", 'say "hi"', "", ""]);
  });
});

describe("parseAemoCsv", () => {
  const text = [
    "C,NEMP.WORLD,DISPATCHIS,AEMO,PUBLIC",
    "I,DISPATCH,PRICE,5,SETTLEMENTDATE,REGIONID,RRP",
    'D,DISPATCH,PRICE,5,"2026/10/24 15:05:00",NSW1,87.7',
    'D,DISPATCH,PRICE,5,"2026/10/24 15:05:00",SA1,-5.22',
    "I,DISPATCH,REGIONSUM,9,SETTLEMENTDATE,REGIONID,TOTALDEMAND",
    'D,DISPATCH,REGIONSUM,9,"2026/10/24 15:05:00",NSW1,5821.2',
    'C,"END OF REPORT",6',
    "",
  ].join("\r\n");

  test("groups rows by table and names columns from the I row", () => {
    const tables = parseAemoCsv(text);
    expect([...tables.keys()]).toEqual(["DISPATCH.PRICE", "DISPATCH.REGIONSUM"]);
    expect(tables.get("DISPATCH.PRICE")!.version).toBe(5);
    expect(tables.get("DISPATCH.PRICE")!.rows[1]).toEqual({
      SETTLEMENTDATE: "2026/10/24 15:05:00",
      REGIONID: "SA1",
      RRP: "-5.22",
    });
    expect(tables.get("DISPATCH.REGIONSUM")!.rows).toHaveLength(1);
  });

  test("keep limits parsing to the listed tables and columns", () => {
    const tables = parseAemoCsv(text, new Map([["DISPATCH.PRICE", ["REGIONID", "RRP", "NOTACOLUMN"]]]));
    expect([...tables.keys()]).toEqual(["DISPATCH.PRICE"]);
    expect(tables.get("DISPATCH.PRICE")!.rows[1]).toStrictEqual({ REGIONID: "SA1", RRP: "-5.22" });
  });

  test("a D row without its I row is an error", () => {
    expect(() => parseAemoCsv("D,DISPATCH,PRICE,5,x")).toThrow("before its I row");
  });
});
