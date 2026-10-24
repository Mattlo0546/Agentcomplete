import { apiJson } from "@/lib/api/client";
import type { AppSettings, EnhanceRequest, EnhanceResponse, OutcomeEvent, Trace } from "@/lib/api/types";

export function postEnhance(body: EnhanceRequest, signal: AbortSignal): Promise<EnhanceResponse> {
  return apiJson<EnhanceResponse>("/v1/enhance", { method: "POST", body, signal });
}

export function getTrace(requestId: string): Promise<Trace> {
  return apiJson<Trace>(`/v1/traces/${encodeURIComponent(requestId)}`);
}

export function getSettings(): Promise<AppSettings> {
  return apiJson<AppSettings>("/v1/settings");
}

export function postHandoff(prompt: string): Promise<{ id: string; created_at: string }> {
  return apiJson("/v1/handoff", { method: "POST", body: { prompt } });
}

export type OutcomeBody = {
  request_id: string;
  prompt_revision: number;
  event: OutcomeEvent;
  option_id?: string;
  time_to_action_ms?: number;
};

/** Fire-and-forget: outcome logging must never disturb the editor. */
export function postOutcome(body: OutcomeBody): void {
  apiJson("/v1/outcomes", { method: "POST", body }).catch(() => {});
}
