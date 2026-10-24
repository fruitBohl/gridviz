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
