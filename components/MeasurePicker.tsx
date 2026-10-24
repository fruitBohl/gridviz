import { METRICS, type Metric } from "@/ingest/src/aggregate";
import { CHARTS, seriesName, shortSeriesName } from "@/lib/nem";
import { RadioGroup } from "./RadioGroup";

export function MeasurePicker({
  metric,
  onMetric,
  ids,
  id,
  onId,
  children,
}: {
  metric: Metric;
  onMetric: (metric: Metric) => void;
  ids: string[];
  id: string | undefined;
  onId: (id: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <RadioGroup
          label="Measure"
          options={METRICS.map((m) => ({ value: m, label: CHARTS.find((c) => c.metric === m)!.title }))}
          value={metric}
          onChange={onMetric}
        />
        {children}
      </div>
      {id && <RadioGroup label="Series" options={ids.map((i) => ({ value: i, label: shortSeriesName(i), title: seriesName(i) }))} value={id} onChange={onId} />}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{CHARTS.find((c) => c.metric === metric)!.note}</p>
    </>
  );
}
