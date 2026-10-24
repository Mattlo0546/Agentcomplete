---
kind: graph
title: Release notes from commits
---
# Release notes from commits

A pipeline that turns the commits between two tags into release notes, mixing deterministic collection with agent writing.

## Nodes
1. **resolve_range** (deterministic): previous tag = latest semver tag before `HEAD`; range `prev..HEAD`.
2. **collect** (deterministic): `git log --no-merges --pretty='%H%x09%s%x09%an'` plus merged PR numbers and labels from the GitHub API.
3. **classify** (deterministic then agent): parse Conventional Commit prefixes (`feat`, `fix`, `perf`, `refactor`, `docs`, `chore`) and breaking markers (`!`, `BREAKING CHANGE:`). For commits without a prefix, an agent prompt returns a category from a fixed list and a confidence; below 0.6 goes to "Other".
4. **group** (deterministic): sections Breaking changes, Features, Fixes, Performance, Other; drop `chore`, `ci` and dependency bumps unless they affect users.
5. **write** (agent): prompt: "Rewrite each entry as one user-facing sentence in past tense. Keep PR numbers and author handles. Do not add features or claims that are not in the commit or PR text. Put migration steps under Breaking changes."
6. **verify** (deterministic): every commit is either represented or intentionally dropped; PR links resolve; the version heading matches the tag.
7. **publish** (deterministic): write `CHANGELOG.md` section and create a draft GitHub release for human review.

## Notes
Never publish automatically. Keep the agent's input limited to commit subjects, bodies and PR titles so it cannot invent behaviour.
