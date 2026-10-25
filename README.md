# Prompt Enhance

Ghost-text autocomplete and multiple-choice clarifying questions for Codex and Claude prompts. Suggestions are grounded in a knowledge base of SKILL files, example prompts and agent graphs. Save named prompt versions, compare their changes and restore one in the companion editor.

| Part | Stack | Folder |
|---|---|---|
| Companion panel | Next.js 16, React 19, shadcn/ui, Tailwind v4, TanStack Query/Virtual | `frontend/` |
| API + pipeline | FastAPI, Pydantic, Gemini (`google-genai`) | `backend/` |
| Database | Tiger Data (PostgreSQL + pgvector + TimescaleDB) | `backend/app/db/migrations/` |
| Outcome classifier | Snowflake ML classification on derived features | `backend/app/analytics/` |
| Codex and Claude Code plugins | Shared MCP server + skill, host-specific manifests | `plugin/` |

Docs: [architecture & performance](docs/architecture.md) · [brief](docs/brief.md) · [API contract](docs/api.md) · [design system](design.md) · [mockups](docs/mockups/contact-sheet.html) · [Codex plugin](docs/codex-plugin.md) · [Claude plugin](docs/claude-plugin.md)

## Plugins and prompt history

Install the Codex plugin from the included local marketplace or the Claude Code plugin from this GitHub repository; see the host-specific guides above. Both connect to the same running local backend. They expose prompt enhancement, clarifying questions, knowledge search, handoff retrieval and saved-version retrieval. The companion panel provides the editor, ghost text and History UI; the plugins do not replace either host's native text box.

Right-click (including a two-finger trackpad click) an unaccepted autocomplete to save it as a named version with a description. The Save version action also works from the keyboard. Open the History icon to compare saved versions or restore a version to the editor. Saving a suggestion preserves the current draft without accepting the ghost text.

Sending a prompt publishes one shared latest handoff for Codex and Claude. In the destination agent, explicitly ask to use or view that handoff. Switching the destination does not create a separate queue or run a task automatically.

## Setup

Credentials live in the git-ignored `.env` (see `.env.example`). Set secrets without echoing them:

```bash
python3 scripts/set-secret.py GEMINI_API_KEY
```

Snowflake uses the named connection `prompt-enhance` in `~/.snowflake/config.toml` (`scripts/snowflake-login.py`).

## Run

```bash
cd backend && uv run uvicorn app.main:app --port 8000
```

```bash
cd frontend && pnpm dev
```

Open http://localhost:3000. Migrations run on backend start-up. To seed the knowledge base:

```bash
cd backend && uv run python -m app.knowledge.seed
```

## Test

```bash
cd backend && uv run pytest -q
```

```bash
cd frontend && pnpm test
```

```bash
cd frontend && pnpm test:e2e
```

Backend tests and Playwright e2e hit the real Tiger Data, Gemini and Snowflake services.

History API tests can run without service credentials with `cd backend && uv run python -m pytest --confcutdir=tests/offline tests/offline -q`.
Browser history tests intercept the API and cover desktop and mobile without live AI calls: `cd frontend && pnpm test:e2e:offline`.
Run plugin tests with `cd plugin/prompt-enhance/mcp && uv run --frozen pytest -q -m 'not live'`.

## Logging policy

Metadata only (request id, timestamps, operation/model, status, latency, tokens, sanitized errors); no prompts, knowledge bodies or model responses. Logs and traces are kept for 30 days through TimescaleDB retention policies.

Saved prompt versions are an explicit content store: names, descriptions, drafts and saved suggestions persist in PostgreSQL until deleted through History. They are separate from telemetry and do not inherit its 30-day retention. This app has no account authentication; run the backend on loopback for a single user. Add authentication and ownership checks before exposing it to other users or a public network.
