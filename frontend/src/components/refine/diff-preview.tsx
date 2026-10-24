import { useMemo } from "react";

import type { Edit } from "@/lib/api/types";
import { diffSegments, diffStats, formatDiffStats } from "@/lib/enhance/diff";
import { cn } from "@/lib/utils";

const SEGMENT_CLASS = {
  same: "",
  gap: "text-muted-foreground",
  insert: "text-insert bg-insert-soft underline underline-offset-[3px]",
  delete: "text-destructive bg-destructive-soft line-through",
} as const;

/** design.md §4.4: resulting prompt region (±40 units of context) with proof-mark insertions and deletions. */
export function DiffPreview({ prompt, edits }: { prompt: string; edits: Edit[] }) {
  const segments = useMemo(() => diffSegments(prompt, edits), [prompt, edits]);
  const stats = useMemo(() => diffStats(edits), [edits]);
  return (
    <div className="mt-2.5">
      <div
        data-testid="diff-preview"
        className="rounded-md border border-border bg-card px-3 py-2.5 font-mono text-[13px] leading-5 [overflow-wrap:anywhere] whitespace-pre-wrap"
      >
        {segments.map((segment, i) =>
          segment.kind === "insert" || segment.kind === "delete" ? (
            <span key={i} className={SEGMENT_CLASS[segment.kind]}>
              <span className="sr-only">{segment.kind === "insert" ? "Inserted: " : "Deleted: "}</span>
              {segment.text}
            </span>
          ) : (
            <span key={i} className={cn(SEGMENT_CLASS[segment.kind])}>
              {segment.text}
            </span>
          ),
        )}
      </div>
      <div className="mt-1.5 text-data">{formatDiffStats(stats)}</div>
    </div>
  );
}
