---
kind: skill
title: Structured logging and observability for services
---
# Structured logging and observability for services

Use when adding logging, metrics or tracing to a backend service.

## Logging
- Emit structured logs (JSON or key=value) with consistent fields: `time`, `level`, `request_id`, `route`, `status`, `latency_ms`, `error`.
- Generate or accept a request id at the edge (`X-Request-ID`), store it in a context variable, attach it to every log line and outgoing call, and return it in the response.
- Levels: `ERROR` for failures needing attention, `WARNING` for recovered anomalies, `INFO` for lifecycle events, `DEBUG` off in production. Log an exception once, where it is handled, with the stack trace.
- **Never log** secrets, tokens, passwords, full request bodies, prompts or personal data. Log sizes, ids and counts instead; sanitize exception strings.

## Metrics (RED + USE)
Rate, Errors, Duration per endpoint (histograms for latency, p50/p95/p99), plus saturation: queue depth, pool usage, CPU/memory. Keep label cardinality low (route template, not raw URL or user id).

## Tracing
Use OpenTelemetry; propagate `traceparent` across services; create spans for DB queries, outbound HTTP and model calls with attributes such as model name and token counts.

## Operations
- Health endpoints: liveness (process up) and readiness (dependencies reachable).
- Set retention for logs and traces (e.g. 30 days) and alert on symptoms (error rate, latency SLO burn) not causes.
- For third-party calls (LLMs, payments) record operation, model, status, latency and usage for cost and debugging.

## Testing
Assert that a request produces a log row with the request id and that errors are sanitized.
