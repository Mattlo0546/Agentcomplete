---
kind: prompt
title: Build one working feature through the existing stack
---
Use for a new feature in an existing repository.

**Goal:** Implement `<user action and observable result>` as one working path through the existing app.

**Context:** Read repository instructions, dependency versions, run commands and the nearest comparable feature. Trace the entry point, validation, business logic, persistence and UI involved. Use discovered paths; do not invent files or services.

**Work:** State the smallest useful scope and acceptance examples, then implement it. Include loading, empty, success and failure behavior where relevant. Connect the real application layers; distinguish test doubles from functioning integrations.

**Guardrails:** Preserve `<existing contracts and required tools>`. Reuse established patterns. Avoid unrelated redesigns or additional infrastructure. Resolve routine details from the code; surface only missing decisions that materially change behavior.

**Verification:** Run the repository's relevant checks and exercise the complete user journey. Report the behavior delivered, commands and results, and any integration still blocked.

Sources: [GitHub coding-agent task guidance](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results). The workflow above is an original, provider-neutral template.
