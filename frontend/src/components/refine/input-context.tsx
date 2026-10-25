"use client";

import { useId, useState } from "react";

import { KindIcon } from "@/components/common/kind-icon";
import { TagChip } from "@/components/common/tag-chip";
import type { Trace } from "@/lib/api/types";
import { formatScore } from "@/lib/format";

import { useTrace } from "./context-inspector";

/** Current input context stays visible even when the detailed inspector is closed. */
export function InputContext({ requestId }: { requestId: string | null }) {
  const trace = useTrace(requestId);
  const id = useId();
  const [previousTags, setPreviousTags] = useState<Pick<Trace, "request_id" | "tags"> | null>(null);

  // Retain the last tagged input within this draft, without fetching any additional traces.
  // Updating on a new trace during render prevents briefly displaying an older fallback.
  if (trace.data?.tags.length && trace.data.request_id !== previousTags?.request_id) {
    setPreviousTags({ request_id: trace.data.request_id, tags: trace.data.tags });
  }

  if (requestId === null) return null;
  if (trace.isPending) {
    return (
      <p role="status" className="text-[13px] text-muted-foreground">
        Loading input context…
      </p>
    );
  }
  if (trace.isError) {
    return (
      <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
        <p>Input context unavailable</p>
        <button type="button" onClick={() => trace.refetch()} className="underline underline-offset-4">
          Retry context
        </button>
      </div>
    );
  }

  const kept = trace.data.knowledge.filter((item) => item.kept);
  const tagsStatus = trace.data.steps.find((step) => step.step === "tags")?.status;
  const usingPreviousTags = trace.data.tags.length === 0 && tagsStatus === "skipped" && previousTags !== null;
  const tags = usingPreviousTags ? previousTags.tags : trace.data.tags;
  const emptyTags =
    tagsStatus === "skipped"
      ? "Tag generation skipped"
      : tagsStatus === "error"
        ? "Tag generation failed"
        : "No tags generated";

  return (
    <section aria-label="Input context" className="flex shrink-0 flex-col gap-4 border-t border-border pt-4">
      <section aria-labelledby={`${id}-tags`}>
        <h2 id={`${id}-tags`} className="mb-2 flex items-center gap-2 text-label">
          Input tags {usingPreviousTags && <span className="text-data">Previous input</span>}
        </h2>
        {tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag.name} className="max-w-full">
                <TagChip name={tag.name} className="h-auto min-h-[22px] max-w-full break-all whitespace-normal" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">{emptyTags}</p>
        )}
        {usingPreviousTags && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Tag generation skipped; previous tags are shown for reference.
          </p>
        )}
      </section>
      <section aria-labelledby={`${id}-knowledge`}>
        <h2 id={`${id}-knowledge`} className="mb-2 flex items-center gap-2 text-label">
          Knowledge kept <span className="text-data">{kept.length}</span>
        </h2>
        {kept.length > 0 ? (
          <ul className="divide-y divide-border">
            {kept.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
                <KindIcon kind={item.kind} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 font-mono text-[13px] wrap-break-word">{item.title}</span>
                <span className="text-data" aria-label={`Relevance ${formatScore(item.score)}`}>
                  {formatScore(item.score)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">No knowledge kept</p>
        )}
      </section>
    </section>
  );
}
