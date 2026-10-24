# Prompt Enhance — HTTP API contract (v1)

Base URL default `http://127.0.0.1:8000`. JSON everywhere. CORS allows the frontend origin (`http://localhost:3000`, `http://127.0.0.1:3000`).
Every response carries `X-Request-ID` (echoes the request's header when supplied, else generated `req_<12 hex>`).
Errors: HTTP status + `{"error": {"code": str, "message": str}}`. Messages are sanitized (no secrets, no prompt text).
Timestamps: ISO-8601 UTC strings. IDs: UUID strings unless stated.

## Enhancement

### `POST /v1/enhance`
Request:
```json
{ "request_id": "req_ab12cd34ef56", "prompt": "…", "prompt_revision": 7, "cursor": 42 }
```
- `prompt` ≤ 20 000 UTF-16 code units; `0 ≤ cursor ≤ len(prompt)`; else `422`.
- Response: `EnhanceResponse` exactly as in `docs/brief.md` §4 / PRD (`schema_version: 1`, echoes `request_id` and `prompt_revision`).
- Autocomplete only when `cursor === len(prompt)`; `insert_at === len(prompt)`.
- Backend validates every invariant (bounds, non-overlap, ≥2 options, unique ids, ≥1 edit each, edits change the prompt). Invalid model output → retry once → else `type: "none"`.
- Upstream failure/timeout → `502 {"error":{"code":"upstream_error"|"upstream_timeout",…}}`; DB failure → `503`.
- Respects settings: autocomplete/questions toggles, `max_options`.

### `GET /v1/traces/{request_id}`
Context for the Refine inspector (no prompt text stored).
```json
{
  "request_id": "req_…", "created_at": "…", "prompt_revision": 7,
  "result_type": "autocomplete|multiple_choice|none", "general": false,
  "tags": [{"name": "retry", "similarity": 0.93}],
  "knowledge": [{"id": "…", "kind": "skill|prompt|graph", "title": "…", "score": 0.91, "kept": true}],
  "steps": [{"step": "tags|retrieve|judge|generate", "model": "gemini-3.5-flash-lite", "latency_ms": 184, "status": "ok|error|skipped", "detail": "5 tags → 5 candidates"}]
}
```
`404` if unknown / expired.

### `POST /v1/outcomes`
```json
{ "request_id": "req_…", "prompt_revision": 7, "event": "shown|accepted|declined|dismissed|superseded", "option_id": "dual", "time_to_action_ms": 2100 }
```
→ `204`. Stores derived features from the trace (task type, missing-constraint flags, retrieval scores, counts, suggestion type, latency) + outcome. Never prompt text.

## Knowledge

`Knowledge` (list item): `{ id, kind: "skill"|"prompt"|"graph", title, summary, tags: string[], created_at, updated_at, use_count }`
`KnowledgeDetail` = `Knowledge` + `{ body }`.

- `GET /v1/knowledge?q=&kind=&tags=a,b&offset=0&limit=50` → `{ items: Knowledge[], total: int }` (q matches title/summary/body, case-insensitive; tags = AND filter; sorted `updated_at desc`).
- `GET /v1/knowledge/{id}` → `KnowledgeDetail` | `404`.
- `POST /v1/knowledge` body `{ kind, title (1–200), body (1–100 000) }`. Response is `text/event-stream`:
  - `event: step` `data: {"step":"summarise|tag|embed|save","status":"done"}` (in order)
  - `event: done` `data: {"knowledge": KnowledgeDetail, "tags":[{"name":"…","new":true}]}`
  - `event: error` `data: {"code":"…","message":"…"}`
- `PATCH /v1/knowledge/{id}` body `{ title?, body?, tags? }` → `KnowledgeDetail`. Changing `body` regenerates summary + tags (unless `tags` given). `tags` replaces links (new tags embedded).
- `DELETE /v1/knowledge/{id}` → `204`. Orphan tags are kept (they may be reused).
- `GET /v1/tags?q=&limit=50` → `{ items: [{ name, knowledge_count }] }` sorted by count desc.

## Hand-off to Codex

- `POST /v1/handoff` body `{ prompt }` → `{ id, created_at }` (stores the latest refined prompt; only the newest row is kept).
- `GET /v1/handoff/latest` → `{ id, prompt, created_at }` | `404`.

## Activity

- `GET /v1/logs?kind=all|ai|api&status=any|2xx|4xx|5xx&request_id=&before=<iso>&limit=100`
  → `{ items: ApiLog[] }` where `ApiLog = { time, request_id, method, path, status, latency_ms, error?, children: AiLog[] }` and `AiLog = { time, request_id, operation, model, status: "ok"|"error", latency_ms, input_tokens?, output_tokens?, error? }`.
  `kind=ai` returns `{ items: AiLog[] }` instead. Newest first.
- `GET /v1/logs/{request_id}` → `{ api: ApiLog, ai: AiLog[], trace?: Trace, outcome?: { event, time_to_action_ms } }`.
- `DELETE /v1/logs` → `204` (clears api/ai logs and traces).
- `GET /v1/stats` → `{ suggestions, accepted_pct, declined_pct, p50_latency_ms, classifier: { auc, trained_at } | null, log_entries, log_bytes }` (window: retention period).

## Settings & health

- `GET /v1/settings` / `PUT /v1/settings` → `{ trigger_delay_ms: 150–1500, autocomplete_enabled, questions_enabled, max_options: 2–6, retention_days: 30 (read-only), store_payloads: false (read-only) }`.
- `GET /v1/health` → `{ status: "ok"|"degraded", latency_ms, db: "ok"|"error", gemini: "ok"|"error"|"unchecked" }` (`?deep=1` pings Gemini).

## Analytics (Snowflake)

- `GET /v1/analytics/status` → `{ last_export_at, last_export_count, classifier: { auc, trained_at, rows } | null }`
- `POST /v1/analytics/export` → `{ exported: int }` (outcome events since last export → `PROMPT_ENHANCE.ANALYTICS.OUTCOME_EVENTS`).
- `POST /v1/analytics/train` → `{ auc, rows, trained_at }` (Snowflake ML `CLASSIFICATION` on derived features; `409` when < 20 labelled rows or a single class).

## Logging policy (D1/D2)
Metadata only: request id, timestamps, operation/model, status, latency, token usage, sanitized error. 30-day retention via TimescaleDB retention policies on `api_call_log`, `ai_call_log`, `enhance_trace`.
