# Prompt Enhance — Product Brief

Status: **approved 2026-10-24** together with the mockup set (material changes return to this gate).

## 1. What it is

A single-user plugin for OpenAI Codex that improves prompts while they are being written. As the user types, it either:

- shows **ghost-text autocomplete** after the input (Copilot-style; `Tab` accepts, `Esc` dismisses), or
- asks a **multiple-choice question** whose options each carry a set of edits; the user previews the diff of one option and confirms it, or declines all and keeps writing.

Suggestions are grounded in a knowledge base (SKILL files, example prompts, deterministic graphs with agent prompting in the loop) retrieved through tags.

Out of scope: login, access control, multi-user or workspace isolation.

## 2. Surfaces (page/tab inventory)

| Tab | Purpose | Key states |
|---|---|---|
| **Refine** | Prompt editor with ghost text, question card, diff preview, knowledge used, send to Codex | idle · requesting · autocomplete · question · diff preview · none · error |
| **Knowledge** | Browse, search, filter by tag, inspect, add and delete knowledge | list · detail · add (ingesting → summary + tags ready) · empty |
| **Activity** | AI-call and API-call logs; suggestion outcomes | list · detail (pipeline trace) · filtered |
| **Settings** | Backend URL & health, suggestion behaviour, theme, logging policy | — |

Layout modes: **wide** (standalone window or wide panel, ≥ 1024 px) and **narrow** (docked Codex side panel or phone, < 768 px). Mockups cover both for every tab.

## 3. Codex integration

Research (`docs/integration.md`) found **no documented Codex API for a custom side panel or for replacing the composer**. Codex plugins bundle skills, MCP servers and hooks; custom MCP UI renders in ChatGPT, not confirmed in Codex. **Decision D3 (approved):**

- **Companion panel**: the Next.js app runs as its own window docked beside Codex (narrow layout = docked mode).
- **Codex plugin** (`.codex-plugin/plugin.json`) ships an MCP server with `get_refined_prompt` / `enhance_prompt` tools and a skill, so Codex can pull the latest refined prompt (`@prompt-enhance`).
- **Send to Codex**: copies the refined prompt to the clipboard and marks it as the latest refined prompt for the MCP tool. No composer override.

User text is never interpolated into shell code — hand-off uses clipboard / structured MCP arguments only.

## 4. Enhancement API

`POST /v1/enhance` — request `{request_id, prompt, prompt_revision, cursor}`; response is the discriminated `EnhanceResponse` (`autocomplete` | `multiple_choice` | `none`, `schema_version: 1`), exactly as specified in the PRD:

- UTF-16 code-unit positions, half-open `[start, end)`.
- `autocomplete.insert_at === prompt.length`, `text` is suffix only, applied only on accept.
- `multiple_choice`: ≥ 2 options, unique ids, ≥ 1 edit each, edits non-overlapping, valid bounds, relative to one snapshot; client applies edits end → start atomically after diff preview.
- Client drops any response whose `request_id`/`prompt_revision` is not the latest. Edits and cursor changes invalidate shown suggestions, except typing the exact prefix of a visible autocomplete at the end keeps its remainder locally. Outcomes retain the original suggestion's request/revision.
- Failures are HTTP errors, never `none`.

Backend validates every model output against these invariants before returning; invalid output becomes `none` or a 502, never a malformed suggestion.

## 5. Pipeline

1. **Tag extraction** — small fast Gemini model, structured output: tags + task features (task type, missing constraints).
2. **Retrieval** — embed tags (Gemini embeddings) → pgvector nearest-neighbour over tag vectors → linked knowledge + summaries.
3. **Relevance judging** — per candidate, a judge model reads summary + input → keep/drop with score.
4. **Generation** — filtered knowledge + input → `EnhanceResponse` via structured output. If retrieval returns nothing or judging drops everything, **general enhancement** from input only (goals, constraints, output format). Never invent project facts, sources or preferences; missing information becomes a question.

Performance revision (25 October 2026): relevance review and generation share one structured call, with a validated decision for every candidate before the suggestion. Exact tags, embeddings and retrieval are cached in memory; relevance is still reviewed for every new draft. See [architecture](architecture.md).

Retrieved knowledge is reference data only; every prompt change goes through the user acceptance flow.

## 6. Data (Tiger Data, one PostgreSQL service)

- `knowledge` (id, kind: skill | prompt | graph, title, body, summary, created_at)
- `tag` (id, name unique, embedding vector)
- `knowledge_tag` (many-to-many)
- `outcome_event` (timestamped: suggestion shown / accepted / declined / ignored, with derived features)
- `ai_call_log`, `api_call_log`

Ingest: generate summary + a few tags → upsert tags (embed new ones) → link → insert knowledge.

## 7. Outcome classifier (Snowflake)

Train/evaluate a classifier predicting suggestion acceptance from **derived features only** (task type, missing-constraint flags, retrieval scores, candidate counts, suggestion type, latency, observed outcome) — no raw prompt text leaves the primary DB for this.

## 8. Logging

Default (approved by PRD): request id, timestamp, operation/model, status, latency, token usage, sanitized error. Credentials stay on the backend; secrets never logged.

**Decisions (approved 2026-10-24):**
- D1. **No payload logging** — prompts, retrieved knowledge bodies and model responses are never written to logs. Metadata only.
- D2. **30-day retention** for API/AI call logs and enhance traces (TimescaleDB retention policies). Outcome events keep only derived features (no prompt text) and are retained for classifier training.

Settings shows both as read-only policy values.

## 9. Acceptance (after design approval)

Real behaviour end to end (no mocked success): typing produces live suggestions from the real pipeline; accept/decline/diff flows work; knowledge ingest persists to Tiger Data with summary, tags and vectors; logs are written and viewable; outcome events export to Snowflake and the classifier trains and reports metrics. CopilotKit's test patterns applied (unit + component + e2e). Every tab, critical journey and interactive component family covered by checks, rerun until green.
