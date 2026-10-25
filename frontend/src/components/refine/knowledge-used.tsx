"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";

import { KindIcon } from "@/components/common/kind-icon";
import type { Trace } from "@/lib/api/types";
import { formatScore } from "@/lib/format";
import { cn } from "@/lib/utils";

type Item = Trace["knowledge"][number];

function Row({ item }: { item: Item }) {
  return (
    <li
      className={cn(
        "flex h-11 items-center gap-2.5 border-b border-border last:border-b-0",
        !item.kept && "opacity-50",
      )}
    >
      <KindIcon kind={item.kind} className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={item.title}>
        {item.title}
      </span>
      <span className="text-data">{formatScore(item.score)}</span>
    </li>
  );
}

/** design.md §4.5: kept knowledge with scores, dropped behind a toggle, or the general-enhancement row. */
export function KnowledgeUsed({ trace }: { trace: Trace }) {
  const [showDropped, setShowDropped] = useState(false);
  const kept = trace.knowledge.filter((item) => item.kept);
  const dropped = trace.knowledge.filter((item) => !item.kept);
  const general = trace.general || kept.length === 0;

  return (
    <section aria-labelledby="knowledge-used-label">
      <h2 id="knowledge-used-label" className="mb-1.5 text-label">
        Knowledge used
      </h2>
      <ul>
        {general ? (
          <li className="flex h-11 items-center gap-2.5">
            <Sparkles className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              {trace.result_type === "none" ? "No relevant knowledge kept" : "General enhancement"}
            </span>
          </li>
        ) : (
          kept.map((item) => <Row key={item.id} item={item} />)
        )}
      </ul>
      {dropped.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showDropped}
            onClick={() => setShowDropped((value) => !value)}
            className="mt-1 flex h-8 items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", showDropped && "rotate-90")} />
            {showDropped ? "Hide dropped" : `Show dropped (${dropped.length})`}
          </button>
          {showDropped && (
            <ul aria-label="Dropped knowledge">
              {dropped.map((item) => (
                <Row key={item.id} item={item} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
