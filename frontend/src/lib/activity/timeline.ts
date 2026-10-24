import type { ApiLog, AiLog } from "@/lib/api/types";

import { groupCalls } from "./rows";

export type TimelineBar = {
  key: string;
  label: string;
  latencyMs: number;
  /** Percent of the request span, 0–100. */
  offsetPct: number;
  widthPct: number;
  status: "ok" | "error";
};

/** Bars proportional to latency, positioned relative to the request start (earliest timestamp). */
export function buildTimeline(api: ApiLog, ai: AiLog[]): TimelineBar[] {
  const groups = groupCalls(ai);
  if (groups.length === 0) return [];
  const originMs = Math.min(Date.parse(api.time), ...groups.map((g) => g.startMs));
  const endMs = Math.max(Date.parse(api.time) + api.latency_ms, ...groups.map((g) => g.endMs));
  const span = Math.max(endMs - originMs, 1);
  return groups.map((g) => {
    const offsetPct = ((g.startMs - originMs) / span) * 100;
    const widthPct = Math.min((g.latencyMs / span) * 100, 100 - offsetPct);
    return {
      key: g.operation,
      label: g.count > 1 ? `${g.operation} ×${g.count}` : g.operation,
      latencyMs: g.latencyMs,
      offsetPct,
      widthPct: Math.max(widthPct, 1),
      status: g.status,
    };
  });
}

export function sumTokens(ai: AiLog[]): { input: number; output: number } | null {
  if (ai.length === 0) return null;
  return {
    input: ai.reduce((n, c) => n + (c.input_tokens ?? 0), 0),
    output: ai.reduce((n, c) => n + (c.output_tokens ?? 0), 0),
  };
}
