---
kind: prompt
title: Add React incrementally to one existing route or widget
---
Use only when React adoption has already been selected for this project.

**Goal:** Migrate `<bounded route or interactive widget>` from `<current implementation>` to React while preserving its user-visible contract.

**Context:** Inspect routing, build tooling, HTML ownership, shared styles and deployment behavior. Identify the exact boundary where old and new implementations meet. Retain the current toolchain where compatible.

**Work:** Implement the smallest independently testable integration. Keep surrounding routes working. Define which implementation owns each DOM region, navigation action and piece of state. Document how to revert that boundary without discarding user data.

**Guardrails:** Do not turn one widget migration into a full rewrite. Preserve `<URLs, authentication, analytics and accessibility requirements>`. Use the installed React/framework documentation; identify required dependency changes explicitly.

**Verification:** Compare the old and new user journey using `<representative inputs>`. Test direct navigation, refresh, error recovery and coexistence with the old page. Report the migrated boundary and remaining work.

Sources: [React incremental integration](https://react.dev/learn/add-react-to-an-existing-project).
