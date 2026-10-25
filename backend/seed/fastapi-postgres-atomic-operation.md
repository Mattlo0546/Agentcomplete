---
kind: prompt
title: Implement one atomic FastAPI and PostgreSQL operation
---
Use when the project already uses FastAPI and PostgreSQL; retain its selected database driver or ORM.

**Goal:** Implement `<endpoint and business operation>` so related writes either all succeed or all roll back.

**Context:** Inspect request models, authorization, connection lifecycle, transaction boundaries and existing error responses. Establish `<business invariant and duplicate-request behavior>` before coding.

**Work:** Validate inputs and permissions, then perform the related writes in an explicit transaction appropriate to the installed driver. Release connections reliably. Keep unrelated network calls outside the transaction where correctness permits. Use async database operations in async routes; isolate blocking libraries using the framework's established pattern.

**Guardrails:** Preserve current API shapes and driver choice. Parameterize SQL values. Do not silently retry non-idempotent mutations or acknowledge success before the required commit.

**Verification:** Test success, a failure between writes, uniqueness/conflict behavior and concurrent attempts using disposable test data. Assert the resulting database state and response contract, not just HTTP success.

Sources: [Psycopg transaction behavior](https://www.psycopg.org/psycopg3/docs/basic/transactions.html), [FastAPI concurrency guidance](https://fastapi.tiangolo.com/async/).
