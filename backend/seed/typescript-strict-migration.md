---
kind: skill
title: Migrating a codebase to TypeScript strict mode
---
# Migrating a codebase to TypeScript strict mode

Use when enabling `"strict": true` in an existing TypeScript or JavaScript project.

## Plan
1. Baseline: run `tsc --noEmit` and record the error count. Commit CI that fails if the count increases.
2. Enable flags one at a time in this order, fixing each before the next: `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `useUnknownInCatchVariables`, then `strict: true`. Optionally add `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` afterwards.
3. For big repos, migrate per directory using `tsconfig.strict.json` that `extends` the base and lists `include` paths; grow the list until it covers everything.

## Fix patterns
- Prefer real types over `any`. Use `unknown` at boundaries (JSON, catch, `postMessage`) and narrow with type guards or a schema parser (zod) instead of casting.
- Null handling: narrow with `if`, optional chaining, or `??`; avoid the non-null assertion `!` except where an invariant is proven and commented.
- Type third-party code with `@types/*` or a local `declare module`.
- Replace implicit `this` and untyped callbacks with explicit parameter types; use discriminated unions for variants.
- Use `satisfies` to check object literals without widening.

## Guardrails
Ban `@ts-ignore` (allow `@ts-expect-error` with a reason) via ESLint `@typescript-eslint/ban-ts-comment`. Don't change runtime behaviour in type-only PRs; keep PRs small and per module.
