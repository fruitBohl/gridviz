import { dayKey, type DayFile } from "@/ingest/src/output";

const loaded = new Map<string, Promise<unknown>>();

/** Fetches each URL once per page load; a failed fetch is retried next time. */
export function loadJson<T>(url: string): Promise<T> {
  let found = loaded.get(url);
  if (!found) {
    found = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return res.json();
    });
    found.catch(() => loaded.delete(url));
    loaded.set(url, found);
  }
  return found as Promise<T>;
}

/** Today's file changes every 5 minutes, so it skips the browser cache. Missing days come back undefined. */
export async function fetchDay(date: string, today: string): Promise<DayFile | undefined> {
  const res = await fetch(`/${dayKey(date)}`, date === today ? { cache: "no-store" } : {});
  if (res.status === 404 || res.status === 403) return undefined;
  if (!res.ok) throw new Error(`/${dayKey(date)} returned ${res.status}`);
  return (await res.json()) as DayFile;
}
