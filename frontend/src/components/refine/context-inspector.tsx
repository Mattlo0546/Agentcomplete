"use client";

import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { getTrace } from "@/lib/enhance/api";

import { KnowledgeUsed } from "./knowledge-used";
import { PipelineSteps } from "./pipeline-steps";

export function useTrace(requestId: string | null) {
  return useQuery({
    queryKey: ["trace", requestId],
    queryFn: () => getTrace(requestId!),
    enabled: requestId !== null,
    staleTime: Infinity,
  });
}

/** Inspector body for Refine (design.md §4.5). */
export function ContextInspector({ requestId }: { requestId: string | null }) {
  const trace = useTrace(requestId);
  if (requestId === null) return <p className="text-muted-foreground">No suggestion yet</p>;
  if (trace.isPending) {
    return (
      <div aria-label="Loading context" className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (trace.isError) return <p className="text-muted-foreground">Context unavailable</p>;
  return (
    <>
      {trace.data.result_type === "none" && <p className="text-muted-foreground">No suggestion for this draft</p>}
      <KnowledgeUsed trace={trace.data} />
      <PipelineSteps trace={trace.data} />
    </>
  );
}
