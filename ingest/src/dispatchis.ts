import { strFromU8, unzipSync } from "fflate";
import { parseAemoCsv, type Row, type Table } from "./csv";

// One 5-minute dispatch interval. `t` is the interval end in market time (AEST, UTC+10).
export type RegionInterval = {
  price: number; // RRP, $/MWh
  demand: number; // TOTALDEMAND, MW
  availableGeneration: number; // MW
  netInterchange: number; // MW, positive = exporting
};

export type InterconnectorInterval = {
  mwFlow: number; // MW, positive = flowing in the direction of the ID (e.g. NSW1 -> QLD1)
  exportLimit: number;
  importLimit: number;
};

export type DispatchInterval = {
  t: string;
  regions: Record<string, RegionInterval>;
  interconnectors: Record<string, InterconnectorInterval>;
};

// "2026/10/24 15:05:00" -> "2026-10-24T15:05:00+10:00"
export function aemoTimeToIso(value: string): string {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Unexpected AEMO timestamp: ${value}`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+10:00`;
}

function num(row: Row, column: string): number {
  const raw = row[column];
  if (raw === undefined) throw new Error(`Missing column ${column}`);
  const value = Number(raw);
  if (raw === "" || !Number.isFinite(value)) throw new Error(`Bad number in ${column}: "${raw}"`);
  return Math.round(value * 100) / 100;
}

function rowsOf(tables: Map<string, Table>, key: string): Row[] {
  const table = tables.get(key);
  if (!table) throw new Error(`Table ${key} not found`);
  return table.rows;
}

// During an intervention AEMO publishes two runs. INTERVENTION=0 is the pricing run, so
// prices come from it. INTERVENTION=1 is what was physically dispatched, so quantities
// use it when present.
function pick(rows: Row[], idColumn: string, prefer: "0" | "1"): Map<string, Row> {
  const chosen = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.SETTLEMENTDATE}|${row[idColumn]}`;
    const current = chosen.get(key);
    if (!current || (row.INTERVENTION === prefer && current.INTERVENTION !== prefer)) {
      chosen.set(key, row);
    }
  }
  return chosen;
}

export function parseDispatchIsCsv(text: string): DispatchInterval[] {
  const tables = parseAemoCsv(text);
  const intervals = new Map<string, DispatchInterval>();
  const interval = (settlementDate: string) => {
    const t = aemoTimeToIso(settlementDate);
    let found = intervals.get(t);
    if (!found) {
      found = { t, regions: {}, interconnectors: {} };
      intervals.set(t, found);
    }
    return found;
  };

  const prices = pick(
    rowsOf(tables, "DISPATCH.PRICE").filter((r) => r.INTERVENTION === "0"),
    "REGIONID",
    "0",
  );
  const sums = pick(rowsOf(tables, "DISPATCH.REGIONSUM"), "REGIONID", "1");

  for (const row of sums.values()) {
    const price = prices.get(`${row.SETTLEMENTDATE}|${row.REGIONID}`);
    if (!price) throw new Error(`No price for ${row.REGIONID} at ${row.SETTLEMENTDATE}`);
    interval(row.SETTLEMENTDATE).regions[row.REGIONID] = {
      price: num(price, "RRP"),
      demand: num(row, "TOTALDEMAND"),
      availableGeneration: num(row, "AVAILABLEGENERATION"),
      netInterchange: num(row, "NETINTERCHANGE"),
    };
  }

  const flows = pick(rowsOf(tables, "DISPATCH.INTERCONNECTORRES"), "INTERCONNECTORID", "1");
  for (const row of flows.values()) {
    interval(row.SETTLEMENTDATE).interconnectors[row.INTERCONNECTORID] = {
      mwFlow: num(row, "MWFLOW"),
      exportLimit: num(row, "EXPORTLIMIT"),
      importLimit: num(row, "IMPORTLIMIT"),
    };
  }

  return [...intervals.values()].sort((a, b) => a.t.localeCompare(b.t));
}

// A DispatchIS zip holds a single CSV
export function parseDispatchIsZip(zip: Uint8Array): DispatchInterval[] {
  const entries = Object.entries(unzipSync(zip));
  const csv = entries.find(([name]) => name.toUpperCase().endsWith(".CSV"));
  if (!csv) throw new Error("No CSV in DispatchIS zip");
  return parseDispatchIsCsv(strFromU8(csv[1]));
}
