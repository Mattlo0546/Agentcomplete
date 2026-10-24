"use client";

import { formatDay, formatLatency, formatCount, formatPct } from "@/lib/format";
import { useStats } from "@/lib/activity/queries";
import { cn } from "@/lib/utils";

function Figure({ value, label, first }: { value: string; label: string; first?: boolean }) {
  return (
    <div className={cn("min-w-0 py-1 md:px-6", first ? "md:pl-0" : "md:border-l md:border-border")}>
      <div className="text-title text-2xl leading-8 tabular-nums">{value}</div>
      <div className="text-label">{label}</div>
    </div>
  );
}

/** design.md §4.12: stat figures in a row, hairline separated; wraps to two columns when narrow. */
export function OutcomeSummary() {
  const { data } = useStats();
  const classifier = data?.classifier ?? null;
  return (
    <section
      aria-label="Outcome summary"
      className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border pb-5 md:flex md:gap-0"
    >
      <Figure first value={data ? formatCount(data.suggestions) : "—"} label="Suggestions" />
      <Figure value={data ? formatPct(data.accepted_pct) : "—"} label="Accepted" />
      <Figure value={data ? formatPct(data.declined_pct) : "—"} label="Declined" />
      <Figure value={formatLatency(data?.p50_latency_ms)} label="p50 latency" />
      <Figure
        value={classifier ? classifier.auc.toFixed(2) : "—"}
        label={`Classifier AUC · ${classifier ? formatDay(classifier.trained_at) : "—"}`}
      />
    </section>
  );
}
