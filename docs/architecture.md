# Skill Issue architecture

Source snapshot: **25 October 2026**. The published runtime uses lexical nomination with a tag/pgvector fallback. The local EmbeddingGemma index and bounded in-flight suffix adoption are **active development**, described separately below. Model names are source defaults, not a live service-health check. [Performance measurements](performance.md) retain their original corpus and settings.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-technical-dark.svg">
  <img alt="Skill Issue technical architecture with client, API process, model provider, database, and offline analytics boundaries" src="assets/architecture-technical-light.svg" width="1200">
</picture>

The diagram distinguishes the API's internal responsibilities from external services. It is generated from [render_architecture.py](diagrams/render_architecture.py). Its service boundaries and straight connectors take visual cues from [Supabase's architecture diagram](https://supabase.com/docs/guides/getting-started/architecture); the topology and labels describe this repository.

## Runtime and ownership

| Component                      | Responsibility                                                      | Source                                                                                            |
| :----------------------------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------ |
| Next.js 16 / React 19          | Refine, Knowledge, Activity, Settings; HTTP client and editor state | [`frontend/src/`](../frontend/src/)                                                               |
| FastAPI / Pydantic / Psycopg 3 | Routing, validation, cancellation, database access                  | [`backend/app/`](../backend/app/)                                                                 |
| Local lexical catalog          | Nominate candidates from a fresh Tiger snapshot                     | [`catalog.py`](../backend/app/pipeline/catalog.py)                                                |
| Gemini / Google Gen AI SDK     | Analysis, fallback tags/embeddings, combined review and generation  | [`gemini.py`](../backend/app/llm/gemini.py), [`complete.py`](../backend/app/pipeline/complete.py) |
| Tiger Data / PostgreSQL        | Knowledge, settings, handoffs, tag vectors, traces, outcomes        | [`migrations/`](../backend/app/db/migrations/)                                                    |
| pgvector / TimescaleDB         | Tag similarity search; time-series logs/traces and retention        | [`001_init.sql`](../backend/app/db/migrations/001_init.sql)                                       |
| Snowflake ML Classification    | Explicit feature export and offline acceptance-classifier training  | [`analytics/`](../backend/app/analytics/)                                                         |
| MCP server + Codex skill       | Refined-prompt handoff, direct enhancement, knowledge lookup        | [`plugin/prompt-enhance/`](../plugin/prompt-enhance/)                                             |

The application assumes **one user and one backend worker**. Caches, invalidation counters, and pending trace reads are process-local. Multi-worker deployment requires shared invalidation and trace coordination.

## Request path on main

The orchestration lives in [`run.py`](../backend/app/pipeline/run.py).

1. **Schedule.** The editor requests after 150 ms of quiet time by default, configurable from 150–1500 ms. It sends the entire draft, UTF-16 cursor position, request ID, revision, and last validated previous request ID. A valid `none` response can advance that pointer.
2. **Short-circuit.** Empty drafts and disabled modes skip inference. Settings are cached with background refresh and a hard expiry.
3. **Nominate locally.** With `FAST_AUTOCOMPLETE_ENABLED=true`, autocomplete enabled, and the cursor at the end, a bounded Tiger snapshot can nominate up to three candidates. Title/summary/tag overlap is required; body terms contribute to ranking. Unknown or ambiguous shared-topic matches use the remote route. Nomination is not a relevance verdict.
4. **Fall back to tags and pgvector.** Gemini extracts tags and can compare a previous draft in the same call. Approved immaterial changes, unchanged tags/task type, and fresh sources permit candidate reuse. Otherwise `gemini-embedding-001` embeds tags with `SEMANTIC_SIMILARITY`, and Tiger pgvector returns up to five candidates passing the 0.88 tag threshold. Tag extraction and knowledge-presence lookup run concurrently when there is no previous context.
5. **Review and generate together.** A single structured Gemini call reviews every candidate before generating a suffix, a multiple-choice question with anchored edits, or `none`. Python requires complete review coverage, a true keep decision, and an unrounded score of at least 0.5. Compact suffix and full suggestion requests use different schemas. Cached retrieval never skips fresh review.
6. **Validate.** Python checks response types, suffix bounds, option limits, UTF-16 edits, and local source freshness. Invalid output gets one retry; invalid output twice returns `none`. Provider failures remain HTTP errors. A local snapshot that changes or expires during generation causes the suggestion to be discarded.
7. **Record.** Trace metadata is immediately readable in process and persists with usage counts to Tiger in the background. Outcomes record user reactions. Snowflake export and training are explicit operations outside this path.

A warm lexical route uses one remote review/generation call. The fallback can require three serial provider calls: tags, embedding, and reviewed generation. Caches may eliminate earlier calls. Retries and source refreshes add work; one call is not a latency guarantee.

## Typing and cancellation

Every text change advances the revision. Responses must match the pending request and pass validation. Cursor changes, destructive edits, IME composition, settings changes, and invalid responses prevent unrelated output from being adopted. Obsolete browser requests are aborted; the API watches for disconnects and cancels pipeline tasks. Canceling local work cannot guarantee that a provider stops already-started inference.

Typing exactly the beginning of an already validated ghost suffix reveals its remainder immediately. Divergent edits invalidate it; typing the full suffix counts as acceptance. IME suppresses requests and Tab/Escape suggestion actions. Draft storage is batched at 250 ms with a one-second maximum wait and flushes on navigation/unmount. The previous-response pointer is component memory, cleared on empty draft/remount.

## Freshness and caches

| Data                                | Lifetime / boundary                                                   |
| :---------------------------------- | :-------------------------------------------------------------------- |
| Settings                            | 2.5-second refresh; five-second hard expiry                           |
| Tiger knowledge snapshot            | 10-second refresh; 15-second source expiry; mutations invalidate      |
| Tag extraction                      | Exact input/model; 256 entries; one-minute TTL                        |
| Tag embeddings                      | Model, dimensions, normalized tag; 1,024 entries; one-hour TTL        |
| Tag candidates / knowledge presence | 15 seconds; invalidated after committed knowledge mutations           |
| Previous draft context              | 128 entries; 15 seconds from original retrieval, not renewed by edits |
| Pending trace metadata              | Up to 256 pending writes; readable until persistence completes        |

Invalidation advances a generation counter so older reads cannot refill cleared caches. Failed refreshes do not renew freshness. External writes become visible within the refresh/expiry window. Process failure before a background trace write commits can lose pending metadata; a bounded queue applies backpressure when the database stalls.

## Models and data boundaries

| Operation                           | Source default                                                |
| :---------------------------------- | :------------------------------------------------------------ |
| Tag extraction / knowledge analysis | `gemini-3.5-flash-lite` (`TAG_MODEL`)                         |
| Review + compact suffix             | `gemini-3.5-flash-lite` (`AUTOCOMPLETE_MODEL`)                |
| Review + full suggestion            | `gemini-3.5-flash-lite` (`GENERATE_MODEL`)                    |
| Tag embeddings                      | `gemini-embedding-001`, 768 dimensions, `SEMANTIC_SIMILARITY` |

Overrides live in [`config.py`](../backend/app/config.py). Suffix output budgets are 768 tokens; full suggestions 2,048; tags 512. Generation uses minimal thinking. `judge_model` remains a configuration field for standalone judging; the active combined pipeline reviews with the selected generation model.

Logs and traces keep metadata for 30 days without raw prompt, knowledge body, or model-response text. Knowledge and explicit handoff prompts are content-bearing Tiger records. Gemini receives the draft and candidate context required for generation. Snowflake receives derived outcome features rather than prompt bodies.

## Handoff and analytics

**Send to Codex** stores a refined prompt through `/v1/handoff`. The `prompt-enhance` MCP plugin fetches it with `get_refined_prompt` and also exposes `enhance_prompt` and `search_knowledge`. The companion hands off explicitly; it does not inject a widget into the Codex composer.

Snowflake training uses the latest decisive outcome per request, requires at least 20 labeled requests with both classes, and reports evaluation metrics to the application. The classifier does not gate suggestions, select candidates, or retrain automatically on each outcome.

## Active development

These changes are present in the development working tree and are **not part of the published main runtime** in this snapshot. They are included in the optional [3D viewer](architecture-view/README.md), and the local index is marked † in the technical diagram.

### Direct local semantic retrieval

The development pipeline tries a fresh paired document/query index first, then eligible lexical nomination, then tags/pgvector. `DIRECT_SEMANTIC_ENABLED=true` and `SEMANTIC_EMBED_BACKEND=local` select this path when optional packages and verified model files are available. Generation remains remote.

- **Encoder:** `onnx-community/embeddinggemma-2-ONNX`, revision `daa72c51243991dfcaf9f9137d2c573d8f7790c0`; quantized ONNX on CPU; 768-dimensional normalized vectors.
- **Installation:** the explicit setup script downloads approximately 346 MB and verifies sizes/SHA-256 hashes. Runtime verifies again and does not download models.
- **Index:** prepared at startup and on background snapshot refresh, keyed by model/configuration, task, title, and content hash. Only a complete current snapshot publishes. Content-addressed vectors can be reused after a fresh source read.
- **Bounds:** at most 256 documents, 2,000,000 source characters, and 4,096 chunks. Full document bodies within the corpus bound are split at Unicode boundaries into chunks of at most 1,800 UTF-8 bytes. Queries exceeding 1,800 bytes fall back without silent truncation.
- **Inference:** local input is bounded to 8,192 tokens after search prefixes. Native inference runs off the async event loop, serialized, with at most four pending jobs.
- **Ranking:** exact cosine nominates up to three documents, with the best-matching chunk passed as evidence. It does not use the tag route's 0.88 threshold or replace fresh relevance review.
- **Fallback:** missing packages/files, a warming or stale index, exceeded bounds, a busy encoder, or inference failure preserve the lexical/tag routes. `SEMANTIC_EMBED_BACKEND=gemini` selects remote `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` embeddings instead.

The new implementation files are `backend/app/llm/local_embeddings.py`, `backend/app/pipeline/semantic.py`, and `backend/scripts/setup_local_embeddings.py`. When using a checkout that contains them, install the `local-retrieval` extra and run the setup script explicitly:

```bash
cd backend
uv sync --extra local-retrieval
PYTHONPATH=. uv run --extra local-retrieval python scripts/setup_local_embeddings.py
uv run --extra local-retrieval uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### In-flight suffix adoption

Uninterrupted end-cursor typing can retain one older request alongside the current request. A response within three seconds can contribute a validated autocomplete suffix only when new text exactly matches its prefix, the remainder is nonempty, and UTF-16 code points remain intact. Questions and unrelated old responses are not adopted. Original request/revision attribution is preserved for outcomes.

## Verify and reproduce

Use the [root setup instructions](../README.md#run-locally) for the published runtime. Backend tests require configured real services; frontend checks include unit/component and real-browser journeys.

```bash
cd backend
uv run pytest -q

cd ../frontend
pnpm test
pnpm typecheck
pnpm test:e2e
```

From `backend/`, with the API running, `PYTHONPATH=. uv run python scripts/bench_enhance.py --base-url http://127.0.0.1:8000 --rounds 2 --output /tmp/latency.json` records API latency. `frontend/scripts/bench-latency.mjs` measures input-to-visible browser latency. Use the development extra when evaluating that route. Provider or embedding timings alone exclude debounce, retrieval, validation, transport, and paint. Review shares generation, so its logical stage must not be counted as a separate inference call.

## Diagram maintenance

Run `python3 docs/diagrams/render_architecture.py` from the repository root to regenerate both SVG themes. The assets contain text and vector geometry, with no JavaScript, external fonts, or image dependencies. Update runtime/development labels when the semantic changes land. The optional [Three.js guide](architecture-view/README.md) describes the secondary 3D model and its capture/export workflow.
