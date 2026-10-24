---
kind: graph
title: Bug triage loop with agent steps
---
# Bug triage loop

A graph of deterministic steps with an agent prompt inside the loop. Run it for each new bug report.

## Nodes
1. **fetch_report** (deterministic): load the issue title, body, logs, version and reporter from the tracker API.
2. **dedupe** (deterministic): search open issues by error signature (normalised stack top frame, error code). If a match scores above threshold, link as duplicate and stop.
3. **reproduce** (agent): prompt: "Given this report and the repo at the reported version, write the smallest failing test or script that reproduces the problem. Run it. Report command, output and whether it fails for the stated reason." Max 3 attempts; on each failure feed the output back.
4. **branch** (deterministic): reproduced -> step 5; not reproduced -> label `needs-info` with a templated question and stop.
5. **locate** (agent): prompt: "Using the failing test, find the root cause. Name the file, function and the faulty assumption. Cite lines. Do not edit code."
6. **fix** (agent): prompt: "Make the minimal change that fixes the root cause. Keep the reproduction as a regression test. Run the full test suite and linter." Max 2 attempts.
7. **gate** (deterministic): tests green, lint clean, diff under 200 lines, no changes to migrations or secrets. Otherwise label `needs-human` with the agent's notes.
8. **open_pr** (deterministic): push a branch, open a PR linking the issue, include repro, cause and test results.

## Loop control
Cap total agent calls at 8 per bug, log each node's status and duration, and always leave a comment on the issue summarising the outcome. A human approves merging.
