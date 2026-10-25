# Integration research (updated 2026-10-25)

> Historical research, including model choices that changed during implementation. For installed versions, active defaults, and current routing, use [the README](../README.md) and [architecture guide](architecture.md).

Findings gathered by a research agent; items marked *uncertain* need verification during implementation.

## Codex
- Extension points: plugins (bundle skills, MCP servers, hooks), AGENTS.md. Docs: https://learn.chatgpt.com/docs/plugins
- Plugins install via `/plugins` in Codex CLI or the app's Plugins tab; not available in the Codex IDE extension.
- Manifest *(uncertain)*: `.codex-plugin/plugin.json` (kebab-case `name` required); `skills/`, `hooks/`, `.mcp.json` at plugin root; marketplace `.agents/plugins/marketplace.json`. Verify against `plugin-creator` in github.com/openai/skills.
- Custom UI: the current [OpenAI extension reference](https://developers.openai.com/plugins/build/extensions) supports conversation panels and searchable composer mentions in the desktop host. This does not establish support for observing an unsent draft or rendering a custom inline completion. The installed MCP package implements tools and a skill, without an MCP App UI.
- The [formal extension protocol](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md) documents mentions and appending content to editable drafts; it does not document a live composer-change hook, custom ghost-text provider or native history-button slot.
- Scope correction: the owner explicitly requires automatic suggestions in the existing Codex textbox. The companion-only D3 assumption in the original brief does not satisfy that request. The separate [macOS InputMethodKit workaround](native-composer.md) uses normal text composition rather than a Codex plugin hook. It is experimental until the actual Codex editor is verified.

## CopilotKit test patterns
- Vitest for unit/component tests in `__tests__/` beside source; `*.e2e.test.tsx` = jsdom component journeys against a mocked agent; Playwright for real-browser tests.
- `@copilotkit/react-textarea` (`CopilotTextarea`) is v1/legacy (Slate-based). Reuse its pattern (debounced cancellable fetch, swappable suggestion function, Tab-to-accept), not the dependency. SDK not needed for approved features.

## Gemini (google-genai)
- Tagging: `gemini-3.5-flash-lite`; judging: `gemini-3.6-flash`; generation: `gemini-3.8-flash`; embeddings: `gemini-embedding-001` with `output_dimensionality=768`.
- Structured output via `response_schema` (Pydantic); the API ignores length/uniqueness constraints — validate server-side.

## Tiger Data
- Tiger Cloud = Postgres + TimescaleDB + pgvector (pgvectorscale on standard services; free tier *uncertain*). Connect with asyncpg/psycopg 3 over SSL; `pgvector` Python package.
