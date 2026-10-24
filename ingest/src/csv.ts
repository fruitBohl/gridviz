// AEMO's report CSVs hold several tables in one file. Each row starts with a record type:
//   C,...                                  comment (file header and footer)
//   I,<report>,<table>,<version>,<cols...> column names for the D rows that follow
//   D,<report>,<table>,<version>,<vals...> one data row
// Columns are always looked up by name: data model releases add columns between versions.

export type Row = Record<string, string>;

export type Table = {
  version: number;
  rows: Row[];
};

// Split one CSV line, honouring double quotes ("" is an escaped quote inside a quoted field)
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

// Tables keyed by "<REPORT>.<TABLE>", e.g. "DISPATCH.PRICE"
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
