---
kind: prompt
title: Implement authorization from a resource and action matrix
---
Use when adding or repairing access control in an application with an identified authentication mechanism.

**Goal:** Enforce `<who may perform which actions on which resources>` using the existing identity provider.

**Context:** Build a small matrix of actor, action, resource ownership and tenant scope. Mark unspecified permissions as unresolved; do not infer privileges from a role name alone.

**Work:** Apply the policy at server-side resource access points, including reads, mutations and collection queries. Deny access when no rule grants it. Scope object lookup to the authenticated subject and tenant where applicable. Treat identifiers supplied by the client as untrusted references, not proof of ownership.

**Guardrails:** UI visibility is supplementary, not enforcement. Preserve the project's session/token mechanism. Keep denial responses and logs free of secrets and unnecessary resource details.

**Verification:** Test allowed access and denied cases for anonymous users, another user's record, another tenant, missing policy inputs and a changed permission. Verify that denial produces no mutation or data disclosure.

Sources: [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
