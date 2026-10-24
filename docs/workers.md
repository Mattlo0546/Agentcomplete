# Rules for implementation workers

You are one of several workers implementing Prompt Enhance in parallel. The orchestrator owns integration, shared files and final evidence.

## Shared checkout
- Everyone works in `/Users/mattlo/Desktop/oxhack-2026` at the same time. Edit **only the files you own** (listed in your task). Other workers are editing their own files right now; if typecheck/lint/tests show errors in files you don't own, ignore them and carry on — never "fix" or revert them.
- If you need a change in a file you don't own (shared types, shell, config, `app/main.py`, `app/llm/gemini.py`, `app/db/*`, `app/errors.py`, `src/lib/api/*`, `src/components/{ui,shell,common}/*`, `globals.css`, `package.json`, `pyproject.toml`), do **not** edit it: describe the exact change in your final report and work around it locally.
- Do not run `git commit`, `git stash`, `git checkout`, `git reset` or anything that changes git state. The orchestrator commits.
- Do not add dependencies. Everything listed in the brief is already installed. If something is truly missing, say so in your report.
- Never print or log secrets. `.env` (repo root) holds `GEMINI_API_KEY`, `DATABASE_URL`, `SNOWFLAKE_CONNECTION_NAME`; the backend reads it via `app.config.get_settings()`.

## Sources of truth (read before coding)
- `docs/brief.md` — approved product brief (incl. decisions D1 no payload logging, D2 30-day retention, D3 companion panel + MCP hand-off).
- `docs/api.md` — HTTP contract. Implement it exactly; do not invent endpoints or fields.
- `design.md` — design system; **strict consistency** required for any UI. Mockups: `docs/mockups/*.png` (desktop + mobile), prototype source `docs/prototype/`.
- No decorative text in UI: no page subtitles, card blurbs, helper sentences or explanatory captions. Labels, real data, accessible names and actionable errors only.

## Quality bar
- Real behaviour against the real backend/database/Gemini. No static facades, mocked success paths or decorative controls in product code. Every visible control must do something real.
- Clean code: small files, split by responsibility, reuse shared helpers. Match surrounding style (comment density, naming).
- Backend: Python 3.12+ type annotations, Pydantic models, async psycopg via `app.db.pool.connection()` (dict rows, autocommit; use `conn.transaction()` for multi-statement writes), `app.llm.gemini.generate_structured()/embed()` for all model calls (they log AI-call metadata automatically). Raise `app.errors.AppError` subclasses (`NotFoundError`, `ConflictError`, `UpstreamError`). Lint with `cd backend && uv run ruff check <your files> && uv run ruff format <your files>`. Tests with `cd backend && uv run pytest tests/<your tests> -q` (they hit the real Tiger DB and Gemini — use unique ids/titles and clean up rows you create).
- Frontend: Next.js 16 App Router (read `frontend/AGENTS.md` and `frontend/node_modules/next/dist/docs/` for anything version-specific), React 19, TypeScript strict, shadcn/ui primitives from `@/components/ui/*`, Tailwind v4 with the design tokens in `globals.css` (`bg-marker`, `text-ghost`, `bg-insert-soft`, `text-label`, `text-data`, `text-title`, `text-section`, `text-prompt`, …). Styles live **with components** (Tailwind classes in the component file). TanStack Query for server state, `@mantine/hooks` for hooks (`useDebouncedCallback`, `useMediaQuery`, `useLocalStorage`, …), `es-toolkit` for helpers, `motion/react` for animation (design.md §2.4), `@tanstack/react-virtual` for long lists, Sonner `toast` for async outcomes/errors, Lucide icons.
- Use the shell: `PageLayout` from `@/components/shell/page-layout` (title, actions, inspector), `useLayoutMode()`. Shared bits in `@/components/common/*` (`KeyCap`, `TagChip`, `StatusDot`, `KindIcon`, `Segmented`) and `@/lib/format`. API access via `apiJson/apiFetch/newRequestId` from `@/lib/api/client` and types from `@/lib/api/types`.
- Frontend tests follow CopilotKit's patterns: Vitest + Testing Library, tests in `__tests__/` folders beside the source; `*.test.tsx` for units/components and `*.e2e.test.tsx` for jsdom user journeys (mock only `fetch` at the network boundary in these jsdom tests). Real-browser Playwright e2e against the live backend is owned by the orchestrator. Run yours with `cd frontend && pnpm exec vitest run <your paths>`; also `pnpm exec eslint <your paths>` and `pnpm exec prettier --write <your paths>`. Do **not** run `next dev`, `next build` or `pnpm install` (shared `.next`/`node_modules`).
- Accessibility per design.md §5.

## Final report (keep it under 300 words)
Files created/changed, how you verified (commands + results), anything not done, and any change you need in a file you don't own.
