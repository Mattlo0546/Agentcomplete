# Agentcomplete — architecture and autocomplete performance

Updated 25 October 2026. The companion panel, Codex MCP plugin, Gemini, Tiger Data and Snowflake remain the stack. See [performance results](performance.md) for measured before/after results and [provider options](provider-latency-options.md) for research-only alternatives.

## Request path

```mermaid
flowchart LR
  Editor["Editor · 150 ms quiet time"] --> API["FastAPI /v1/enhance"]
  API --> Settings["Cached settings"]
  Settings --> Local["End cursor · local Tiger knowledge snapshot"]
  Local -- "confident candidates" --> Generate["Gemini: review every candidate, then generate"]
  Local -- "uncertain / no match / mid-cursor" --> Tags["Gemini tag extraction · exact-input cache"]
  Tags --> Retrieve["Cached embeddings + Tiger pgvector retrieval"]
  Retrieve --> Generate
  Generate --> Validate["Validate suffix / anchored edits / UTF-16"]
  Validate --> Editor
  Validate -. "background metadata" .-> Trace["Trace + knowledge use counts"]
  Trace --> Tiger[("Tiger Data")]
  Tiger -. "refresh every 10 seconds" .-> Local
  Tiger -. "outcomes / offline classifier" .-> Snowflake[("Snowflake")]
```

1. The editor waits **150 ms** after input stops, configurable from 150–1500 ms. Migration 002 moved the old 400 ms preset to 200 ms; migration 003 moves the 200 ms preset to 150 ms. Other configured values are retained.
2. `/v1/enhance` reads settings from a process cache refreshed every 2.5 seconds with a five-second hard expiry. Fresh reads do not wait behind maintenance. Empty prompts and disabled modes skip model calls. End-cursor requests with autocomplete enabled first try a bounded local snapshot of Tiger knowledge, using the full current draft to nominate up to three candidates. Metadata overlap is required; body terms only contribute to ranking. No fabricated tags or cosine similarities are reported. A fresh Gemini review remains mandatory.
3. Uncertain matches, no matches in a nonempty corpus, oversized snapshots and mid-cursor requests use the semantic route. Tags come from a small Gemini model; without a valid previous request, tag extraction and knowledge-presence lookup run concurrently. The browser sends the last validated `previous_request_id`, including valid `none` responses. That same tag call compares previous/current drafts; approved immaterial edits, unchanged tags/task type, and fresh sources permit candidate reuse. Otherwise tags are embedded with `gemini-embedding-001` and retrieved with Tiger pgvector. At most five semantic candidates pass the 0.88 cutoff. Query vectors are parsed once as `vector[]`, avoiding per-row text casts.
4. One structured call **reviews every candidate summary and then generates**. The schema puts reviews before the suggestion; Python requires exactly one review for every candidate and enforces the keep-score threshold. This replaces a separate request per judge plus a later generation request. Each new prompt receives a fresh relevance review, even when retrieval is cached.
5. Obvious unfinished English clauses or autocomplete-only mode use a small suffix schema at the end cursor. The semantic route can also use its tag call's continuation classification. Other fast-route requests let the single generation call choose autocomplete for partial words/unfinished thoughts in any language, or a question/`none` for complete or ambiguous drafts. Questions prefer two short options with one anchored edit each; Python creates option IDs and UTF-16 offsets. The public API still permits multiple edits and up to the configured maximum options. Ordered boolean/score arrays reduce review output; both a true keep decision and score of at least 0.5 are required, before rounding.
6. Both paths use Gemini Flash-Lite by default, at minimal thinking. `GENERATE_MODEL=gemini-3.6-flash` restores the stronger question/general model; `AUTOCOMPLETE_MODEL` separately controls the suffix path. Tags, judging and generation stay with the same sponsor.
7. Output validation and one retry for invalid edits/reviews remain. Provider failures remain HTTP errors. No partially validated output is shown.
8. Validated trace metadata becomes readable immediately in process, then persists to Tiger with usage counts in the background. Immediate `/traces` and `/outcomes` reads can resolve pending traces. Shutdown and log clearing drain pending writes. A bounded trace queue applies backpressure if the database stalls; process failure before a background write commits can lose that metadata.

The fast route makes one fresh generation call even for a new draft. The semantic route can require three serial provider calls (tags, embeddings, reviewed generation), reduced by caches. `FAST_AUTOCOMPLETE_ENABLED=false` restores semantic routing for comparisons. Neither route reuses completed model responses across different drafts.

## Typing, cancellation and correctness

The browser aborts obsolete requests. The server listens for an ASGI disconnect and cancels the pipeline and child tasks, releasing local work/connections and avoiding later pipeline stages. Cancellation cannot guarantee that a provider stops billing inference already started remotely.

Network responses still require the latest request ID and prompt revision. Every text change increments the revision. A narrow local exception preserves an already validated ghost: if the user appends exactly the beginning of that visible suffix, at the collapsed end cursor, the remainder stays visible immediately without a request. Any divergent edit, deletion, selection or cursor move invalidates it. Outcomes retain the original suggestion's request ID and source revision; typing the entire suggestion counts as acceptance.

Ghost text paints without the old 120 ms fade. IME composition suppresses requests and Tab/Escape suggestion actions. Settings changes cancel old-mode work and remove disabled suggestion types. Settings arriving after typing starts preserve the queued request's original quiet-time timestamp. Draft storage is batched at 250 ms (one-second maximum wait), with navigation/unmount flushing.

The previous-response pointer stays in component memory and resets when the draft is cleared or the editor remounts. Failed, canceled, stale or invalid responses cannot replace it. Unknown/expired references trigger ordinary retrieval. Comparison occurs in the existing tag call, without adding a new inference round trip. Candidate relevance is always reassessed against the current text; an approval never reuses a previous verdict or suggestion.

Byte-identical linked drafts skip tag inference as well as retrieval while their context remains fresh. This covers cursor movement without changed text; generation still uses the current cursor, response-type settings and candidate review. The trace identifies this with `unchanged draft` in the tags step.

## Caches and freshness

All caches are bounded, process-local memory. No new payload logging or persistent prompt cache is introduced.

| Cache | Key / bound | Freshness |
|---|---|---|
| Settings | Singleton, copied for each caller | Background refresh every 2.5 seconds; hard expiry at 5 seconds; committed API updates replace it immediately |
| Local knowledge snapshot | At most 256 documents and 2 million source characters; excerpts bounded to 8,000 characters per document | Refresh every 10 seconds, hard expiry at 15 seconds; committed local mutations invalidate it; rechecked after generation |
| Tags and derived task features | Model + SHA-256 of full current/prior drafts and comparison options; 256 entries | 60 seconds; ordinary long inputs retain the first 4,000 and final 2,000 characters. A changed hidden middle disables reuse and extracts from the full current draft |
| Tag embeddings | Model + dimensions + tag; 1,024 entries | One hour; same semantic-similarity embedding task |
| Retrieved candidates | Embedding model/dimensions, normalized tag set and threshold; 128 entries | 15 seconds; create/edit/delete invalidates immediately after commit |
| Knowledge presence | Singleton | 15 seconds; same mutation invalidation |
| Previous draft context | Completed request ID; 128 entries | At most 15 seconds from the original candidate SQL read, never renewed by subsequent edits; model changes and knowledge mutations invalidate reuse |
| Pending trace metadata | Request ID, at most 256 pending writes | Available until persistence completes |

Knowledge invalidation advances a generation counter so an older in-flight read cannot repopulate a cleared cache. Fast-route suggestions whose snapshot changes or expires during inference are discarded. Relevance verdicts and completed responses are not reused across different drafts. Writes made externally or through another process become visible within the cache TTL. Failed background refreshes do not renew source age or settings expiry.

This is the existing single-user, single-worker topology. Pending-trace reads and invalidation assume that topology; multiple workers require shared cache/invalidation and trace handoff before deployment.

## Models and transport

| Operation | Default |
|---|---|
| Tags / knowledge analysis | `gemini-3.5-flash-lite` |
| Suffix and full enhancement | `gemini-3.5-flash-lite` |
| Embeddings | `gemini-embedding-001`, 768 dimensions |
| Optional stronger full enhancement | `GENERATE_MODEL=gemini-3.6-flash` |

Generation output budgets are 768 tokens for compact suffixes and 2,048 for full suggestions; tags use 512. Minimal thinking reduces unnecessary reasoning, but output budgets still leave room for valid structured JSON. The existing Gemini client is reused. The MCP server now also reuses an HTTPX client through its lifespan.

Tiger remains the source of truth in us-east-1. Snowflake export/training stays off the suggestion path. No database region, provider endpoint, authentication or sponsor integration has been changed.

## Inspect and reproduce

Important files:

- `backend/app/pipeline/complete.py`: small response schemas, candidate review, model routing.
- `backend/app/pipeline/run.py`: orchestration and validation.
- `backend/app/pipeline/{catalog,tags,retrieve,cache,context}.py`: local nominations, caches, draft comparison and retrieval.
- `backend/app/api/enhance.py`: disconnect cancellation.
- `backend/app/pipeline/trace.py`: asynchronous metadata persistence.
- `frontend/src/lib/enhance/{use-enhance,state}.ts`: debounce, stale-response safety and local suffix reuse.
- `plugin/prompt-enhance/mcp/prompt_enhance_mcp/{client,server}.py`: pooled plugin transport.

From `backend/`, measure the running backend with real credentials/services:

```bash
PYTHONPATH=. uv run python scripts/bench_enhance.py --base-url http://127.0.0.1:8000 --rounds 2 --output /tmp/latency.json
PYTHONPATH=. uv run python scripts/bench_enhance.py --base-url http://127.0.0.1:8000 --incremental
PYTHONPATH=. uv run python scripts/bench_enhance.py --base-url http://127.0.0.1:8000 --incremental --previous-context
```

The script records metadata only: fixture case number, timings, result type, model, review counts and errors. Round one is first visit; round two repeats exact inputs. Both still receive fresh generation/review. `--previous-context` chains successful response IDs through the incremental fixtures and records explicit candidate reuse on the semantic route. `--cases 7 8 9` selects suffix fixtures. Omitting `--base-url` measures in process, with startup warming recorded separately. `frontend/scripts/bench-latency.mjs` measures trusted last-input events through visible suggestions in an isolated browser context; `backend/scripts/eval_catalog.py` evaluates shortlist recall using synthetic fixtures and a read-only corpus snapshot.

The Activity timeline records actual AI calls. Logical `judge` trace time is zero when it shares generation's call; its detail and model make that explicit. Warm cached tag/retrieval stages can also report zero time. These figures must not be added as if shared stages were separate calls.

Contract tests cover bounds, surrogate pairs, edit anchoring, per-candidate reviews, upstream failures, cache invalidation, cancellation and immediate trace reads. Browser tests cover real provider suggestions, accept/decline, diff application, settings, knowledge and Codex handoff.
