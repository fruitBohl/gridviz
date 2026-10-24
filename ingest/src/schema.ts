import { z } from "zod";
import type { Table } from "./csv";

export class AemoFormatError extends Error {
  override name = "AemoFormatError";
}

export const NEM_REGIONS = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"] as const;

/** AEMO timestamps are market time: AEST all year, no daylight saving. */
export function aemoTimeToIso(value: string): string {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new AemoFormatError(`Unexpected AEMO timestamp: ${value}`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+10:00`;
}

const aemoTime = z
  .string()
  .regex(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/, "expected YYYY/MM/DD HH:MM:SS")
  .transform(aemoTimeToIso);

const aemoNumber = (check = z.number()) =>
  z
    .string()
    .trim()
    .min(1, "empty value")
    .transform(Number)
    .pipe(check)
    .transform((v) => Math.round(v * 100) / 100);

const intervention = z.enum(["0", "1"]);

const priceRow = z.object({
  SETTLEMENTDATE: aemoTime,
  REGIONID: z.enum(NEM_REGIONS),
  INTERVENTION: intervention,
  RRP: aemoNumber(z.number().min(-1000, "below the -$1000/MWh market price floor")),
  APCFLAG: z.string().regex(/^\d+$/, "expected a bit field").transform(Number).pipe(z.number().max(31)),
  MARKETSUSPENDEDFLAG: z.enum(["0", "1"]),
});

const regionSumRow = z.object({
  SETTLEMENTDATE: aemoTime,
  REGIONID: z.enum(NEM_REGIONS),
  INTERVENTION: intervention,
  TOTALDEMAND: aemoNumber(),
  AVAILABLEGENERATION: aemoNumber(z.number().min(0)),
  NETINTERCHANGE: aemoNumber(),
});

const interconnectorRow = z.object({
  SETTLEMENTDATE: aemoTime,
  // Not an enum: new links (like NSW1-SA1) get added over time
  INTERCONNECTORID: z.string().regex(/^[A-Z0-9-]+$/, "unexpected interconnector ID"),
  INTERVENTION: intervention,
  MWFLOW: aemoNumber(),
  EXPORTLIMIT: aemoNumber(),
  IMPORTLIMIT: aemoNumber(),
});

type TableSpec<S extends z.ZodType> = { key: string; versions: number[]; row: S };

/**
 * EMMS data model table versions, checked 2026-10-24. A new version can rename or drop columns.
 * REGIONSUM v8 is in the MMSDM monthly archive for 2024; current DispatchIS reports send v9.
 */
export const DISPATCHIS_TABLES = {
  price: { key: "DISPATCH.PRICE", versions: [5], row: priceRow },
  regionSum: { key: "DISPATCH.REGIONSUM", versions: [8, 9], row: regionSumRow },
  interconnector: { key: "DISPATCH.INTERCONNECTORRES", versions: [3], row: interconnectorRow },
} satisfies Record<string, TableSpec<z.ZodType>>;

export const DISPATCHIS_COLUMNS = new Map(
  Object.values(DISPATCHIS_TABLES).map((spec) => [spec.key, Object.keys(spec.row.shape)] as const),
);

/** AEMO adds columns in data model releases, so unknown columns are allowed (Zod drops them). */
export function readTable<S extends z.ZodType>(
  tables: Map<string, Table>,
  spec: TableSpec<S>,
): z.output<S>[] {
  const table = tables.get(spec.key);
  if (!table) throw new AemoFormatError(`${spec.key}: table not found`);
  if (!spec.versions.includes(table.version)) {
    throw new AemoFormatError(
      `${spec.key}: AEMO sent version ${table.version}, the parser accepts ${spec.versions.join(" or ")}. ` +
        "Check the EMMS data model release notes, then update ingest/src/schema.ts",
    );
  }
  if (table.rows.length === 0) throw new AemoFormatError(`${spec.key}: no rows`);

  const parsed = z.array(spec.row).safeParse(table.rows);
  if (!parsed.success) {
    throw new AemoFormatError(`${spec.key}: rows don't match the schema\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
