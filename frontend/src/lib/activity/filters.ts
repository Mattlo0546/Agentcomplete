export type KindFilter = "all" | "ai" | "api";
export type StatusFilter = "any" | "2xx" | "4xx" | "5xx";

export const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ai", label: "AI calls" },
  { value: "api", label: "API calls" },
];
export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "2xx", label: "2xx" },
  { value: "4xx", label: "4xx" },
  { value: "5xx", label: "5xx" },
];

export const LOG_PAGE_SIZE = 100;

export type LogFilters = { kind: KindFilter; status: StatusFilter; requestId: string };

/** Query string for GET /v1/logs (docs/api.md Activity). */
export function buildLogsQuery(filters: LogFilters, before?: string, limit = LOG_PAGE_SIZE): string {
  const params = new URLSearchParams({ kind: filters.kind, status: filters.status, limit: String(limit) });
  const requestId = filters.requestId.trim();
  if (requestId) params.set("request_id", requestId);
  if (before) params.set("before", before);
  return params.toString();
}

/** Status class of an HTTP code, as the `status` filter values spell it. */
export function statusClass(code: number): Exclude<StatusFilter, "any"> | "other" {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500 && code < 600) return "5xx";
  return "other";
}
