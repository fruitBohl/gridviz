import { useEffect, useRef, useState } from "react";
import type { Data, Layout } from "plotly.js-dist-min";

export type Figure = { traces: Data[]; layout: Partial<Layout> };

/** Plotly is about 3.5 MB, so it loads here, in the browser, and only on pages that draw a chart. */
export function usePlotly(figure: Figure | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const div = ref.current;
    if (!figure || !div) return;
    let cancelled = false;
    (async () => {
      try {
        const Plotly = (await import("plotly.js-dist-min")).default;
        if (cancelled) return;
        await Plotly.react(div, figure.traces, figure.layout, {
          responsive: true,
          displaylogo: false,
          doubleClick: "reset+autosize",
          modeBarButtonsToRemove: ["lasso2d", "select2d"],
        });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [figure]);

  useEffect(() => {
    const div = ref.current;
    return () => {
      if (div) import("plotly.js-dist-min").then(({ default: Plotly }) => Plotly.purge(div));
    };
  }, []);

  return { ref, error };
}
