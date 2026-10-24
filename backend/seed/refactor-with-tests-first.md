---
kind: prompt
title: Refactor with tests first
---
Refactor `<target: file, class or function>` to `<goal: e.g. split responsibilities, remove duplication, make it testable>` without changing behaviour.

Work in this order and stop to report if any step fails:
1. Read the target and its callers. List the observable behaviours (inputs, outputs, side effects, error cases) in a short bullet list.
2. Check existing tests. For any behaviour not covered, write characterization tests that pin the current behaviour, including edge cases and errors. Run them and confirm they pass against the unchanged code.
3. Refactor in small steps. After each step run the test suite; do not mix refactoring with behaviour changes or formatting churn.
4. Keep public function signatures, exported names and data formats unchanged unless I said otherwise. If something must change, list it explicitly.
5. Do not touch files outside `<scope>`. Do not add dependencies.

Acceptance criteria:
- All previous and new tests pass; the linter and type checker are clean.
- The diff is reviewable: no unrelated renames, no dead code left behind.

Output: a short summary of what changed and why, the commands you ran with results, and any risks or follow-ups you noticed but did not act on.
