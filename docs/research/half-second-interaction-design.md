# Safe overlap and streaming toward a 500 ms interaction target

Design review, 25 October 2026, followed by the bounded implementation and measurements documented below. The frontend agent instructions and bundled Next.js Playwright guide were reviewed. Design-section line references describe the pre-salvage application; the implementation section links current files.

## What the existing measurements permit us to claim

The [real-browser run](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-browser.json) measured 951.6 ms median and 1,442.7 ms maximum from the final trusted input event to a populated ghost followed by two animation frames. Nine requests all produced autocompletes. This is already the one-call local-catalog route on its known fixtures, not the old three-call path.

Subtracting each observed debounce and inserting a hypothetical new one gives the following arithmetic, **not a new benchmark**. It assumes provider, network and rendering time stay identical, which may be false when request frequency increases:

| Debounce | Reconstructed median | Reconstructed maximum | Cases ≤500 ms |
|---|---:|---:|---:|
| 150 ms | 950.0 ms | 1,440.6 ms | 0/9 |
| 100 ms | 900.0 ms | 1,390.6 ms | 0/9 |
| 50 ms | 850.0 ms | 1,340.6 ms | 0/9 |
| 0 ms | 800.0 ms | 1,290.6 ms | 0/9 |

Scheduling alone cannot deliver 500 ms on fresh final prompts. Overlap can hide work started while someone was still typing, conditional on the prediction remaining applicable. Streaming may reduce decoding delay if genuinely usable output arrives early enough. Neither changes a provider's first-output floor. Unknown-topic and ambiguous catalog matches still deliberately use semantic fallback in [catalog.py:207](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/catalog.py:207); preserving that quality safeguard means those slow cases need their own solution.

## First bounded candidate: salvage fully validated in-flight suffixes

Before this change, [use-enhance.ts](/Users/mattlo/Desktop/oxhack-2026/frontend/src/lib/enhance/use-enhance.ts) canceled every active request when text changed. [state.ts](/Users/mattlo/Desktop/oxhack-2026/frontend/src/lib/enhance/state.ts) accepted only the current request/revision. Visible-ghost type-through reuse was already implemented; the extension applies the same exact-text idea to a result that arrives after compatible typing.

Maintain a separate optional speculative snapshot rather than weakening the existing `isCurrent` check. Its identity includes original request/revision, original prompt/cursor, a local invalidation epoch, start time, and configuration/version metadata where available. A dedicated `adoptRebasedCompletion` action must check all of the following atomically:

1. The response is a **complete server-validated autocomplete**, valid against its original snapshot. Never salvage `multiple_choice`, `none`, partial JSON, or an error.
2. Since the source snapshot, every edit has been an insertion at the collapsed end cursor. Reject any deletion, replacement, selection change, IME session, paste/replacement, mode change, dismissal or document reset. Do not recover applicability merely because the text later happens to equal an old value: the invalidation epoch must still match.
3. If source prompt is `P`, current prompt is exactly `P + A`, and returned suffix is `S`, require `S.startsWith(A)`. Only show `S.slice(A.length)`. The combined document must satisfy `current + remainder === P + S` byte-for-byte at the JavaScript string level; no normalization or semantic similarity matching.
4. Validate UTF-16 boundaries and the remaining nonempty suffix. A consumed emoji must not leave a lone surrogate. A fully consumed suffix is not a visible suggestion and must not be counted as one. Typing unseen predicted text is not an explicit acceptance event.
5. Never overwrite a response already accepted for the exact current revision, including a fresh `none` decision. Preserve the original request/revision for trace attribution and use the current revision only for rendering applicability.

Keep the existing backend freshness checks. A result remains subject to knowledge/configuration invalidation in flight. The current API exposes no knowledge generation identifier, so a client cannot certify freshness indefinitely after the response; do not add a long-lived cross-request prediction cache under this change. Preserve existing snapshot validity semantics and use only a short, bounded in-flight window. An explicit version token/invalidation mechanism would be needed for stronger guarantees.

On Tab acceptance, atomically append exactly the visible remainder and cancel all outstanding responses. Subsequent callbacks must not rewrite accepted text. On divergence or any invalidating event, immediately cancel the speculative request and clear its eligibility.

### Scheduling without starving the current draft

Use at most **one speculative request plus one exact-current request**, with separate abort controllers and IDs. Retain a pending request only for append-only changes; the ordinary quiet-time request for the current draft must not wait behind it. Cancel obsolete work when a useful current result wins. This is a concurrency cap, not permission to queue old drafts.

First test salvage with the current 150 ms quiet-time policy. It helps ordinary pause/resume typing without multiplying initial requests. Then test a separate optional trigger at a meaningful word/clause boundary before the quiet interval elapses, with a starting cap of one speculative launch per 500 ms. The interval is an experiment parameter, not an evidence-backed optimum. Avoid empty/tiny prompts, IME, selection edits and disabled modes.

Sending a request at a boundary while the user keeps typing can overlap hundreds of milliseconds, but it must predict every subsequently typed character for salvage to work. For instance, a request begun 400 ms before the final key and completed in 750 ms could appear ~350 ms after that key **on an exact-prefix hit**. A miss gets the normal fresh request and its normal latency. Report both. More speculative calls can consume provider quota and increase queueing; foreground latency must not regress under the same offered load.

## Streaming: necessary conditions for an actionable suggestion

Google documents [streamed structured output as partial JSON](https://ai.google.dev/gemini-api/docs/structured-output). Partial JSON availability is not a validity or semantic-completeness guarantee. The [existing research audit](/Users/mattlo/Desktop/oxhack-2026/docs/research/autocomplete-architecture-audit.md) distinguishes this from Cursor/Google's specialized inference and from model-level speculative decoding.

The current [ReviewedCompletion schema](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/complete.py:91) orders `keep`, `scores`, `text`, then `completes_partial_word`. Every review array must have exactly one validated decision per candidate. The word-joining flag affects whether text attaches to a partial word. [run.py:177](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/run.py:177) also rejects a result if knowledge changed or expired during inference. The client currently awaits full JSON.

There are three different experiments:

| Experiment | What is safe to count | Limit |
|---|---|---|
| Stream transport, commit only after full validation and applicable provider finish checks | Full usable suggestion | Low correctness risk, but saves little if useful text is already near the end of a short response. |
| Show incremental text before commit, Tab disabled | Preview latency only | Does not meet “useful suggestion in 500 ms.” Must not replace the real metric. |
| Emit independently complete, validated suggestion objects before optional later extensions | Time to first committed object, after quality evaluation | Changes the generation contract and output distribution; needs targeted quality checks. It is not equivalent to exposing an arbitrary word prefix. |

For a streaming prototype, preserve candidate review before suggestion content and put the word-joining flag before text. Use a proper incremental JSON tokenizer that handles escaped quotes, Unicode escapes, chunk boundaries and duplicate keys; never regex-extract a string from unfinished JSON. `keep`/`scores` can be validated only after their complete arrays close.

The conservative commit point is a complete standalone suffix object, all dependent fields validated, current knowledge/settings valid, acceptable generation termination, and current/rebased revision verified. Questions and anchored edits remain atomic. If a later error could invalidate an accepted prefix, that prefix was not safe to commit under unchanged semantics. Reordering fields alone does not fix this.

Word boundaries are insufficient quality gates. “without deleting” and “without deleting existing data” are different useful units; accepting a half-built restriction can change intent. Structural checks in [validate.py:28](/Users/mattlo/Desktop/oxhack-2026/backend/app/pipeline/validate.py:28) only check mode, insertion position, nonempty text and length. They do not prove grounding, semantic completeness or absence of invented requirements. Calling an early chunk “validated” on those checks alone would overstate retained quality.

A model instructed to emit a self-contained 4–8-word first suggestion may improve time-to-useful output, but compare its acceptance, constraint coverage and usefulness against the existing ≤25-word suggestion. Do not silently lower quality or replace a necessary clarification with a generic fast phrase.

## Tests that should gate implementation

| Fixture | Required outcome |
|---|---|
| `P="Add retr"`, validated `S="ies with bounded backoff"`; user appends `"ies"` | Salvage only `" with bounded backoff"`; no duplicated characters. |
| Same source; user appends `"ieval"` | Reject and use the exact-current request. |
| User appends a new negation/technology not exactly predicted | Reject; fresh retrieval/review remains necessary. |
| Append, backspace, then retype to identical final text | Epoch invalidated; no salvage from the old request. |
| Cursor leaves end then returns, selection changes, IME starts/ends | No old result can reappear. |
| Emoji, combining marks, non-English partial words | Exact comparison, no broken UTF-16; no English-only eligibility assumption. |
| Old autocomplete finishes after a current question or `none` | Old result cannot replace the newer decision. |
| Tab/Escape during competing responses | Accept once or dismiss once; late callbacks cannot undo either. |
| Stream split inside `\\uD83D`, escaped quotation, review array, or a number | No premature parse/commit; no malformed rendered text. |
| Truncated/overlength output, invalid review count, late failure | No actionable partial result under the conservative contract. |
| Knowledge deletion/version change during stream | Discard before commit; never retract user text already accepted. |
| True fresh paste/one-shot input, including slow semantic-fallback cases | Full cold latency reported; no prefetch/repeat bucket substituted. |

Use fake deferred responses and clocks for scheduler/reducer races, then browser-level tests for trusted input, actual visibility, Tab behavior and stream chunking. The existing [benchmark](/Users/mattlo/Desktop/oxhack-2026/frontend/scripts/bench-latency.mjs) needs a separate scenario mode; its current exact-final-prompt matcher would miss salvaged responses by design.

Extend evidence with `source_request_revision`, `render_revision`, `append_units_consumed`, `request_started_before_last_input_ms`, `route`, `speculative_hit`, request count, canceled work, first-preview time, first-committed time and first-paint time. Keep prompt/generated text out of persisted telemetry. For quality review, use only the explicit synthetic fixture corpus and inspect outputs transiently.

Report distributions separately for fresh final inputs, matched speculative suffixes, speculative misses, exact repeats, and semantic fallback. Also report overall coverage and useful retained text, not only latency of successes. Use mixed fast/slow typing and adversarial edits; the previous 5 ms typing benchmark alone does not evaluate an overlap strategy fairly. A 500 ms target including slow cases is achieved only if those cold/miss/fallback groups meet it while preserving quality. Until the provider TTFT measurements establish an adequate budget, the safe bounded implementation candidate is **fully validated prefix salvage**, not a claim of universal half-second inference.

## Implemented bounded overlap and independent challenge benchmark

[state.ts](/Users/mattlo/Desktop/oxhack-2026/frontend/src/lib/enhance/state.ts) now tracks one retained in-flight snapshot separately from the exact-current pending snapshot. The ordinary `isCurrent` path is unchanged. A dedicated `retainedResponse` action accepts only complete source-valid autocompletes whose exact predicted prefix equals all subsequently typed UTF-16 units. It rejects split surrogate pairs, empty remainders, `none`, questions, invalid identities and invalid insertion points. Source attribution stays on the original request while render applicability uses the current revision.

[use-enhance.ts](/Users/mattlo/Desktop/oxhack-2026/frontend/src/lib/enhance/use-enhance.ts) retains a request only through `insertText` changes at a collapsed end cursor, and caps adoption at 3,000 ms from request start. No completed-response cache was added. Deletes, replacement/paste input, cursor/selection changes, composition, Escape, settings changes, backend switches and acceptance invalidate eligibility. At most one obsolete plus one current request remain active. A current request is never delayed behind retained work; its validated response, including `none`, supersedes the older suggestion. Accepting a retained suffix cancels its competing work. A successful adoption before the ordinary timer fires cancels that timer. The trigger delay remains unchanged.

The API still has no corpus generation token. The implementation uses the existing server freshness checks and adds no post-response cache lifetime; it cannot prove stronger response-to-render corpus freshness than the existing endpoint. The three-second bound is a conservative application limit, not a corpus freshness certificate.

[salvage.test.tsx](/Users/mattlo/Desktop/oxhack-2026/frontend/src/lib/enhance/__tests__/salvage.test.tsx), reducer tests and editor journeys cover prefix matches/misses, invalid source responses, Unicode boundaries, newer `none`/question wins, deletion/retyping, paste, replacement, IME, selection, settings/backend changes, expiry, request caps, Escape and Tab races. Final frontend validation passed all 127 tests, type checking, linting, changed-file formatting checks and `git diff --check`.

The [browser benchmark](/Users/mattlo/Desktop/oxhack-2026/frontend/scripts/bench-latency.mjs) retains its repeat default and adds `--scenario challenge`: 12 distinct synthetic fixtures, one round by default, saved separately to `latency-browser-challenge.json`. It covers semantic paraphrase, a vague API request, explicit technology exclusions, partial words, Spanish, Unicode, one-insertion inputs and edits made after a prefix request begins. Single insertion uses trusted browser `insertText`, not OS clipboard access. Source request IDs on rendered ghosts let the instrument attribute prefix reuse accurately. Only metadata and fixture IDs are persisted. A rendered answer is not independently quality-approved; `none` and errors remain separate.

The corrected [old-backend challenge baseline](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-browser-challenge-before-local-embeddings.json), against the existing process on port 8000 and current frontend, measured:

- 12 cases: 9 visible, 3 `none`, no errors; zero visible results within 500 ms.
- Visible median 987.4 ms, maximum 2,695.3 ms; 5 visible results below one second.
- One genuine retained-prefix hit: 777.5 ms from final input, original request started 66.1 ms before that input; 7 UTF-16 units consumed. The competing exact request was still pending at the first usable render.
- Two additional requests across the two append-during-request fixtures. This is overlap coverage evidence, not a cold-start guarantee or a request-cost reduction claim.

An earlier [animation-observer run](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-browser-challenge-before-local-embeddings-animation-observer.json) used only DOM mutations to notice question visibility. Compositor animation can change computed opacity without an attribute mutation, so its question-render delays are upper bounds, not reliable earliest-visibility measurements. The corrected instrument polls rendering frames while a completed response awaits visibility, then uses the same two-frame paint proxy. Question cards now appear immediately; selected-option diff animation remains. Do not attribute the difference between these two runs solely to provider or backend changes: frontend behavior, measurement, model outputs and normal provider variability all changed.

These are sequential local development measurements. Backend/provider caches were not reset; fixture wording is distinct within a challenge run but may already be known to the running system. The source hashes identify files at launch, not the code loaded by an existing backend process. Later local-embedding/backend comparisons must use the corrected challenge and report coverage changes alongside latency.

## Semantic-first experiment: a regression on the mixed browser challenge

The [local-embedding experiment](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-browser-challenge-local-embeddings.json) used **semantic-first routing**, not lexical-first routing with semantic fallback. The corresponding [fixture comparison](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/latency-browser-challenge-comparison.json) includes metadata-only server stage timings. This experiment does not justify making semantic-first the blanket latency default:

| Measure/case | Corrected lexical baseline | Semantic-first experiment |
|---|---:|---:|
| Visible / none / errors | 9 / 3 / 0 | 9 / 3 / 0 |
| Visible median | 987.4 ms | 1,287.8 ms |
| Visible maximum | 2,695.3 ms | 3,509.5 ms |
| Visible within 500 ms | 0 | 0 |
| Visible below one second | 5 | 0 |
| Vague API request | 2,695.3 ms | 1,470.8 ms |
| Paraphrased online migration | 954.9 ms | 1,166.6 ms |
| New settings-form tests | 1,050.9 ms | 1,302.7 ms |
| Ambiguous migration plan | 1,337.5 ms | 1,414.5 ms |
| First one-insertion retry request | 1,171.4 ms | 3,509.5 ms |
| Complete arithmetic (`none`, JSON latency only) | 1,745.6 ms | 1,156.6 ms |

The vague API case improved by 1,224.5 ms, but most previously fast visible cases became roughly 200–300 ms slower. Unicode changed from `none` to autocomplete; the negated in-flight migration changed from autocomplete to `none`. Equal total coverage therefore hides changed per-fixture behavior. The retry append had a retained-prefix hit in the baseline and an exact-current response in this run, so that comparison also includes prediction variability. These sequential samples cannot isolate provider variance, changed candidate context, caching and routing effects.

The first request's server trace reports 2,080 ms retrieval and 1,161 ms generation. Later retrieval was 91–297 ms and generation 766–1,094 ms. The retrieval stage currently combines snapshot availability/refresh, encoder queue wait, query inference and ranking. `semantic.select` does not build the index inline, and startup awaits index preparation; however the aggregate trace cannot identify whether that initial delay came from Tiger refresh, queued/native encoder work or CPU contention. Add separate metadata timers before asserting a cause. An existing index and an already loaded process are not a guarantee that the first measured query will be fast.

The next routing candidate preserves the validated lexical path for confident matches and uses local semantic retrieval for misses. Semantic-first remains an explicit recall experiment. That candidate requires its own browser measurement; these results must not be relabelled as evidence for it. No frontend embedding-prefetch endpoint was added, and the trigger delay stayed at 150 ms.

### Quality finding and actual browser interactions

Selected synthetic responses were inspected in an ephemeral file, with no raw knowledge content committed. The complete arithmetic request returned `none`, as did the excluded-framework and negated-migration fixtures. The partial-word fixture exposed a quality failure: `Add retr` received suffix `o`, producing `Add retro` despite insufficient task context. The backend wire response itself contains that suffix, and the browser attributed it to an exact-current response with zero consumed prefix units. This is not a frontend salvage or joining bug: model text is copied to the response, and `join_suffix` can only add a word gap.

The general remedy is to give task ambiguity precedence over partial-word completion. A fragment alone does not identify the user's intended task; when plausible expansions imply different tasks, abstain until more typing. Retrieved knowledge must not choose that missing intent. Evaluate ambiguous short fragments alongside task-grounded partial words in several languages. Avoid English dictionaries, minimum suffix lengths or a special-case ban: valid completions can be one character. A schema boolean declaring “intent clear” would still be a model assertion, not a semantic proof; the current `none`/empty-text contract can already express abstention.

The nine rendered results are therefore **visible coverage**, not nine independently validated useful results. In particular, the weak partial completion must not be counted as a quality-preserving success. No result met the 500 ms target anyway.

Two [real-browser journeys](/Users/mattlo/Desktop/oxhack-2026/docs/evidence/browser-accept-decline-local-embeddings.json) passed in a fresh isolated Chromium context: Tab appended exactly the visible suffix once and logged acceptance successfully; selecting a question option showed its diff, then Decline removed the card and left the draft unchanged. No handoff was invoked. These automated interaction checks verify behavior and attribution, not human preference or suggestion-quality acceptance rates.
