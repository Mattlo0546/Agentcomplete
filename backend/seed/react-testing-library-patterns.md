---
kind: skill
title: React Testing Library and Vitest patterns
---
# React Testing Library and Vitest patterns

Use when writing component or user-journey tests for React.

## Principles
- Test behaviour the user sees, not implementation: no testing of state variables, hooks internals or class names.
- Query by accessibility: `getByRole('button', { name: /save/i })`, `getByLabelText`, `getByText`. Use `data-testid` only as a last resort. Use `findBy*` for async appearance and `queryBy*` to assert absence.
- Use `userEvent` (`const user = userEvent.setup()`; `await user.click(...)`, `await user.type(...)`) rather than `fireEvent`.
- Prefer `await screen.findBy...` or `waitFor` over arbitrary sleeps; never assert inside `waitFor` on something with side effects.

## Setup
- Render with a helper that wraps providers (QueryClientProvider with `retry: false`, theme, router mocks) so tests stay short.
- Mock at the network boundary (stub `fetch` or use MSW), not your own modules. Reset mocks in `afterEach`.
- Fake timers: `vi.useFakeTimers()` with `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.

## What to cover
Loading, empty, error and success states; keyboard operation; form validation messages; disabled states; and accessible names. One user journey per test with clear arrange/act/assert.

## Anti-patterns
Snapshot tests of large trees, asserting on `container.firstChild`, wrapping everything in `act` manually, testing library internals, and shared mutable state between tests.

## Commands
`pnpm exec vitest run path/to/file.test.tsx`, add `--coverage` when checking gaps, and `eslint-plugin-testing-library` to catch common mistakes.
