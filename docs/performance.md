# Autocomplete performance results

> Historical measurements: the runs below predate the optional local EmbeddingGemma 2 route and bounded in-flight suffix adoption. See [the current architecture](architecture.md) for today's routing. These results are not a fresh end-to-end benchmark of that implementation.

## Measured implementation: one-call lexical autocomplete

The current default adds a bounded local snapshot of Tiger knowledge for end-of-prompt autocomplete. Metadata-supported lexical matches nominate up to three candidates for a **fresh Gemini relevance review and suggestion in one call**. Requests without suitable local candidates, including ambiguous shared-topic matches, retain semantic tag extraction and embedding retrieval. Mid-prompt editing also retains the semantic route. The snapshot refreshes in the background, expires after 15 seconds, and invalidates after local knowledge changes; suggestions are discarded if their source changes or expires during generation. Snowflake remains offline, and all sponsor providers are retained.

The semantic SQL now parses the vector array once instead of repeatedly casting text inside each distance calculation. Review output uses compact ordered boolean and score arrays, with strict validation and the same relevance threshold.

An intermediate nine-sample autocomplete run took **677–977 ms in process, median 831 ms**, with nine grounded autocomplete results and no errors. Startup was recorded separately; each repeat still made a fresh generation call. Evidence: [intermediate backend samples](evidence/latency-fast-path-three-candidates.json), [fresh pre-change baseline](evidence/latency-before-fast-path.json). These figures exclude HTTP and editor waiting.

The final browser measurement includes the last actual keyboard input, the configured quiet time, HTTP/JSON completion, and a double-animation-frame visibility check:

| Browser metric | Final nine observations |
|---|---:|
| Last keystroke → visible suggestion, median | **951.6 ms** |
| Minimum / maximum | 799.1 / 1,442.7 ms |
| Below one second | 6 of 9 |
| Visible autocomplete / errors / empty responses | 9 / 0 / 0 |
| Input → request, median | 151.4 ms |
| Request → complete JSON, median | 777.8 ms |
| JSON → visible rendering proxy, median | 25.7 ms |

This establishes subsecond **median** in this small localhost development-browser run, not universal subsecond latency. First-round median was 1,079.2 ms; repeat-round medians were 935.9 and 951.6 ms. Nearest-rank p95 equals the maximum with nine observations. Provider variability remains dominant, and the first round is not an isolated provider-cold-start experiment. Every request still performs fresh generation. Evidence: [final browser results](evidence/latency-browser.json), [prior 200 ms browser baseline](evidence/latency-browser-before-settings-refresh.json), [reproducible browser script](../frontend/scripts/bench-latency.mjs). The prior browser median was 1,014.5 ms; sequential runs with several changes cannot isolate the effect of background settings refresh.

The default quiet time is now 150 ms, within the existing supported range. Migration 003 changes the previous 200 ms preset and preserves other configured values. Settings refresh every 2.5 seconds ahead of their five-second expiry; fresh requests do not wait behind maintenance, failed reads do not extend expiry, and committed local updates apply immediately.

A [read-only evaluation of all 29 stored documents](evidence/catalog-recall.json) used 62 synthetic fixtures. All 29 explicit baseline tasks retained their intended document in the top three. All 59 locally routed fixtures retained their 61 expected target documents; one ambiguous positive fixture and two negative controls deferred to semantic retrieval. Canonical word forms avoid counting one concept twice, and incidental body overlap cannot nominate an item. This is a candidate-recall check with hand-authored targets, not proof of complete relevance or equal generated-answer quality. The [previous evaluation](evidence/catalog-recall-before-confidence.json) records the missed migration paraphrase that motivated the ambiguity fallback.

Live quality checks cover partial-word joining, Spanish continuation, complete-request abstention, negated technologies, grounded retries, mid-prompt cursors and UTF-16 boundaries. Review instructions distinguish whole-task applicability from novelty of the next suffix; the compact heuristic no longer treats the noun in “Perform a security check” as an unfinished verb.

A final [HTTP incremental workload](evidence/latency-fast-path-incremental.json) changed each of three prompts twice: nine requests, eight autocompletes and one question, no errors, **853 ms median / 1,184 ms maximum** excluding editor delay. Every request performed a fresh review/generation. A [mixed workload](evidence/latency-fast-path-mixed.json) returned six questions and three autocompletes with no errors, **1,050 ms median / 2,127 ms maximum**. The slowest ambiguous API-performance fixture deliberately took semantic fallback. Therefore broader questions and uncertain retrieval are still not universally subsecond. Model outputs differ from earlier runs, so these small sequential observations are not a controlled quality-equivalence study.

Final selected verification: **77 deterministic backend tests, 12 live enhancement tests, 95 frontend tests, 7 MCP tests, and 2 live browser acceptance/decline journeys passed**. Three MCP live checks were skipped by their existing guards. Backend Ruff lint/format, targeted strict mypy on six runtime/benchmark files, frontend TypeScript and ESLint, and benchmark syntax checks passed. The initial broad backend run had a live relevance failure; the corrected rubric passed the subsequent 12-test live enhancement suite. This is not a claim that the entire repository's typecheck or every optional integration test is green.

Restart the backend after pulling. `CATALOG_REVIEW_ENABLED=false` and `FAST_AUTOCOMPLETE_ENABLED=false` select the tag/pgvector route for comparison. Run the browser script from `frontend/` with the running backend URL and expected configured delay:

```bash
node scripts/bench-latency.mjs --api-url http://127.0.0.1:8000 --expected-delay-ms 150
```

The earlier measurements below describe preceding implementations.

## Earlier measurements

Measured 25 October 2026, on the same local app and configured Gemini/Tiger Data services. All sponsor providers remain in place. The optimized backend is running on port 8000.

## Before and after

| Workload | Before, median | Optimized first visit, median | Optimized exact repeat, median |
|---|---:|---:|---:|
| All nine fixture responses | 4,420 ms | 2,308 ms | 1,192 ms |
| Three autocomplete fixtures | 3,702 ms | 2,123 ms | 802 ms |

First-visit API latency fell **48%** across the fixture set. The autocomplete fixtures fell **43%** on first visits and **78%** on exact repeats. Repeated autocomplete responses took **710–853 ms**. Typing the exact prefix of an already visible suggestion uses **zero new API calls** and retains the remainder locally.

The slowest response fell from 6,421 to 2,646 ms on first visits; the optimized repeat maximum was 1,521 ms. With only nine observations per pass, nearest-rank p95 is the maximum: these are small reproducible smoke measurements, not a production latency distribution or SLA.

There were **zero HTTP failures** across all 18 final optimized requests. Each pass returned three autocompletes, five questions and one `none`. The NOT NULL migration fixture now returned `none` instead of the baseline's question; the model judged the draft sufficiently complete. It was not an error/retry fallback. Therefore the overall row measures API response time, not equal suggestion content. All three autocomplete fixtures remained grounded autocomplete results. Excluding `none`, the optimized first-visit median was 2,322 ms across eight visible suggestions.

Evidence: [baseline metadata](evidence/latency-baseline.json), [optimized metadata](evidence/latency-optimized.json), [same-provider model comparison](evidence/latency-model-comparison.json). The benchmark contains no user prompt text, generated text or credentials.

## What changed

- **Fewer serial calls.** A model reviews every retrieved candidate and generates in one structured response. Removed separate judge fan-out and unused speculative generation. Fresh grounded requests normally use three provider calls; fully cached repeats can use one.
- **Smaller Gemini model and outputs.** Gemini Flash-Lite handles prompt enhancement with minimal thinking. A twelve-call comparison using the compact full schema measured roughly 1,111 ms median generation versus 2,148 ms for 3.6 Flash. This was a small sequential comparison, not a comprehensive quality evaluation. `GENERATE_MODEL=gemini-3.6-flash` keeps the stronger model available without changing providers.
- **Preserved continuation behavior.** The existing tags call classifies unfinished clauses and partial words, including other languages, without another request. Complete/ambiguous inputs ask explicit questions rather than automatically adding guessed requirements. Long drafts retain their true tail during classification.
- **Bounded caches.** Settings, exact tag extraction, tag embeddings and retrieved candidates are reused in memory. Candidate caches invalidate after committed knowledge changes. Each new draft still receives a relevance review.
- **Comparison across edits.** An optional `previous_request_id` lets the existing tag call compare the current and previous drafts. Approved immaterial edits reuse candidates directly; rejected comparisons and unknown/expired references refresh the lookup. The 15-second freshness limit remains anchored to the original SQL read. This does not add a comparison call or reuse relevance verdicts.
- **Abandoned work stops.** Browser cancellation propagates into the backend pipeline. Already-started remote inference may still be billed, but later stages are not launched for abandoned work.
- **Database writes leave the response path.** Traces and use counts persist asynchronously, with immediate pending-trace reads for the inspector and outcomes. Queues drain on shutdown and log clearing.
- **Less client waiting.** Default quiet time drops from 400 to 200 ms, the 120 ms ghost fade is removed, matching typed prefixes reuse the visible suffix, and draft storage is batched. Settings races and IME composition no longer create stale or unnecessary work.
- **Plugin connection reuse.** MCP keeps its local HTTP client alive for the server's lifetime.

The API timing above excludes editor debounce/rendering. The 200 ms default debounce reduction is additional. No streaming endpoint, provider replacement, region change or paid service tier was introduced.

## Quality and limits

Live spot checks included partial-word completion (`Add retr`), a Spanish unfinished clause, knowledge-grounded English suffixes, explicit questions, surrogate pairs and mid-prompt editing. An early Flash-Lite trial added an unsupported database assumption; the final routing requires clarification for complete/ambiguous drafts and prompts forbid unstated technology and repeated phrases. These checks improve the guardrails but do not establish equivalent model quality on every task. The 3.6 override remains available.

Cold requests are **not subsecond**: fresh tag extraction, embedding/retrieval and generation still depend on one another. Exact repeats are a favorable cache scenario, not the same as arbitrary new keystrokes. Local type-through reuse is instant because it reuses a suggestion already generated and validated. A separate [incremental benchmark](evidence/latency-incremental.json) measured three successive extensions of each of three drafts: nine requests, zero errors, seven autocompletes and two questions, **1,933 ms median / 2,460 ms maximum**. New text therefore still costs roughly two seconds when it cannot consume an existing ghost.

Cache invalidation and immediate pending-trace reads assume the existing single-worker app. External database changes are bounded by TTL; multiple workers would need shared invalidation and trace visibility. Background trace writes can be lost on a process crash before commit. Prompt/knowledge payloads remain out of logs.

## Verification

**170 tests passed:** 67 backend tests (including live Gemini, Tiger Data and Snowflake), 86 frontend tests, 10 MCP tests and seven real-browser Playwright journeys. One destructive shared-log deletion test was intentionally skipped by its existing opt-in guard. Tests restored the pre-test Codex handoff and cleaned up their temporary knowledge.

Frontend TypeScript and ESLint passed; backend Ruff lint/format and targeted strict mypy for the pipeline, settings cache and benchmark passed. A broader mypy check still reports existing dictionary-row connection annotations in knowledge code and log-filter typing issues; these are outside the changed runtime behavior and are not claimed as a clean whole-backend typecheck.

Deterministic checks cover timers, stale responses, disabled modes, IME, suffix reuse, UTF-16 edits, per-candidate review, cache invalidation, disconnect cancellation and pending trace visibility. Real-browser journeys exercised Activity, knowledge search/ingest/delete, live suggestion acceptance, decline, settings and Codex handoff.

Reproduce from `backend/` with the live app running:

```bash
PYTHONPATH=. uv run python scripts/bench_enhance.py --base-url http://127.0.0.1:8000 --rounds 2 --output /tmp/latency.json
PYTHONPATH=. uv run python scripts/bench_enhance.py --base-url http://127.0.0.1:8000 --incremental
```

Alternative-provider research, including Cerebras, Groq and OpenAI, is in [provider-latency-options.md](provider-latency-options.md). None was integrated or selected. Vendor token-throughput claims are not evidence of faster autocomplete for this workload.

## Follow-up: edit-aware retrieval and additional knowledge

The requested main-branch sync was a fast-forward check after fetching `origin/main`; both were already at `1fc804b`. Existing local optimization work was retained.

A [four-case live check](evidence/latency-context-gates.json) exercised the final comparison gate: an initial request took 2,679 ms (593 ms retrieval), its cosmetic edit took 1,807 ms (explicit reuse, 0 ms retrieval), and a stack change and negation refreshed retrieval at 441 ms and 504 ms respectively. All four succeeded and every candidate was reviewed again. These cases demonstrate the gate's behavior, not a controlled incremental speedup over the prior cache: identical normalized tags already reused retrieval. Comparison also adds input tokens, and changed requirements deliberately force a fresh candidate query. Model decisions remain fallible.

An early check caught previous-draft anchoring: the model rejected reuse but repeated the old technology tags. The structured response now emits its reuse decision before tags, places the current draft after the previous context, and explicitly requires fresh tags when reuse is rejected. The final stack-change case produced the new technology tags.

Filtering already met the requested concurrency condition. The active pipeline combines all candidate reviews with generation in one request; the optional standalone judge uses `asyncio.gather`. A barrier regression test proves all candidate calls start before any finishes, and another proves one timeout does not discard successful peers.

Eleven new coding and technology-stack templates, with primary sources and applicability constraints, are documented in [knowledge sources](knowledge-sources.md). The earlier before/after measurements above used the original corpus, before these additions.

After loading all 11 additions (29 stored items), separate fresh processes ran the same nine-request incremental scenario [without linking](evidence/latency-edits-unlinked.json) and [with linking](evidence/latency-edits-linked.json). Each pass contains three initial drafts plus six edits. The linked run reused candidates on three of six edits; edit-only median was **2,072.5 ms versus 2,247.5 ms**, about 8% lower. Overall median was 2,225 ms versus 2,321 ms. Both passes had zero errors and seven autocompletes; the unlinked pass returned one question and one `none`, while the linked pass returned two questions. Sequential, small samples with differing model outputs do not establish a production speedup or quality equivalence.

An [HTTP check of an identical draft with a moved cursor](evidence/latency-identical-context.json) confirmed zero tag-inference and retrieval latency, with fresh candidate review and a valid mid-prompt question. Its generation needed one validation retry and took 2,372 ms, so skipping earlier stages does not guarantee subsecond output.

Follow-up verification: 59 selected backend checks passed, including real Gemini/Tiger retrieval with the expanded corpus. After the final identical-draft shortcut, all 19 context-reuse tests passed. The frontend's 45 targeted hook/reducer/DOM tests passed, plus TypeScript and ESLint. Backend Ruff and targeted mypy passed. A live browser acceptance fixture initially failed because its complete draft returned a valid `none` in 2.65 seconds; the fixture now uses an unfinished sentence and checks the wire response before waiting for UI.

All three final live Refine browser journeys passed: acceptance and previous-request linking, decline, and Codex handoff. The pre-test handoff was restored. The updated backend is running locally; changes remain uncommitted.
