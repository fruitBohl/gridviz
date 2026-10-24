import { z } from "zod";
import type { Table } from "./csv";

// Everything that comes from AEMO is validated here before the rest of the ingest uses it.
// Any mismatch throws AemoFormatError, which fails the Lambda run instead of writing bad data.

export class AemoFormatError extends Error {
  override name = "AemoFormatError";
}

export const NEM_REGIONS = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"] as const;

// "2026/10/24 15:05:00" (AEST) -> "2026-10-24T15:05:00+10:00"
export function aemoTimeToIso(value: string): string {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new AemoFormatError(`Unexpected AEMO timestamp: ${value}`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+10:00`;
}

const aemoTime = z
  .string()
  .regex(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/, "expected YYYY/MM/DD HH:MM:SS")
  .transform(aemoTimeToIso);

// Numbers arrive as strings. An empty or non-numeric value is a format change, not a zero.
const aemoNumber = (check = z.number()) =>
  z
    .string()
    .trim()
    .min(1, "empty value")
    .transform(Number)
    .pipe(check)
    .transform((v) => Math.round(v * 100) / 100);

const intervention = z.enum(["0", "1"]);

// Unknown columns are dropped, so AEMO adding columns is fine. A missing or renamed column fails.
const priceRow = z.object({
  SETTLEMENTDATE: aemoTime,
  REGIONID: z.enum(NEM_REGIONS),
  INTERVENTION: intervention,
  RRP: aemoNumber(z.number().min(-1000, "below the -$1000/MWh market price floor")),
});

const regionSumRow = z.object({
  SETTLEMENTDATE: aemoTime,
  REGIONID: z.enum(NEM_REGIONS),
  INTERVENTION: intervention,
  TOTALDEMAND: aemoNumber(),
  AVAILABLEGENERATION: aemoNumber(z.number().min(0)),
  NETINTERCHANGE: aemoNumber(),
});

// Interconnector IDs aren't fixed: new links (like NSW1-SA1) get added over time
const interconnectorRow = z.object({
  SETTLEMENTDATE: aemoTime,
  INTERCONNECTORID: z.string().regex(/^[A-Z0-9-]+$/, "unexpected interconnector ID"),
  INTERVENTION: intervention,
  MWFLOW: aemoNumber(),
  EXPORTLIMIT: aemoNumber(),
  IMPORTLIMIT: aemoNumber(),
});

type TableSpec<S extends z.ZodType> = { key: string; version: number; row: S };

// Table versions the schemas above were written against (EMMS data model, checked 2026-10-24).
// A new version can rename or drop columns, so stop and check rather than guess.
export const DISPATCHIS_TABLES = {
  price: { key: "DISPATCH.PRICE", version: 5, row: priceRow },
  regionSum: { key: "DISPATCH.REGIONSUM", version: 9, row: regionSumRow },
  interconnector: { key: "DISPATCH.INTERCONNECTORRES", version: 3, row: interconnectorRow },
} satisfies Record<string, TableSpec<z.ZodType>>;

export function readTable<S extends z.ZodType>(
  tables: Map<string, Table>,
  spec: TableSpec<S>,
): z.output<S>[] {
  const table = tables.get(spec.key);
  if (!table) throw new AemoFormatError(`${spec.key}: table not found`);
  if (table.version !== spec.version) {
    throw new AemoFormatError(
      `${spec.key}: AEMO sent version ${table.version}, the parser expects ${spec.version}. ` +
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
