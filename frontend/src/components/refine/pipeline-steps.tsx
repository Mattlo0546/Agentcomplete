import { StatusDot, type DotTone } from "@/components/common/status-dot";
import { TagChip } from "@/components/common/tag-chip";
import type { StepName, Trace } from "@/lib/api/types";
import { formatLatency, formatScore } from "@/lib/format";

const STEP_LABELS: Record<StepName, string> = {
  tags: "Tags",
  retrieve: "Retrieve",
  judge: "Judge",
  generate: "Generate",
};
const ORDER: StepName[] = ["tags", "retrieve", "judge", "generate"];
const TONE: Record<Trace["steps"][number]["status"], DotTone> = { ok: "ok", error: "err", skipped: "mute" };

/** design.md §4.5 "Pipeline": four steps with status dot, model · detail and latency; Tags lists chips. */
export function PipelineSteps({ trace }: { trace: Trace }) {
  const steps = [...trace.steps].sort((a, b) => ORDER.indexOf(a.step) - ORDER.indexOf(b.step));
  return (
    <section aria-labelledby="pipeline-label">
      <h2 id="pipeline-label" className="mb-1 text-label">
        Pipeline
      </h2>
      <ol>
        {steps.map((step) => (
          <li key={step.step} className="grid grid-cols-[14px_1fr_auto] items-start gap-2.5 py-2">
            <span className="pt-1.5">
              <StatusDot tone={TONE[step.status]} />
            </span>
            <div className="min-w-0">
              <div className="font-medium">
                {STEP_LABELS[step.step]}
                <span className="sr-only"> {step.status}</span>
              </div>
              <div className="text-data">{[step.model, step.detail].filter(Boolean).join(" · ")}</div>
              {step.step === "tags" && trace.tags.length > 0 && (
                <ul aria-label="Extracted tags" className="mt-2 flex flex-wrap gap-1.5">
                  {trace.tags.map((tag) => (
                    <li key={tag.name}>
                      <TagChip name={tag.name} meta={formatScore(tag.similarity)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <span className="text-data">{step.status === "skipped" ? "—" : formatLatency(step.latency_ms)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
