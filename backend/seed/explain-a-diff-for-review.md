---
kind: prompt
title: Explain a diff for code review
---
Review the diff between `<base>` and `<head>` (run `git diff <base>...<head>`) and write review notes for a teammate who has not seen the change.

Structure the answer as:
1. **Intent** - one or two sentences on what the change is for, inferred from commit messages, tests and code. Say so if the intent is unclear.
2. **Walkthrough** - group changes by concern, not by file order. For each group give the files, what changed, and why it is shaped this way.
3. **Risk areas** - behaviour changes, public API or schema changes, migrations, concurrency, error handling, security-sensitive code, performance on hot paths.
4. **Tests** - what is covered, what is not, and specific missing cases.
5. **Questions and suggestions** - concrete, ordered by importance, each tagged `blocking`, `should-fix` or `nit`, with file and line.

Rules: base every claim on the diff and surrounding code; quote line numbers; do not invent behaviour you did not verify; do not rewrite the code, only suggest. Keep it under 500 words unless the diff is large.
