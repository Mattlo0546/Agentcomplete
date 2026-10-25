# Gemini latency audit and research

Research date: 25 October 2026. Scope: the current working tree, including its existing uncommitted optimizations. No new model requests, load tests, service changes, or application-code changes were made for this note. Provider documentation was checked live. Measurements below are recomputed from existing metadata fixtures and historical call logs retrieved through the main audit's read-only diagnostics, not new model benchmarks.

## Finding

The current architecture makes approximately two seconds unsurprising. A changed draft normally requires **tag generation → embedding/retrieval → suggestion generation**, with each remote dependency completing before the next starts. Flash-Lite generation itself is around one second in the available small samples. The application therefore has both an avoidable dependency-chain problem and a material provider-call latency floor. The evidence does **not** isolate how much of each Gemini call is network, admission/queueing, prefill, thinking, or decoding.

Keeping Gemini, Tiger Data, and Snowflake is compatible with a substantially faster architecture. It does not require using all three on the synchronous path for every keystroke. The strongest experiment is a dedicated autocomplete path with no live tag-generation dependency, prepared or quickly retrieved context, and one short Gemini response. A reliable subsecond result still needs measurement; the present data cannot establish one.

## What is already implemented

These are baseline capabilities, not proposed new optimizations:

| Current behavior | Evidence |
| --- | --- |
| Tagging, question generation, and suffix generation default to `gemini-3.5-flash-lite`. | [config.py:19](/Users/mattlo/Desktop/oxhack-2026/backend/app/config.py:19) |
| Both active inference calls explicitly use `thinking_level="minimal"`. | [tags.py:76](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/tags.py:76), [complete.py:138](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/complete.py:138) |
| Candidate relevance review and generation share one call; the trace's zero-millisecond `judge` step is descriptive, not another request. | [run.py:154](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/run.py:154) |
| Unfinished drafts can use a compact suffix schema; complete drafts use questions/none. | [complete.py:104](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/complete.py:104), [run.py:71](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/run.py:71) |
| A cached shared SDK client already reuses transport state. | [gemini.py:18](/Users/mattlo/Desktop/oxhack-2026/backend/app/llm/gemini.py:18) |
| Exact tags are cached; identical linked drafts bypass tagging; some immaterial edits reuse candidates after model comparison. | [tags.py:70](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/tags.py:70), [run.py:35](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/run.py:35), [run.py:133](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/run.py:133) |
| Provider metadata logging schedules background writes. Awaiting `_log` does not itself await a database transaction. | [writers.py:28](/Users/mattlo/Desktop/oxhack-2026/backend/app/observability/writers.py:28), [writers.py:51](/Users/mattlo/Desktop/oxhack-2026/backend/app/observability/writers.py:51) |

The older standalone `generate()` and judge helpers are not the active critical path. Optimizing them instead of `complete()` would not address the normal request.

## What the existing measurements establish

| Existing fixture group | n | Recorded request median | Tags median | Retrieval median | Generation median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Optimized first visits | 9 | 2,308 ms | 666 ms | 509 ms | 942 ms |
| Optimized exact repeats | 9 | 1,192 ms | 0 ms | 112 ms | 1,052 ms |
| Incremental typing, earlier corpus | 9 | 1,933 ms | 721 ms | 226 ms | 994 ms |
| Linked edits, expanded corpus | 9 | 2,225 ms | 777 ms | 451 ms | 997 ms |
| Unlinked edits, expanded corpus | 9 | 2,321 ms | 744 ms | 448 ms | 1,050 ms |

Sources: [optimized](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-optimized.json), [incremental](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-incremental.json), [linked](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-edits-linked.json), [unlinked](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-edits-unlinked.json). Independent stage medians must **not** be added and presented as a measured request. Fixtures mix autocomplete, multiple-choice, and `none`. Optimized/earlier incremental measurements use HTTP; linked/unlinked edit measurements are in-process and exclude browser-to-backend HTTP. All exclude editor debounce and rendering. Corpus and guardrails also changed between files.

The model comparison recorded six generations per model: Flash-Lite median 1,110.5 ms versus 3.6 Flash 2,148 ms. It was sequential, involved changing result types, and reused upstream caches asymmetrically. It supports keeping Flash-Lite as the first candidate, but proves neither quality equivalence nor an intrinsic twofold speed advantage. [Comparison evidence](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-model-comparison.json)

The three cached autocomplete fixtures were 710–853 ms at the API, with an 802 ms median. Adding the configured 200 ms editor quiet period already places the median around one second before rendering. Exact-repeat cache success is a favorable workload, not a forecast for arbitrary new text. [Existing performance report](/Users/mattlo/Desktop/oxhack-2026/docs/performance.md)

The main audit also fetched historical provider-call metadata and matched request IDs to fixture result types. This gives stronger evidence about output size:

| Matched historical generation group | Successful calls | Median input tokens | Median output tokens | Median provider-call duration |
| --- | ---: | ---: | ---: | ---: |
| Optimized autocomplete | 6 | 1,442 | 140 | 819.5 ms |
| Earlier incremental autocomplete | 7 | 1,457 | 136 | 899 ms |
| Linked-edit autocomplete, expanded corpus | 7 | 1,970 | 198 | 971 ms |
| Linked-edit multiple-choice, expanded corpus | 2 | 2,253 | 328.5 | 1,368.5 ms |

Across recent successful historical calls, the respective medians were 740 ms for tags (n=78), 269.5 ms for embedding (n=60), and 1,025 ms for generation (n=87; mixed output types). These samples overlap earlier fixtures and must not be treated as independent evidence. They establish that even the suffix path emits substantial structured output; logs do not isolate suffix tokens from review/JSON tokens, so the exact removable fraction remains unmeasured. Different corpus sizes and request sets prevent attributing the token/latency differences to candidate count alone. [Read-only diagnostic evidence](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-audit-diagnostics.json)

## Ranked changes worth testing

### 1. Remove tag generation from the autocomplete dependency chain

**Mechanism:** Today every changed draft waits for `extract_tags()`, including the semantic comparison that can approve retrieval reuse. That gate itself costs roughly 0.6–0.9 seconds in these fixtures. Only the initial `has_tags()` lookup runs alongside it. [run.py:133](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/run.py:133)

**Experiment:** Route obvious suffix requests locally from cursor/end-of-draft state, with conservative multilingual/partial-word handling. Retrieve directly from the current draft using lexical/hybrid search or its embedding; alternatively use a versioned context packet prepared during earlier typing. Keep Gemini tag extraction for background enrichment, ingestion, or the slower question path. Gemini still generates the suffix, Tiger Data still supplies knowledge, and Snowflake still supports analytics.

**Expected direction:** Removes one whole serial inference call, rather than shaving token counts from it. This is an architectural opportunity supported by the recorded tag duration, not a measured speedup. Direct remote embedding still costs a call; a cached or lexical fast path can remove that dependency too.

**Quality risk:** Existing tagging also supplies continuation classification, missing constraints, and the knowledge-reuse gate. Removing it without replacing those responsibilities changes behavior. Never carry old technology requirements through a stack change or negation. Use a no-knowledge suffix/`none` fallback when new-context preparation misses the deadline. Rerank current context or validate applicability before displaying a grounded suggestion. Do not silently make all changed drafts eligible for the old candidate set.

### 2. Reduce actual generated metadata before considering a smaller token ceiling

Every retrieved candidate currently generates `{candidate, keep, score}` **before** the suggestion. Both `ReviewedCompletion` and `ReviewedGeneration` place `reviews` first. An autocomplete whose user-visible answer is only a few words must still serialize all those review objects. [complete.py:69](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/complete.py:69), [complete.py:99](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/complete.py:99)

First test an ordered numeric score vector such as `scores: [0, 0.9, 0.2]`, with exactly one value per candidate and application-derived keep decisions at the existing 0.5 threshold. This retains per-candidate scores while removing repeated candidate indices and keep keys. Current code additionally honors a model-emitted false keep value even above the threshold, so explicitly evaluate how collapsing that redundant decision affects relevance. An ordered boolean keep-mask or kept-ID list is a further experiment only if per-candidate scores are unnecessary on the response path; richer scores could then be computed asynchronously. Retain complete candidate-accounting validation. A second experiment is a smaller top-k after stronger retrieval, measured against relevance recall; this cuts both prompt and output size. Removing reviews entirely is a quality intervention, not a serialization-only change.

The current 512/768/2048 `max_output_tokens` values are ceilings. Lowering a ceiling that is not reached does not by itself remove emitted tokens. A too-small cap can truncate required JSON, while a validation failure may cause an additional full generation. Reduce the schema/task first, then calibrate the cap against measured output lengths and finish reasons. Gemini documents that the limit includes thinking plus visible output, and `minimal` does not strictly guarantee zero thinking. [Thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking)

### 3. Stream only after defining the first *useful and safe* output

`generate_structured()` currently waits for the complete response and parses the complete model object. [gemini.py:47](/Users/mattlo/Desktop/oxhack-2026/backend/app/llm/gemini.py:47)

Gemini supports streaming structured output, and documents schema-key output order. Chunks are partial JSON fragments; they are not necessarily independently parseable objects. [Structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)

For the current schema, raw time-to-first-token will often mean the beginning of `reviews`, not ghost text. Measure time to first non-thinking token, first suffix character, a valid suffix object, and final validated response separately. A compact review mask followed by the suffix preserves the intended review-before-generation behavior while shortening the wait. Putting the suffix first changes that reasoning order and needs its own grounding evaluation.

Expose a revision-bound suggestion event over SSE/streamed HTTP. Incremental decoding must handle escaped strings and incomplete UTF-8/JSON, then preserve the existing partial-word and UTF-16 checks. Do not accept a partial anchor edit or stale revision. For a 25-word suffix, the gain may be modest if provider TTFT dominates; streaming cannot remove the preceding tags/retrieval chain. Flash-Lite's model page says Live API is unsupported, so a WebSocket Live API migration is not an equivalent transport switch. [Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)

### 4. Give autocomplete an overall deadline and explicit retry policy

The wrapper has an eight-second timeout **per call**, and `_generate_step()` allows two validation attempts. That is not an end-to-end interactive latency budget. [config.py:26](/Users/mattlo/Desktop/oxhack-2026/backend/app/config.py:26), [run.py:80](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/run.py:80)

For autocomplete, a stale late success is usually less valuable than waiting for the next current draft. Allocate the remaining request deadline to each stage and do not begin repair generation if it cannot meet the display deadline. Keep the longer repair policy for explicit questions if their product SLO permits it. Report deadline misses separately from correct semantic `none` responses so a fast empty response cannot masquerade as success.

The installed SDK is 2.33.0. Local source inspection found that `retry_args(None)` uses one attempt, despite the retry-options field documentation describing five attempts when an options object is supplied. Do not claim that automatic five-attempt retries explain the normal latency. The optional aiohttp transport has an implicit 1–10 second reconnect delay for selected connection failures when explicit retry options are absent; set and verify a deliberate retry budget if adopting that transport. This is a possible tail issue, not evidence for the observed median.

### 5. Test provider tier, transport, and geography as isolated experiments

| Lever | Verified availability / limitation | Recommendation |
| --- | --- | --- |
| Current model and thinking | Flash-Lite is positioned for latency-sensitive workloads; `minimal` is already used. | Keep as control. Benchmark quality before changing models. |
| Priority inference | Preview on the **Interactions API**; Flash-Lite supported; 75–100% premium; documented latency is seconds; congestion may downgrade to Standard, reported in `x-gemini-service-tier`. | Test Standard/ Priority with the same workload after validating endpoint/schema/streaming compatibility. No subsecond guarantee. [Priority docs](https://ai.google.dev/gemini-api/docs/priority-inference) |
| Async transport | Official SDK offers `google-genai[aiohttp]`; current environment has no aiohttp, and `google-genai` is declared without that extra. | A/B transport with connection reuse and retry settings held constant. Treat as a likely smaller gain unless profiling says otherwise. [SDK documentation](https://github.com/googleapis/python-genai#faster-async-client-option-aiohttp) |
| Google Cloud endpoints | Cloud regional/global endpoints and provisioned capacity are a separate integration choice from this API-key-only `genai.Client`. Global routing improves availability but is not a nearest-region guarantee. | Measure app-to-Google latency from candidate deployment locations and then test the exact endpoint. Do not assume a location argument changes the current Developer API route. [Endpoint documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations) |
| Provisioned Throughput | Dedicated capacity is a capacity/reliability option; the published covered-model SLA describes p50 output TPS, not end-to-end subsecond autocomplete. | Consider only with concurrency/queueing evidence and sponsor access. [Google SLA](https://cloud.google.com/vertex-ai/generative-ai/sla) |
| Batch/Flex | Intended for latency-tolerant work. | Useful for ingestion/evaluation, not keystroke suggestions. [Inference options](https://ai.google.dev/gemini-api/docs/optimization) |

Model IDs are not interchangeable configuration strings. The currently documented 3.8 Flash does not accept `minimal`; the wrapper hardcodes it. Current text-generation guidance also says 3.6+ ignores custom sampling parameters and plans future errors; earlier Gemini 3 guidance recommends defaults. The current code uses temperature 0 for tags and 0.2 for generation. Compare defaults for quality and output length rather than claiming temperature 0 is a latency optimization. A model migration needs capability-aware configuration. [Thinking support](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [generation configuration](https://ai.google.dev/gemini-api/docs/generate-content/text-generation)

### 6. Treat provider caching as a measured opportunity, not the main plan

The current prompt already puts the draft last, but cursor/settings and task features precede knowledge, so changing those fields can shorten the shared prefix. [generate.py:86](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/generate.py:86)

Google recommends common content at the beginning for implicit caching. Its current table lists a 4,096-token minimum for 3.6 Flash but omits a 3.5 Flash-Lite minimum, although the model page lists caching support. That is insufficient evidence to assign Flash-Lite a numeric threshold. Verify it with Google and observed cached-token usage. Never enlarge a short prompt merely to hit a cache minimum. [Caching docs](https://ai.google.dev/gemini-api/docs/generate-content/caching)

Input savings and app-level exact-response caching are different mechanisms. Provider prefix caching cannot eliminate the need to produce a new suffix. For small prompts and short outputs, queueing/transport/decoding can dominate even after prefill is cached. Reorder only after measuring prefix hit rate and whether prompt changes affect relevance quality.

## Research: which advanced techniques actually apply here?

| Primary research | Mechanism and result | Applicability to this repository |
| --- | --- | --- |
| Leviathan, Kalman, Matias, ICML 2023, [Fast Inference from Transformers via Speculative Decoding](https://research.google/pubs/fast-inference-from-transformers-via-speculative-execution/) | A cheap draft proposes tokens, the target scores them in parallel, and rejection sampling preserves the target distribution. The paper reports 2–3× on its T5 setup. | Requires control of the decoding/verification loop. Two ordinary Gemini HTTP calls, one to draft and one to review, do not reproduce this algorithm. |
| Sun et al., ICLR 2025, [Block Verification Accelerates Speculative Decoding](https://arxiv.org/abs/2403.10444) | Joint block verification improves expected accepted tokens; paper reports an additional 5–8% wall-clock benefit over token verification. | Relevant to a sponsor-operated inference backend or self-hosted model. No documented Gemini application knob exposes this verifier. |
| Li et al., 2025, [EAGLE-3](https://arxiv.org/html/2503.01840v3) | Trained draft model combines target hidden-layer features. Its headline maximum is 6.5×; a more relevant optimized SGLang example on one H100 is 158.34→373.25 tokens/s at batch one, and 1.38× throughput at batch 64. | Requires hidden states, a trained draft head, and inference-engine integration. The headline is not an end-to-end API multiplier, and cannot be implemented in this Gemini wrapper. |
| Narasimhan et al., ICLR 2025, [Faster Cascades via Speculative Decoding](https://arxiv.org/abs/2405.19261) | Combines cost/quality deferral with speculative verification; experiments use Gemma and T5. | Useful motivation for separating simple suffixes from harder questions. Its token-level scheme still requires inference control. An app-level sequential fallback adds latency on escalated requests. |
| Liu et al., March 2026 preprint revision, [Speculative Decoding: Performance or Illusion?](https://arxiv.org/html/2601.11580v2) | Studies production vLLM across methods, batch sizes, and workloads. Verification occupies 42–95% of measured runtime; draft overhead and acceptance vary. | Reinforces measuring the actual short-output workload and load level. These findings concern model-serving execution, not network API latency, and do not establish Gemini internals. |

Google publicly says speculative decoding is part of products such as AI Overviews, but does not disclose from that statement the decoding configuration used for this application's Gemini model/version. [Google Research retrospective](https://research.google/blog/looking-back-at-speculative-decoding/)

The immediately transferable idea is **prepare likely useful work before it is needed, and verify whether it still applies**. At the application layer that means context preparation during typing, local reuse of an already validated suffix, versioned caches, and cheap routing. It does not mean sending a second model call to validate every draft. A Gemini-trained local classifier or small Google open model could eventually supply cheap gating while preserving the sponsor, but introduces training/hosting/quality work and should follow simpler experiments.

## Experiments and acceptance criteria

1. **Instrument the existing control first.** Record per-call model/version, request start, first non-thinking token, first useful suffix, completion/validation, prompt/output/thinking/cached tokens, finish reason, candidate count, schema version, validation attempt, cancellations, deadline misses, and returned service tier. Current logging stores only total call latency and prompt/candidate tokens. [gemini.py:116](/Users/mattlo/Desktop/oxhack-2026/backend/app/llm/gemini.py:116)
2. **Run a representative, randomized paired benchmark.** Keep corpus/settings/client region fixed; separate cold starts, exact repeats, new drafts, append edits, negations, technology changes, multilingual input, cursor changes, and type-through reuse. Report n, p50/p95, and first useful validated suggestion time by result type. A useful initial trial is at least 100 observations per major condition across multiple time windows; it remains an estimate, not a production SLA.
3. **First ablation: no tag dependency for eligible suffixes.** Compare current path with direct retrieval plus one suffix call. Match candidate budgets and assess relevance, unsupported assumptions, correct `none`, partial-word joining, and quality/coverage, not just speed.
4. **Second ablation: compact review metadata and top-k.** Independently vary schema representation and candidate count so the cause of a gain is identifiable. Preserve full context applicability checks.
5. **Third ablation: structured streaming.** Compare first useful suffix and final valid response. A faster stream of review metadata does not pass. No stale/partial invalid edits may become acceptable.
6. **Then provider experiments.** A/B transport, Priority, endpoint/location, and alternate Google models one variable at a time. Include cancellations, error tails, cost per useful suggestion, and actual tier, not vendor token/s alone.

Define the product SLO from the **last user keystroke to usable ghost text**. With a 200 ms quiet period and a 1,000 ms goal, backend-plus-network-plus-rendering has less than 800 ms. A sensible design budget might allocate 550–650 ms to the one Gemini call and 100–150 ms to everything else; these are targets, not predictions. If one short Gemini call cannot meet the budget at the required percentile, make prepared/local suggestions the primary path and show slower Gemini-backed improvements separately. A timeout returning `none` does not count as a successful suggestion.

## Verification limits

This is a source audit, historical-metadata analysis, and live-documentation review. Existing samples are small and partly sequential; no new model latency or quality measurements were taken. User prompt payloads and secrets were not read or logged. Documentation lists capabilities rather than this account's entitlement; Priority/Cloud access and cache behavior need account-specific verification. The repository's provider round-trip timings cannot apportion Google queueing, model execution, and network cost, and no paper establishes a subsecond guarantee for this particular managed API workload.
