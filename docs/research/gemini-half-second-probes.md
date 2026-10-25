# Gemini provider probes for the 500 ms interaction target

Measured 25 October 2026 with the existing Gemini Developer API key, Python SDK 2.33.0, from the local development machine. No application code, provider/account configuration, billing settings, or stored user payloads were changed. The script sends only five hardcoded synthetic fixtures and saves metadata; generated text is parsed in memory and discarded.

**Result: none of the measured provider configurations delivered a validated suggestion within 500 ms. The current model's first output token alone took 518–808 ms in ten Standard requests. Streaming, an older Flash-Lite model, Priority requests, and a zero thinking budget did not establish a route to the target.** This is an observed floor for this short experiment, not a universal lower bound for Google's infrastructure.

## Method and measurements

[Probe script](/Users/mattlo/Desktop/oxhack-2026/backend/scripts/probe_gemini_latency.py) imports the application's current review rubric, suffix/general prompts, Pydantic schemas, candidate formatting, review validation, edit resolution, and response validation. It uses a shared async client within each run. Cases cover a Python payment retry suffix, a semantically phrased network retry suffix, an HTTP API clarification question, a partial English word, and an unfinished Spanish draft. Relevant and irrelevant synthetic candidates are deliberately mixed. Requests have 486–909 input tokens; these are small fixtures and do not represent production's longest candidate payloads.

There were **26 sequential generation attempts**, coordinated so no other agent was running a live model benchmark:

- Five current-model Standard streams establish initial time to first token.
- Fifteen randomized model/case requests compare 3.5, 3.1, and 2.5 Flash-Lite on the same five cases.
- Four Priority requests cross suffix/question with streamed/non-streamed responses.
- Two current-model `thinking_budget=0` requests check actual acceptance.

The first run and comparison run occurred consecutively; their difference is not a randomized stream-versus-full experiment. Model/case order was randomized within runs, with recorded seeds. Model inventory was checked before every run, outside request timing. The inventory warms a connection but does not guarantee inference entitlement. No retry was added to the probe.

| Configuration | Attempts | Valid response | First output token, median | Full provider response, median | Validated result, median |
|---|---:|---:|---:|---:|---:|
| 3.5 Flash-Lite, minimal, Standard, stream | 10 | 10 | 598.9 ms | 754.0 ms | 754.3 ms |
| 3.1 Flash-Lite, minimal, Standard, stream | 5 | 4 | 641.5 ms | 833.0 ms | 823.8 ms, valid responses only |
| 2.5 Flash-Lite, thinking budget 0, Standard, stream | 5 | 0 | — | HTTP 404 | — |
| 3.5 Flash-Lite, minimal, requested Priority, stream | 2 | 2 | 587.2 ms | 801.8 ms | 802.6 ms |
| 3.5 Flash-Lite, minimal, requested Priority, full | 2 | 2 | — | 801.6 ms | 801.9 ms |
| 3.5 Flash-Lite, thinking budget 0, Standard, stream | 2 | 0 | — | HTTP 400 | — |

The Standard 3.5 aggregate includes both five-call runs. The 3.1 first-token and provider-response medians include its invalid question response; the validated median necessarily excludes that failure. These tiny samples cannot establish population percentiles or quality equivalence.

Raw metadata: [initial current-model streams](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/gemini-probe-current-stream.json), [randomized model comparison](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/gemini-probe-model-stream.json), [Priority requests](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/gemini-probe-priority.json), [zero-budget acceptance](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/gemini-probe-thinking-off.json).

### The first JSON token is not a usable suggestion

The current schema emits review decisions before suggestion text. For Standard 3.5, median first non-thinking output was 598.9 ms, first nonempty `text` field was 687.4 ms, first parseable complete schema was 746.0 ms, and final response validation was 754.3 ms. A parseable partial stream is still provisional until the final response and all application invariants are checked. The script never displays or accepts it.

| Standard 3.5 case | First token, range | Final validated result, range | Output tokens |
|---|---:|---:|---:|
| Explicit retry suffix | 539–617 ms | 703–740 ms | 55–78 |
| Semantically phrased retry suffix | 518–616 ms | 708–810 ms | 76–79 |
| Clarification question | 644–808 ms | 992–1,196 ms | 184–191 |
| Partial word, no candidates | 561–582 ms | 656–700 ms | 34–44 |
| Spanish continuation | 574–715 ms | 768–865 ms | 70–80 |

This explains why streaming can improve progressive perception but does not meet a 500 ms **usable result** target here. Even the candidate-free partial-word case missed it. Questions have an additional 347–382 ms between first token and completed provider response. Suffix cases have a smaller 124–193 ms tail. Those tails contain decoding, chunk delivery, and SDK handling; they are not pure GPU decoding measurements.

These are provider-only timings. Last-keystroke latency also includes any debounce, retrieval dependencies, API/network handling, and rendering. The current [wrapper waits for a complete non-streamed response](/Users/mattlo/Desktop/oxhack-2026/backend/app/llm/gemini.py:47). A streaming implementation should measure actual visible/accepted content separately and must preserve validation and draft-version checks.

## Provider controls: verified versus assumed

**Keep 3.5 Flash-Lite as the control.** The [current model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) lists structured output, caching, and Priority support. The [3.1 model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) positions it for low-latency lightweight work, but it was slower in these fixtures and its question failed an application invariant. No generated text was saved, so this experiment does not diagnose that invariant failure's exact content. It is enough to reject an unqualified quality-preserving migration claim.

**Model listing is insufficient proof of access.** `gemini-2.5-flash-lite` advertised `generateContent` in this key's model inventory, but all five inference attempts returned 404. Google's [2.5 model page](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite) now restricts access to previously active users. The precise reason for this account's 404 was not established because raw error messages were not retained. It is not a usable alternative in this measured environment.

**`minimal` is the lowest supported current control.** Google's [thinking guide](https://ai.google.dev/gemini-api/docs/generate-content/thinking) says 3.5/3.1 Flash-Lite support `minimal`, which usually resembles no thinking but does not guarantee it. It also says Gemini 3 Flash/Flash-Lite cannot fully disable thinking. We verified that current 3.5 rejects `thinking_budget=0` with HTTP 400. All successful probes returned null for `thoughts_token_count` and `cached_content_token_count`; null is not evidence of an exact zero internal compute cost. Existing [application telemetry records only prompt and candidate tokens](/Users/mattlo/Desktop/oxhack-2026/backend/app/llm/gemini.py:129), so adding optional thought/cache counts and actual service tier would make future investigations more informative.

**Priority does not require an Interactions migration.** This corrects the earlier provider audit's overly narrow reading of the generic Priority documentation. The [GenerateContent-specific guide](https://ai.google.dev/gemini-api/docs/generate-content/priority-inference) supports both endpoints, for Tier 2/3 accounts, with `GenerateContentConfig(service_tier="priority")`. Installed SDK 2.33.0 supports this field. Google documents possible server downgrade and the `x-gemini-service-tier` response header. Both non-streamed Priority probes returned **`standard`**; the streamed probes exposed no value for that header. Thus these samples provide no evidence of actual Priority latency, eligibility, or a speedup. The exact reason for downgrade was not established. No account changes were made. Its public latency description is in seconds, not a 500 ms guarantee.

**Explicit cache is not yet a measured fix.** The [cache guide](https://ai.google.dev/gemini-api/docs/generate-content/caching) describes reusable prefix caching and model-specific minimum sizes but omits a Flash-Lite-specific minimum in its current table. The current [prompt builder places candidates before the draft](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/generate.py:100), and the model advertises cache creation support. The measured inputs were only 486–909 tokens with no reported cache hits. Test a naturally large, stable system/candidate prefix if such a real workload exists; do not pad prompts just to reach a threshold. Cache creation and lifecycle work must remain outside the request path. No cache resources were created in this experiment.

**Transport deserves a bounded experiment, not a promised speedup.** The application already [reuses a shared SDK client](/Users/mattlo/Desktop/oxhack-2026/backend/app/llm/gemini.py:18). Local `aiohttp` is absent. Google's [Python SDK documentation](https://googleapis.github.io/python-genai/#faster-async-client-option-aiohttp) offers `google-genai[aiohttp]` as a faster async client. Compare it using the same warm client, randomized fixtures, final validation, and production host placement. Current data cannot separate network RTT, admission/queueing, prefill, reasoning, or decoding. Fast error responses around 150 ms are not valid estimates of the network component of a successful inference call.

## Practical next experiments

1. **Prepare semantic candidates before the pause.** Use background work while typing, with prompt/version/invalidation checks and a fallback for stale or absent preparation. This can remove embedding/retrieval from the post-keystroke dependency chain without dropping the semantic route. It does not by itself eliminate the observed inference floor. Previously validated suffix reuse can produce immediate hits only when the current draft exactly consumes a prefix of that suffix and context remains applicable. Measure hit/miss latency separately; new arbitrary drafts must remain in the target denominator.

2. **Reduce the question representation while keeping expressive edits.** The current [option schema](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/complete.py:98) emits `label`, `op`, `anchor`, and `text` for every option; the current prompt already prefers two short options. An internal append-only branch can omit repeated `op="append"` and empty anchors, with a general-edit branch retained for replacement/insertion cases. Reconstruct canonical edits server-side and run the unchanged invariant validator. Use held-out cases requiring exact replacement, ambiguous anchors, multilingual text, and distinct choices. This is a plausible reduction of the 184–191 token question response; it cannot be credited as a measured improvement yet.

3. **Treat removal of explicit candidate verdicts as a separate quality experiment.** Current [flat review arrays](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/complete.py:91) retain every independent keep decision and numeric score. Returning only used indices after an internal review is smaller, but loses independent score/keep observability and changes the task the model performs. It must not silently replace the current contract under a no-quality-loss requirement. If explored, A/B the same candidates and rubric with held-out contradictions, high-score/keep-false cases, unstated technologies, multiple relevant candidates, and prompt injection. Measure grounding and rejection precision, not merely output validity. It cannot remove a >500 ms first-token wait on its own.

4. **Benchmark actual Priority capacity only when available.** Retain the same model/schema and record the returned tier. Separate downgrade requests from actual Priority requests. Account eligibility/capacity needs confirmation through existing account tooling or Google; our successful HTTP response did not prove Priority allocation. A different Google hosting path or capacity commitment needs its own deployment-region latency and quality comparison; do not assume a different endpoint or reserved throughput equals a subsecond guarantee.

5. **Collect enough data for a real decision.** Next controlled comparison should use paired, randomized repeated fixtures with a fixed inference budget; report successful useful-result coverage, invariant failures, type/grounding correctness, p50/p95 last-keystroke-to-visible-result, and cancellation/staleness rates. Report failed/none responses separately rather than counting instant suppression as success. Include content review on synthetic outputs during evaluation without persisting user text. The present programmatic checks verify expected result type, selected keep decisions, and existing wire invariants; they do not establish semantic or stylistic equivalence.

If 500 ms is required for every novel draft including a newly generated clarification question, the measurements do not currently support that claim with this endpoint/model. The honest engineering choices are to demonstrate a faster Google execution path, generate valid work earlier with measured reuse coverage, or evaluate a different sponsor-compatible serving design. Neither renaming first-token latency as usable output nor omitting the slow fallback would satisfy the stated target.

## Verification

The probe passed Ruff formatting/lint, `mypy --follow-imports=silent scripts/probe_gemini_latency.py`, and its CLI smoke check. Full transitive mypy additionally reported an existing unused type-ignore in `app/observability/writers.py`; this probe did not edit it. No load test was run. No production defaults were changed. The earlier architectural audit remains a historical baseline; these fresh synthetic measurements supplement it after the implemented single-call and compact-schema changes.
