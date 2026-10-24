import { Check, Loader2 } from "lucide-react";

import type { IngestStep } from "@/lib/api/types";
import { INGEST_STEPS } from "@/lib/knowledge/api";
import { cn } from "@/lib/utils";

const LABELS: Record<IngestStep, string> = { summarise: "Summarise", tag: "Tag", embed: "Embed", save: "Save" };

/** Real progress: a check appears as each `step` event arrives; the next step shows a spinner while running. */
export function IngestSteps({ done, running }: { done: IngestStep[]; running: boolean }) {
  const activeStep = running ? INGEST_STEPS.find((s) => !done.includes(s)) : undefined;
  return (
    <ol aria-label="Progress" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {INGEST_STEPS.map((step, i) => {
        const complete = done.includes(step);
        return (
          <li
            key={step}
            data-state={complete ? "done" : step === activeStep ? "active" : "pending"}
            className={cn("flex items-center gap-1.5", complete ? "text-muted-foreground" : "text-muted-foreground/60")}
          >
            {i > 0 && (
              <span aria-hidden className="mr-0.5">
                ·
              </span>
            )}
            {complete ? (
              <Check aria-hidden className="size-4 text-success" />
            ) : step === activeStep ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <span aria-hidden className="size-4" />
            )}
            {LABELS[step]}
            <span className="sr-only">{complete ? "done" : step === activeStep ? "in progress" : "pending"}</span>
          </li>
        );
      })}
    </ol>
  );
}
