---
kind: skill
title: Consistent HTTP API error handling
---
# Consistent HTTP API error handling

Use when designing or reviewing how a REST/JSON API reports failures.

## Contract
- One error envelope everywhere: `{"error": {"code": "invalid_request", "message": "Invalid fields: title"}}`. `code` is a stable machine-readable string; `message` is human-readable and safe to show.
- Use correct statuses: 400 malformed, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict, 422 validation, 429 rate limited (with `Retry-After`), 5xx server or upstream. 502/504 for failing dependencies, 503 for unavailable database.
- Return validation problems per field so clients can display them next to inputs.

## Implementation
- Raise typed domain exceptions in services (`NotFoundError`, `ConflictError`, `UpstreamError`) and translate them in one central handler, not in each route.
- Catch broad exceptions only at the boundary, convert to a generic 500 body, and log the stack trace server-side with the request id.
- Never leak stack traces, SQL, file paths, secrets, or prompt/user content in messages. Sanitize upstream error strings before logging or returning.
- Include the request id in the `X-Request-ID` header so support can correlate logs.

## Client behaviour
Retry only idempotent requests or those with idempotency keys on 429/502/503/504; surface 4xx to the user without retry; distinguish timeouts from connection errors.

## Testing
For each endpoint test the happy path, not found, validation failure, and an upstream failure, asserting status code and error `code` (not the full message).
