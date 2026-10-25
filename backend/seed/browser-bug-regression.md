---
kind: prompt
title: Reproduce a browser bug and keep a focused regression test
---
Use for a reported UI failure rather than a broad refactor.

**Goal:** Fix `<observed failure>`; expected behavior is `<observable outcome>`.

**Context:** Record the route, browser, viewport, account state and smallest input that triggers the problem. Inspect the existing browser test setup before adding tools.

**Work:** Create an isolated reproduction that fails for the reported reason. Use controls as a user would, favoring role/name or label locators. Investigate the failing state and relevant network activity, then change the responsible code. If reproduction fails, report what was tried and the missing evidence instead of inventing a root cause.

**Guardrails:** Keep test data and browser state independent. Avoid arbitrary sleep delays, brittle CSS selectors and retries that conceal the defect. Preserve unrelated behavior and existing test tooling.

**Verification:** Show the failure before the fix and success afterward, plus the closest neighboring flow. Keep the regression test and report the exact command and result.

Sources: [Playwright testing best practices](https://playwright.dev/docs/best-practices). Apply equivalent principles with the project's chosen test runner.
