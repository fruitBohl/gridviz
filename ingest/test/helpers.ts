import { strToU8, zipSync } from "fflate";

type Rows = Record<string, string>[];

export type CsvParts = {
  versions?: Partial<Record<"PRICE" | "REGIONSUM" | "INTERCONNECTORRES", number>>;
  columns?: Partial<Record<"PRICE" | "REGIONSUM" | "INTERCONNECTORRES", string[]>>;
  price?: Rows;
  regionSum?: Rows;
  interconnector?: Rows;
};

const REGIONS = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"];

// The column subset the parser reads, in AEMO's order
export const COLUMNS = {
  PRICE: ["SETTLEMENTDATE", "REGIONID", "INTERVENTION", "RRP"],
  REGIONSUM: ["SETTLEMENTDATE", "REGIONID", "INTERVENTION", "TOTALDEMAND", "AVAILABLEGENERATION", "NETINTERCHANGE"],
  INTERCONNECTORRES: ["SETTLEMENTDATE", "INTERCONNECTORID", "INTERVENTION", "MWFLOW", "EXPORTLIMIT", "IMPORTLIMIT"],
};

// Complete, valid rows for one interval ending at `aemoTime` ("2026/10/24 15:05:00")
export function validRows(aemoTime: string, price = "50"): Required<Omit<CsvParts, "versions" | "columns">> {
  return {
    price: REGIONS.map((REGIONID) => ({ SETTLEMENTDATE: aemoTime, REGIONID, INTERVENTION: "0", RRP: price })),
    regionSum: REGIONS.map((REGIONID) => ({
      SETTLEMENTDATE: aemoTime,
      REGIONID,
      INTERVENTION: "0",
      TOTALDEMAND: "5000",
      AVAILABLEGENERATION: "9000",
      NETINTERCHANGE: "0",
    })),
    interconnector: [
      {
        SETTLEMENTDATE: aemoTime,
        INTERCONNECTORID: "V-SA",
        INTERVENTION: "0",
        MWFLOW: "100",
        EXPORTLIMIT: "600",
        IMPORTLIMIT: "-500",
      },
    ],
  };
}

function table(name: keyof typeof COLUMNS, version: number, rows: Rows, columns = COLUMNS[name]): string[] {
  const quote = (v: string) => (v.includes("/") ? `"${v}"` : v);
  return [
    `I,DISPATCH,${name},${version},${columns.join(",")}`,
    ...rows.map((r) => `D,DISPATCH,${name},${version},${columns.map((c) => quote(r[c] ?? "")).join(",")}`),
  ];
}

export function dispatchCsv(aemoTime: string, parts: CsvParts = {}): string {
  const { versions, columns, ...overrides } = parts;
  const rows = { ...validRows(aemoTime), ...overrides };
  const v = { PRICE: 5, REGIONSUM: 9, INTERCONNECTORRES: 3, ...versions };
  return [
    "C,NEMP.WORLD,DISPATCHIS,AEMO,PUBLIC",
    ...table("PRICE", v.PRICE, rows.price, columns?.PRICE),
    ...table("REGIONSUM", v.REGIONSUM, rows.regionSum, columns?.REGIONSUM),
    ...table("INTERCONNECTORRES", v.INTERCONNECTORRES, rows.interconnector, columns?.INTERCONNECTORRES),
    'C,"END OF REPORT"',
  ].join("\r\n");
}

export const dispatchZip = (aemoTime: string, parts?: CsvParts) =>
  zipSync({ "PUBLIC_DISPATCHIS.CSV": strToU8(dispatchCsv(aemoTime, parts)) });
