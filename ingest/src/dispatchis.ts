import { strFromU8, unzipSync } from "fflate";
import { parseAemoCsv } from "./csv";
import { AemoFormatError, DISPATCHIS_TABLES, NEM_REGIONS, readTable } from "./schema";

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

type Run = { SETTLEMENTDATE: string; INTERVENTION: "0" | "1" };

// During an intervention AEMO publishes two runs. INTERVENTION=0 is the pricing run, so
// prices come from it. INTERVENTION=1 is what was physically dispatched, so quantities
// use it when present.
function pick<R extends Run>(rows: R[], id: (row: R) => string, prefer: "0" | "1"): Map<string, R> {
  const chosen = new Map<string, R>();
  for (const row of rows) {
    const key = `${row.SETTLEMENTDATE}|${id(row)}`;
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
  const interval = (t: string) => {
    let found = intervals.get(t);
    if (!found) {
      found = { t, regions: {}, interconnectors: {} };
      intervals.set(t, found);
    }
    return found;
  };

  const prices = pick(
    readTable(tables, DISPATCHIS_TABLES.price).filter((r) => r.INTERVENTION === "0"),
    (r) => r.REGIONID,
    "0",
  );
  const sums = pick(readTable(tables, DISPATCHIS_TABLES.regionSum), (r) => r.REGIONID, "1");

  for (const row of sums.values()) {
    const price = prices.get(`${row.SETTLEMENTDATE}|${row.REGIONID}`);
    if (!price) throw new AemoFormatError(`No pricing-run price for ${row.REGIONID} at ${row.SETTLEMENTDATE}`);
    interval(row.SETTLEMENTDATE).regions[row.REGIONID] = {
      price: price.RRP,
      demand: row.TOTALDEMAND,
      availableGeneration: row.AVAILABLEGENERATION,
      netInterchange: row.NETINTERCHANGE,
    };
  }

  const flows = pick(readTable(tables, DISPATCHIS_TABLES.interconnector), (r) => r.INTERCONNECTORID, "1");
  for (const row of flows.values()) {
    interval(row.SETTLEMENTDATE).interconnectors[row.INTERCONNECTORID] = {
      mwFlow: row.MWFLOW,
      exportLimit: row.EXPORTLIMIT,
      importLimit: row.IMPORTLIMIT,
    };
  }

  // Every interval must be complete: all five regions and at least one interconnector
  for (const { t, regions, interconnectors } of intervals.values()) {
    const missing = NEM_REGIONS.filter((r) => !(r in regions));
    if (missing.length > 0) throw new AemoFormatError(`${t}: no data for ${missing.join(", ")}`);
    if (Object.keys(interconnectors).length === 0) throw new AemoFormatError(`${t}: no interconnector flows`);
  }

  return [...intervals.values()].sort((a, b) => a.t.localeCompare(b.t));
}

// A DispatchIS zip holds a single CSV
export function parseDispatchIsZip(zip: Uint8Array): DispatchInterval[] {
  const entries = Object.entries(unzipSync(zip));
  const csv = entries.find(([name]) => name.toUpperCase().endsWith(".CSV"));
  if (!csv) throw new AemoFormatError("No CSV in DispatchIS zip");
  return parseDispatchIsCsv(strFromU8(csv[1]));
}
