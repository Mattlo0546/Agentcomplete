// Mirrors docs/api.md. Positions are UTF-16 code units (JS string indices), ranges are [start, end).

export type Edit = { start: number; end: number; text: string };
export type Option = { id: string; label: string; edits: Edit[] };

type ResponseBase = { schema_version: 1; request_id: string; prompt_revision: number };
export type EnhanceResponse = ResponseBase &
  (
    | { type: "autocomplete"; insert_at: number; text: string }
    | { type: "multiple_choice"; question: string; options: Option[] }
    | { type: "none" }
  );

export type EnhanceRequest = {
  request_id: string;
  /** Last validated response in this editor session; the server decides whether its context can be reused. */
  previous_request_id?: string;
  prompt: string;
  prompt_revision: number;
  cursor: number;
};

export type StepName = "tags" | "retrieve" | "judge" | "generate";
export type Trace = {
  request_id: string;
  created_at: string;
  prompt_revision: number;
  result_type: EnhanceResponse["type"];
  general: boolean;
  tags: { name: string; similarity: number }[];
  knowledge: { id: string; kind: KnowledgeKind; title: string; score: number; kept: boolean }[];
  steps: { step: StepName; model: string; latency_ms: number; status: "ok" | "error" | "skipped"; detail: string }[];
};

export type OutcomeEvent = "shown" | "accepted" | "declined" | "dismissed" | "superseded";

export type KnowledgeKind = "skill" | "prompt" | "graph";
export type Knowledge = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  use_count: number;
};
export type KnowledgeDetail = Knowledge & { body: string };
export type IngestStep = "summarise" | "tag" | "embed" | "save";

export type AiLog = {
  time: string;
  request_id: string;
  operation: string;
  model: string;
  status: "ok" | "error";
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
};
export type ApiLog = {
  time: string;
  request_id: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  error: string | null;
  children: AiLog[];
};
export type LogDetail = {
  api: ApiLog;
  ai: AiLog[];
  trace: Trace | null;
  outcome: { event: OutcomeEvent; time_to_action_ms: number | null } | null;
};

export type Stats = {
  suggestions: number;
  accepted_pct: number;
  declined_pct: number;
  p50_latency_ms: number | null;
  classifier: { auc: number; trained_at: string } | null;
  log_entries: number;
  log_bytes: number;
};

export type AppSettings = {
  trigger_delay_ms: number;
  autocomplete_enabled: boolean;
  questions_enabled: boolean;
  max_options: number;
  retention_days: number;
  store_payloads: boolean;
};

export type Health = {
  status: "ok" | "degraded";
  latency_ms: number;
  db: "ok" | "error";
  gemini: "ok" | "error" | "unchecked";
};

export type AnalyticsStatus = {
  last_export_at: string | null;
  last_export_count: number | null;
  classifier: { auc: number; trained_at: string; rows: number } | null;
};
