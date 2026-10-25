---
kind: prompt
title: Improve an LLM feature using measured latency and quality
---
Use for an existing LLM application with a slow user interaction.

**Goal:** Reduce `<interaction>` latency toward `<target and percentile>` while preserving `<quality requirements and required providers>`.

**Context:** Trace debounce, application queueing, retrieval, provider calls, validation and rendering. Separate client-observed time to useful output from provider token speed and total completion time.

**Work:** Establish a representative baseline. Compare one change at a time: unnecessary serial calls, output length, repeated work, connection reuse, cancellation or caching. For each cache, define its key, expiry and invalidation. Use current telemetry conventions supported by the installed instrumentation; evolving GenAI metric names require version checks.

**Guardrails:** Persist timings, counts, model identifiers and sanitized failures, not raw prompts or responses. Keep sponsors and providers fixed unless a change is authorized. Do not count stale or invalid output as success.

**Verification:** Report sample count, cold/warm conditions, median, p95, failures, cancellations and quality results. Identify the measured bottleneck and remaining uncertainty.

Sources: [OpenTelemetry GenAI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md).
