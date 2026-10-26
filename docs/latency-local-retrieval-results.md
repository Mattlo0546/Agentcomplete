# Latency results and local semantic retrieval

> Historical experiment: the direct document-vector index has been removed from the runtime. Current routing is complete catalog (up to 16 entries), lexical shortlist, then tags/pgvector.

The 500 ms target is not met. The current Gemini endpoint took a median 599 ms to produce its first output token in ten provider probes, before completing or validating a suggestion. Local retrieval removes an avoidable dependency, but cannot erase that generation time. These measurements were collected on 25 October 2026 on the development machine; they are not a production latency guarantee.

## Changes available for testing

At the time of this evaluation, the default reviewed the complete knowledge catalog, including full source bodies, within 64 items and 80,000 serialized characters. The current item limit is 16; the historical results below retain their original settings. This addresses the reported shallow suggestions: keyword and vector shortlists missed broadly applicable workflow guidance in the current 34-document catalog. Gemini now receives that guidance directly and can add substantive source-grounded steps to complete briefs while preserving explicit constraints such as Python. This correctness change has deterministic test coverage, but its live suggestion quality and latency have not yet been validated.

For catalogs outside those bounds, the route keeps the existing lexical shortlist and uses local Google EmbeddingGemma 2 when that shortlist cannot nominate candidates. The fallback then makes one fresh Gemini call to review every candidate and generate the suggestion. The former tag generation, remote query embedding and vector query remain available when the local index cannot safely answer.

Google remains the model provider: Gemini generates suggestions and handles ingestion and legacy embeddings; EmbeddingGemma 2 supplies local semantic vectors. Tiger Data remains the authoritative knowledge and trace store. Snowflake remains the offline analytics path.

The index includes complete bounded document bodies, overlapping source excerpts and exact model/content identities. Document vectors are prepared outside requests; queries run off the event loop with a bounded queue. Expired or changed sources cannot produce accepted advice. Missing model files, oversized corpora and long queries use the existing fallback. The local runtime never downloads model files or sends document text to an external embedding API implicitly.

The frontend can retain one in-flight completion while the user continues typing. It displays a remainder only if those new characters exactly match the validated suffix. Interior edits, selection changes, deletion, paste, composition, settings changes and mismatches invalidate that reuse. Questions keep their current-draft requirement. The question card also appears without its former opacity delay. Restored drafts request a fresh suggestion, and empty responses now expose their knowledge trace for diagnosis.

## Retrieval latency and quality tradeoff

These measurements predate the complete-catalog default and describe the optional shortlist routes. The public fixture corpus contains 29 documents. Forty-nine distinct queries include paraphrases, multilingual prompts, two negative controls and explicit document references. Recall counts expected document occurrences, not useful suggestions. Negative controls are excluded from its denominator and still need fresh Gemini review.

| Configuration | Expected targets found | Query median | Query p95 | Cold index build |
| --- | ---: | ---: | ---: | ---: |
| Lexical then local semantic | 47 / 49 | 0.13 ms | 95.76 ms | 21.86 s |
| Optional semantic first | 49 / 49 | 130.78 ms | 293.96 ms | 33.41 s |

The lexical-first run used 45 lexical selections and four semantic queries. Its original paraphrase subset found 18 of 20 expected targets; the two misses arise from lexical matches that suppress semantic retrieval. Semantic-first found all 20. Both configurations retained source/excerpt integrity in all 49 checks. These small, sequential runs do not establish equivalent output quality or population percentiles. Source data was refreshed after the cold build before publishing the completed index.

Semantic-first is available with `CATALOG_REVIEW_ENABLED=false` and `SEMANTIC_FIRST_ENABLED=true`, but is not the default: its browser experiment regressed median visible latency from 987 to 1,288 ms. Its first retrieval took 2,080 ms; the aggregate trace could not distinguish snapshot refresh from local encoder cost. Added stage timings now separate those paths. No unproven warmup workaround was introduced.

Reproduce the two retrieval runs with [the fixture probe](https://github.com/Mattlo0546/skill-issue/blob/9388e43/backend/scripts/probe_production_semantics.py). Evidence: [lexical-first routing](evidence/semantic-production-local-fallback.json), [semantic first](evidence/semantic-production-local-final.json), and [browser comparison](evidence/latency-browser-challenge-comparison.json).

## Run it locally

After pulling main, restart the backend to load the new code. Complete-catalog review does not require the local embedding model and skips its index build while the catalog fits the bounds. To test the optional local semantic fallback, install its runtime and pinned model once:

```sh
cd backend
uv sync --extra local-retrieval
uv run --extra local-retrieval python scripts/setup_local_embeddings.py
uv run --extra local-retrieval uvicorn app.main:app --port 8000
```

The model files total about 330 MiB and are ignored by Git. The setup script verifies pinned hashes before installation. When the complete catalog does not fit or its review is disabled, expect a cold index build at startup; subsequent unchanged snapshot refreshes reuse vectors. Start the frontend with its existing command. Keep the same Gemini, Tiger and Snowflake configuration.

`DIRECT_SEMANTIC_ENABLED=false` disables the new index. Set `CATALOG_REVIEW_ENABLED=false` and `FAST_AUTOCOMPLETE_ENABLED=false` as well to compare with the original serial semantic route. `SEMANTIC_EMBED_BACKEND=gemini` is an explicit alternative that sends document and query text to Google's embedding API; the default is local.

## What reaching 500 ms still requires

The [26 provider attempts](research/gemini-half-second-probes.md) compared model versions, streaming, requested Priority service and thinking controls. The current model was the best supported control. Requested Priority responses reported Standard service; the experiment did not obtain or measure actual Priority capacity. Streaming's first JSON token was neither a complete nor an acceptable suggestion.

Google Smart Compose and Cursor achieve low latency with specialized models and serving infrastructure. Their published results do not transfer directly to a general Gemini API call. The next useful experiments are exact-current-draft semantic preparation during the existing typing debounce, measured earlier generation/reuse, and a faster Google serving path or specialized Google model evaluated at equal useful coverage. A local generator needs an independent grounding and quality comparison before it can replace Gemini. See the [architecture research](research/autocomplete-architecture-audit.md), [interaction experiments](research/half-second-interaction-design.md) and [retrieval research](research/semantic-route-options.md).

Empty responses, rejected output, stale results and reused suffixes must remain separate from fresh useful-result latency. None demonstrates that a novel, grounded clarification question is available in 500 ms.
