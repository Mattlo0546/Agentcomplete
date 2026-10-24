import type { Health } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import type { DotTone } from "@/components/common/status-dot";

export type HealthView = { tone: DotTone; text: string };

/** `healthy · 23 ms · db ok · gemini ok` (docs/api.md GET /v1/health). */
export function describeHealth(health: Health): HealthView {
  const parts = [health.status === "ok" ? "healthy" : "degraded", `${health.latency_ms} ms`];
  parts.push(`db ${health.db}`, `gemini ${health.gemini}`);
  return { tone: health.status === "ok" ? "ok" : "warn", text: parts.join(" · ") };
}

export function describeHealthError(error: unknown): HealthView {
  if (error instanceof ApiError) {
    return { tone: "err", text: error.status ? `${error.status} · ${error.message}` : error.message };
  }
  return { tone: "err", text: error instanceof Error ? error.message : "Backend unreachable" };
}
