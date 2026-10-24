export type Row = Record<string, string>;

export type Table = {
  version: number;
  rows: Row[];
};

export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * AEMO's report CSVs hold several tables in one file. Each row starts with a record type:
 *
 * - `C,...` comment (file header and footer)
 * - `I,<report>,<table>,<version>,<cols...>` column names for the D rows that follow
 * - `D,<report>,<table>,<version>,<vals...>` one data row
 */
/** Concatenates tables that share a key, as when MMSDM splits a large table into FILE01, FILE02, ... */
export function mergeTables(parts: Map<string, Table>[]): Map<string, Table> {
  const merged = new Map<string, Table>();
  for (const part of parts) {
    for (const [key, table] of part) {
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { version: table.version, rows: [...table.rows] });
      } else if (existing.version !== table.version) {
        throw new Error(`${key}: files disagree on the table version (${existing.version} and ${table.version})`);
      } else {
        existing.rows.push(...table.rows);
      }
    }
  }
  return merged;
}

export function parseAemoCsv(text: string): Map<string, Table> {
  const tables = new Map<string, Table>();
  const headers = new Map<string, string[]>();

  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const fields = splitCsvLine(line);
    const [type, report, table, version] = fields;
    if (type !== "I" && type !== "D") continue;

    const key = `${report}.${table}`;
    if (type === "I") {
      headers.set(key, fields.slice(4));
      tables.set(key, { version: Number(version), rows: tables.get(key)?.rows ?? [] });
      continue;
    }

    const columns = headers.get(key);
    if (!columns) throw new Error(`D row for ${key} before its I row`);
    const row: Row = {};
    columns.forEach((name, i) => {
      row[name] = fields[4 + i] ?? "";
    });
    tables.get(key)!.rows.push(row);
  }

  return tables;
}
