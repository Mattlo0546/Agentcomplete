---
kind: prompt
title: Writing clear Codex tasks
---
Use this template when giving a coding agent a task. Fill every section; delete none.

**Goal**: one sentence stating the outcome and why it matters. Example: "Add rate limiting to `POST /v1/login` so brute-force attempts are slowed."

**Context**: where the relevant code lives (paths, functions), how to run the project and tests, and existing patterns to follow. Link to the issue, design doc or similar code to imitate.

**Constraints**:
- Scope: which files or modules may change, and which must not.
- Compatibility: languages and versions, public APIs and data formats that must stay stable.
- No new dependencies unless named; match existing style and naming.
- Security and privacy rules (no secrets or personal data in logs).

**Acceptance criteria**: a checklist that can be verified, e.g. "the 6th request within a minute returns 429 with a `Retry-After` header", "all existing tests pass", "new tests cover the limit and the reset".

**How to verify**: exact commands to run (`pytest tests/auth -q`, `ruff check .`).

**Output format**: what to report back - summary of changes, files touched, commands run with results, open questions, and anything left undone. Ask for questions before starting if requirements are ambiguous.

Tips: one task per prompt; state non-goals explicitly; give examples of expected input and output; prefer small, reviewable tasks over broad ones.
