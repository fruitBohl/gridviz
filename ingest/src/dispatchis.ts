import { strFromU8, unzipSync } from "fflate";
import { parseAemoCsv, type Table } from "./csv";
import { AemoFormatError, DISPATCHIS_TABLES, NEM_REGIONS, readTable } from "./schema";

export type RegionInterval = {
  price: number; // RRP, $/MWh
  demand: number; // TOTALDEMAND, MW
  availableGeneration: number; // MW
  netInterchange: number; // MW, positive = exporting
  /** APCFLAG bits, only when non-zero; see PRICE_FLAGS. */
  priceFlags?: number;
  suspended?: true;
};

/**
 * APCFLAG bits: how the dispatch price differs from the original price (ROP) the dispatch
 * algorithm calculated. From AEMO's MMS data model, DISPATCHPRICE, checked 2026-10-24.
 */
export const PRICE_FLAGS = {
  administeredPrice: 1, // an administered price cap or floor was binding
  vollOverride: 2,
  priceLimit: 4, // the market price cap or floor was binding
  manualPrice: 8,
  lossFactorScaling: 16, // price scaled by an inter-regional loss factor
} as const;

export type InterconnectorInterval = {
  mwFlow: number; // MW, positive = flowing in the direction of the ID (e.g. NSW1 -> QLD1)
  exportLimit: number;
  importLimit: number;
};

/** One 5-minute dispatch interval. */
export type DispatchInterval = {
  t: string; // interval end, market time (AEST, UTC+10)
  regions: Record<string, RegionInterval>;
  interconnectors: Record<string, InterconnectorInterval>;
  /** AEMO ran an intervention: price is from the pricing run, quantities from what was physically dispatched. */
  intervention?: true;
};

type Run = { SETTLEMENTDATE: string; INTERVENTION: "0" | "1" };

/**
 * During an intervention AEMO publishes two runs. INTERVENTION=0 is the pricing run, so
 * prices come from it. INTERVENTION=1 is what was physically dispatched, so quantities
 * use it when present.
 */
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

/**
 * Needs the PRICE, REGIONSUM and INTERCONNECTORRES tables. DispatchIS files hold all three; the
 * MMSDM monthly archive has one table per file, so parse each and merge the maps first.
 */
export function buildIntervals(tables: Map<string, Table>): DispatchInterval[] {
  const intervals = new Map<string, DispatchInterval>();
  const interval = (t: string) => {
    let found = intervals.get(t);
    if (!found) {
      found = { t, regions: {}, interconnectors: {} };
      intervals.set(t, found);
    }
    return found;
  };

  const priceRows = readTable(tables, DISPATCHIS_TABLES.price);
  const sumRows = readTable(tables, DISPATCHIS_TABLES.regionSum);
  const flowRows = readTable(tables, DISPATCHIS_TABLES.interconnector);

  const prices = pick(
    priceRows.filter((r) => r.INTERVENTION === "0"),
    (r) => r.REGIONID,
    "0",
  );
  const sums = pick(sumRows, (r) => r.REGIONID, "1");

  for (const row of sums.values()) {
    const price = prices.get(`${row.SETTLEMENTDATE}|${row.REGIONID}`);
    if (!price) throw new AemoFormatError(`No pricing-run price for ${row.REGIONID} at ${row.SETTLEMENTDATE}`);
    interval(row.SETTLEMENTDATE).regions[row.REGIONID] = {
      price: price.RRP,
      demand: row.TOTALDEMAND,
      availableGeneration: row.AVAILABLEGENERATION,
      netInterchange: row.NETINTERCHANGE,
      ...(price.APCFLAG !== 0 && { priceFlags: price.APCFLAG }),
      ...(price.MARKETSUSPENDEDFLAG === "1" && { suspended: true }),
    };
  }

  const flows = pick(flowRows, (r) => r.INTERCONNECTORID, "1");
  for (const row of flows.values()) {
    interval(row.SETTLEMENTDATE).interconnectors[row.INTERCONNECTORID] = {
      mwFlow: row.MWFLOW,
      exportLimit: row.EXPORTLIMIT,
      importLimit: row.IMPORTLIMIT,
    };
  }

  for (const row of [...priceRows, ...sumRows, ...flowRows]) {
    if (row.INTERVENTION === "1") interval(row.SETTLEMENTDATE).intervention = true;
  }

  for (const { t, regions, interconnectors } of intervals.values()) {
    const missing = NEM_REGIONS.filter((r) => !(r in regions));
    if (missing.length > 0) throw new AemoFormatError(`${t}: no data for ${missing.join(", ")}`);
    if (Object.keys(interconnectors).length === 0) throw new AemoFormatError(`${t}: no interconnector flows`);
  }

  return [...intervals.values()].sort((a, b) => a.t.localeCompare(b.t));
}

export function parseDispatchIsCsv(text: string): DispatchInterval[] {
  return buildIntervals(parseAemoCsv(text));
}

export function parseDispatchIsZip(zip: Uint8Array): DispatchInterval[] {
  const entries = Object.entries(unzipSync(zip));
  const csv = entries.find(([name]) => name.toUpperCase().endsWith(".CSV"));
  if (!csv) throw new AemoFormatError("No CSV in DispatchIS zip");
  return parseDispatchIsCsv(strFromU8(csv[1]));
}
