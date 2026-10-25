---
kind: prompt
title: Choose a tech stack from explicit product constraints
---
Use when choosing technology is the requested task; do not apply it to replace an existing stack incidentally.

**Goal:** Recommend a stack for `<product and primary user journey>` under `<deadline, budget and team experience>`.

**Context:** Establish required deployment environments, data shape, expected traffic, latency, consistency, offline needs and `<mandatory sponsor tools or integrations>`. Label unknowns instead of inventing scale requirements.

**Work:** Compare at most three viable options, including extending the current stack when one exists. Explain the decisive trade-offs in implementation effort, operations, performance, reliability and portability. Identify one small experiment that could invalidate the recommendation.

**Guardrails:** Separate required capabilities from preferences. Avoid adding services merely for hypothetical future scale. Cite current official compatibility information; do not switch providers or install the proposed stack unless implementation is authorized.

**Verification:** Deliver a comparison table, recommendation, rejected alternatives and a measurable prototype check. State what evidence would change the decision.

Sources: [AWS architecture trade-off guidance](https://docs.aws.amazon.com/wellarchitected/latest/framework/perf_architecture_evaluate_trade_offs.html). The comparison method does not require AWS.
