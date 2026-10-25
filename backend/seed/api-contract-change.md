---
kind: prompt
title: Change an API from an explicit request and response contract
---
Use when a feature changes a client/server boundary.

**Goal:** Add `<operation>` while preserving `<existing clients and compatibility requirements>`.

**Context:** Inspect the current OpenAPI/schema version, handlers and actual callers. Identify request fields, required versus optional values, authentication, success responses and known error responses.

**Work:** Write concrete valid and invalid request/response examples before implementation. Define omitted, null, empty and unknown-value behavior where relevant. Update the authoritative schema and both sides of the boundary. Generate client types only if the repository already uses that workflow.

**Guardrails:** Do not silently rename fields, change units or reinterpret status codes. Treat schema-valid data as still subject to business validation. Use the specification version supported by the installed tools; do not upgrade it incidentally.

**Verification:** Exercise success, malformed input, permission denial and a representative downstream failure. Check response bodies against the contract and test the old-client case. Document any deliberate compatibility change and migration requirement.

Sources: [OpenAPI 3.1.2 specification](https://spec.openapis.org/oas/v3.1.2.html). Select the project's actual OpenAPI version when applying the template.
