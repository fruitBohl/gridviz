export const DISPATCHIS_URL = "https://nemweb.com.au/Reports/Current/DispatchIS_Reports/";

const USER_AGENT = "gridviz (+https://andyouandyou.com)";

export type ReportFile = {
  name: string; // PUBLIC_DISPATCHIS_202610241505_0000000544621747.zip
  url: string;
  settlementDate: string; // interval end, ISO in AEST: 2026-10-24T15:05:00+10:00
};

const FILE_NAME = /PUBLIC_DISPATCHIS_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_(\d+)\.zip/i;

export function settlementFromName(name: string): string {
  const m = FILE_NAME.exec(name);
  if (!m) throw new Error(`Not a DispatchIS file name: ${name}`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+10:00`;
}

// The directory listing is plain HTML with one <A HREF="..."> per file. If AEMO ever
// republishes an interval, the higher sequence number (last part of the name) wins.
export function parseListing(html: string, baseUrl = DISPATCHIS_URL): ReportFile[] {
  const bySettlement = new Map<string, { file: ReportFile; seq: bigint }>();
  for (const [, href] of html.matchAll(/href="([^"]+)"/gi)) {
    const name = href.split("/").pop()!;
    const m = FILE_NAME.exec(name);
    if (!m) continue;
    const file = { name, url: new URL(href, baseUrl).toString(), settlementDate: settlementFromName(name) };
    const seq = BigInt(m[6]);
    const existing = bySettlement.get(file.settlementDate);
    if (!existing || seq > existing.seq) bySettlement.set(file.settlementDate, { file, seq });
  }
  return [...bySettlement.values()]
    .map(({ file }) => file)
    .sort((a, b) => a.settlementDate.localeCompare(b.settlementDate));
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res;
}

export async function fetchListing(url = DISPATCHIS_URL): Promise<ReportFile[]> {
  return parseListing(await (await get(url)).text(), url);
}

export async function fetchFile(file: ReportFile): Promise<Uint8Array> {
  return new Uint8Array(await (await get(file.url)).arrayBuffer());
}
