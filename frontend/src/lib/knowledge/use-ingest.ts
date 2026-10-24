"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import type { IngestStep } from "@/lib/api/types";

import { knowledgeKeys, streamIngest, type IngestInput, type IngestResult } from "./api";

export type IngestState = {
  status: "idle" | "running" | "done" | "error";
  steps: IngestStep[];
  result: IngestResult | null;
  error: string | null;
};

const IDLE: IngestState = { status: "idle", steps: [], result: null, error: null };

/** Runs the add-knowledge SSE stream and exposes real per-step progress. */
export function useIngest() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<IngestState>(IDLE);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(
    async (input: IngestInput) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setState({ ...IDLE, status: "running" });
      let finished = false;
      try {
        for await (const event of streamIngest(input, controller.signal)) {
          if (event.type === "step") {
            setState((s) => ({ ...s, steps: s.steps.includes(event.step) ? s.steps : [...s.steps, event.step] }));
          } else if (event.type === "done") {
            finished = true;
            setState((s) => ({ ...s, status: "done", result: { knowledge: event.knowledge, tags: event.tags } }));
            void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
            void queryClient.invalidateQueries({ queryKey: ["tags"] });
          } else {
            finished = true;
            setState((s) => ({ ...s, status: "error", error: event.message }));
          }
        }
        if (!finished) setState((s) => ({ ...s, status: "error", error: "Connection closed before saving" }));
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof ApiError || error instanceof Error ? error.message : "Request failed";
        setState((s) => ({ ...s, status: "error", error: message }));
      }
    },
    [queryClient],
  );

  const reset = useCallback(() => {
    abort.current?.abort();
    setState(IDLE);
  }, []);

  return { state, start, reset };
}
