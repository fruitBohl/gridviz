import { useEffect, useState } from "react";
import { loadJson } from "@/lib/load";

/** Keeps the last data while a new URL loads, so the page can fade it instead of blanking. */
export function useJson<T>(url: string) {
  const [loaded, setLoaded] = useState<{ url: string; data: T }>();
  const [failed, setFailed] = useState<{ url: string; message: string }>();

  useEffect(() => {
    let cancelled = false;
    loadJson<T>(url).then(
      (data) => {
        if (cancelled) return;
        setLoaded({ url, data });
        setFailed(undefined);
      },
      (err: Error) => !cancelled && setFailed({ url, message: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const error = failed?.url === url ? failed.message : undefined;
  return { data: loaded?.data, error, loading: !error && loaded?.url !== url };
}
