# Removing the serial tag call: measured alternatives

> Historical experiment: the direct document-vector index has been removed from the runtime. Current routing is complete catalog (up to 16 entries), lexical shortlist, then tags/pgvector.

Measured 2026-10-25. The experimental code is `backend/scripts/probe_semantic_routes.py`; application code was not changed in this experiment. All Gemini calls used public repository sample documents and synthetic prompts. The attempted live-corpus export was rejected before execution by automatic approval review; the replacement experiment never read Tiger. GitHub repository metadata confirmed `Mattlo0546/Agentcomplete` is public.

## What was measured

Twenty newly authored tasks cover paraphrases, excluded technologies, two simultaneous intents, Spanish, a partial word, and two unrelated/complete controls. Eighteen tasks have twenty expected document targets. Expected targets are not exhaustive relevance labels. No retrieval threshold or synonym list was fitted to these cases.

The fixture corpus contains the repository's 29 seed documents, with their original bodies, titles, and deterministic opening-paragraph summaries. It omits the live database's generated tags and summaries. Its digest is `3bf0e69cc617029d4b523d5b27c4cef5e66dbd116c3addcd28a902659cf91d79`. The separately collected, read-only live baseline therefore must not be treated as the same input representation.

A later read-only equivalence check found 34 live documents: 29 known sample titles and 5 unknown titles. Only 27 known-title bodies matched the sample body hashes, including after stripping outer whitespace. This explicitly disproves an assumption that the current live corpus is entirely unchanged public seed material. `docs/evidence/live-seed-equivalence.json` stores counts only. No live content from this check was sent to Gemini.

| Route | Target nomination | Measured latency | Important limitation |
| --- | --- | --- | --- |
| Current lexical ranker over public seed representation | 16/20 targets in top three | Local only | Misses include migration wording, ownership, keyboard overlay, Spanish race |
| Current lexical ranker over live generated metadata | 17/20 targets in top three | Local only | Different representation; three misses, including generic transient-failure wording |
| Gemini paired document/query embeddings, local exact cosine | 20/20 targets in top three | Six individual query embeddings: median 282.7 ms, 247.2–437.5 ms; local rank 0.19–2.43 ms | Generation, debounce, and transport are additional |
| One Gemini call reviewing all 29 summaries and generating a suffix | 4/4 expected target occurrences across three tasks | 769.1, 809.7, 987.7 ms | One migration suffix is less technically precise than the source |
| One Gemini call reviewing all 29 summaries plus 500-character excerpts | 4/4 expected target occurrences across three tasks | 810.7, 824.8, 864.7 ms | Excerpts omit substantial source content; only three tasks tested |

Evidence:

- `docs/evidence/semantic-route-dry-run.json`: read-only live baseline, no model calls.
- `docs/evidence/semantic-route-fixture-probe.json`: public fixture retrieval comparisons and individual embedding latency.
- `docs/evidence/semantic-catalog-fixture-probe.json`: six full-catalog generation calls, including outputs and all abstentions.

The 29-document embedding batch took 1,199.2 ms. The twenty-query batch took 557.0 ms. Neither number is used as per-request latency: the six single-query measurements are the relevant online observations. A synthetic document inserted only into the in-memory corpus ranked first for its new task; removing a target from that in-memory corpus prevented its return. These checks do not exercise database invalidation or multi-worker freshness.

Dense retrieval still nominated three documents for each negative control. It also nominated excluded Stripe guidance in the payment-negation task. This is a shortlist, not a relevance verdict. Fresh review is necessary. No abstention was counted as a retrieved target.

## What the results support

**Direct document embeddings can remove the tag generation dependency.** Embed the current prompt once, compare it to precomputed document vectors in the process-local Tiger snapshot, and pass three candidates to the existing fresh review/generation call. This experiment recovered all expected targets, including lexical misses. It does not prove unchanged generated-output quality or performance at larger corpus sizes.

Existing vectors are short tags embedded with `SEMANTIC_SIMILARITY`, not document-retrieval vectors. They are not a validated substitute for this index. Google specifies `RETRIEVAL_QUERY` paired with `RETRIEVAL_DOCUMENT`; the prototype uses those task types and explicitly normalizes its 768-dimensional vectors. The current tag threshold of 0.88 cannot be transferred to these scores. [Gemini embedding documentation](https://ai.google.dev/gemini-api/docs/embeddings).

The online embedding request still costs roughly 283 ms at the median here. Adding it before an approximately 800 ms generator does not yield 500 ms total. It is a useful improvement over serial tagging plus embedding, not evidence for the half-second goal.

**The small-corpus one-call route is plausible but not quality-equivalent yet.** The prototype returns sparse kept-candidate indices and scores before the suffix, avoiding 29 explicit rejection entries. All six responses retained their expected targets, rejected the explicitly excluded topic, returned valid indices, and produced nonempty suffixes. Across both layouts, the median request was 817.8 ms. Add the current 150 ms debounce and other overhead before comparing with keystroke-to-visible latency.

Summaries used approximately 1,774–1,782 input tokens; 500-character excerpts used 4,428–4,436. The summary-only migration output said “avoiding locks during table alteration.” The source describes bounded and weak locks, so that wording is too absolute to claim equal grounding. The excerpt variant gave safer expand/migrate/contract wording but did not demonstrate the detailed NOT NULL sequence. Candidate recall alone would miss this distinction. Full bodies or better ingest-time evidence views require a new quality/latency comparison.

The sparse verdict protocol is experimental. Production currently explicitly accounts for each candidate's keep decision and score. Changing that protocol needs index validation, duplicate detection, and preservation of the distinction between candidate usefulness and whether the suffix quotes it. No such application change is included here.

## Best route toward 500 ms

The strongest next experiment is a local Google embedding model followed by the existing single fresh Gemini review/generation request. It removes both remote tagging and remote embedding while retaining Google, Tiger, and Snowflake. Google released EmbeddingGemma 2 on October 6, 2026; its text backbone has 270M parameters, supports an 8,192-token context, and is available under Apache 2.0. Actual latency and recall must be measured on the serving machine and chosen runtime. Published mobile or GPU timings are not measurements of this backend. [Official model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

This still cannot make a generator whose first token already takes over 500 ms produce a completed, validated suggestion within 500 ms. Local retrieval removes avoidable dependencies; provider generation latency remains. Browser prefetch and earlier request scheduling are separate possibilities, with strict revision validation and honest keystroke-to-visible measurement.

Any implementation needs these boundaries:

1. Store authoritative knowledge and versioned vector metadata in Tiger. Include model revision, dimensions, task type, preprocessing version, and content hash; never compare different embedding spaces.
2. Generate document vectors during ingestion or a background indexing job. Publish immutable snapshots only with matching content/vector versions. Newly edited content must not silently inherit an old vector. Deletion and completed ingestion must invalidate process-local snapshots.
3. Compute the current draft's query vector every eligible request, or reuse only an exact-input vector cache with the same model configuration. A changed technology, negation, or middle section must participate.
4. Preserve one fresh candidate review against the entire draft, including negative controls, excluded technologies, and multiple intents. Do not use a cosine threshold learned from these twenty cases as an output-quality gate.
5. Run local inference outside the async event loop with bounded concurrency. Cancellation should discard stale request results; cancelled threads may continue computing, so latest-request coalescing is also needed.
6. Treat model warmup, missing vectors, oversized corpora, long prompts, and failed refreshes as explicit routes. Count their latency and quality in the result distribution rather than excluding them.

The existing request permits 20,000 UTF-16 units, while `gemini-embedding-001` supports only 2,048 input tokens. Direct embedding needs explicit token-limit handling, chunking, or another verified route; silent truncation can hide changed-middle requirements and negations. These fixtures are short and do not validate that case. [Official embedding model limits](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001).

## Research that transfers, and what does not

**Move vocabulary expansion to ingestion.** Doc2Query predicts potential queries from documents before indexing; this shifts work off the query path. Doc2Query++ further addresses topic coverage and warns that uncontrolled generated expansions can be redundant, hallucinated, or harmful to dense retrieval. An applicable experiment is bounded, source-checked query variants in a separate versioned index, evaluated against new held-out tasks. Avoid a hand-authored synonym map fitted to current tests. [Doc2Query, 2019](https://arxiv.org/abs/1904.08375), [Doc2Query++, 2025](https://arxiv.org/html/2510.09557v2).

**Precompute compact evidence instead of adding an online summarizer.** REVA, accepted at ICDM 2026, mines historical generator attention into reusable document views and reports reduced compression overhead. Its attention-based mining depends on access to generator internals; the current Gemini API wrapper does not provide those traces. The transferable design is versioned ingest-time evidence views, not a claim that REVA's published performance is available through this API. [REVA, September 2026](https://arxiv.org/html/2609.11209v1).

**Test context position when considering an all-catalog prompt.** Lost in the Middle demonstrates that having relevant text in a long context does not guarantee its use, particularly when evidence moves between beginning, middle, and end. Its measured models are older and it does not establish this Gemini model's error rate. It supplies an evaluation protocol: shuffle candidate order, increase distractors, and test multi-document evidence before broadening the one-call catalog route. [Lost in the Middle](https://arxiv.org/abs/2307.03172).

The prototype passed Ruff formatting and lint checks. There were no application edits, dependency changes, database writes, commits, or pushes from this subtask.
