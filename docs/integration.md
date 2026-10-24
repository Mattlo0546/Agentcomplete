# Integration research (2026-10-24)

Findings gathered by a research agent; items marked *uncertain* need verification during implementation.

## Codex
- Extension points: plugins (bundle skills, MCP servers, hooks), AGENTS.md. Docs: https://learn.chatgpt.com/docs/plugins
- Plugins install via `/plugins` in Codex CLI or the app's Plugins tab; not available in the Codex IDE extension.
- Manifest *(uncertain)*: `.codex-plugin/plugin.json` (kebab-case `name` required); `skills/`, `hooks/`, `.mcp.json` at plugin root; marketplace `.agents/plugins/marketplace.json`. Verify against `plugin-creator` in github.com/openai/skills.
- Custom UI: MCP Apps / Apps SDK widgets render in ChatGPT iframes; Codex is documented as a no-UI client. No documented side-panel/webview or composer override API.
- Consequence: companion panel + MCP hand-off (brief §3, decision D3). A `UserPromptSubmit` hook could enrich prompts at submit time *(event availability uncertain)*.

## CopilotKit test patterns
- Vitest for unit/component tests in `__tests__/` beside source; `*.e2e.test.tsx` = jsdom component journeys against a mocked agent; Playwright for real-browser tests.
- `@copilotkit/react-textarea` (`CopilotTextarea`) is v1/legacy (Slate-based). Reuse its pattern (debounced cancellable fetch, swappable suggestion function, Tab-to-accept), not the dependency. SDK not needed for approved features.

## Gemini (google-genai)
- Tagging: `gemini-3.5-flash-lite`; judging: `gemini-3.6-flash`; generation: `gemini-3.8-flash`; embeddings: `gemini-embedding-001` with `output_dimensionality=768`.
- Structured output via `response_schema` (Pydantic); the API ignores length/uniqueness constraints — validate server-side.

## Tiger Data
- Tiger Cloud = Postgres + TimescaleDB + pgvector (pgvectorscale on standard services; free tier *uncertain*). Connect with asyncpg/psycopg 3 over SSL; `pgvector` Python package.
