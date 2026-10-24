# Prompt Enhance

Ghost-text autocomplete and multiple-choice clarifying questions for Codex prompts. Suggestions are grounded in a knowledge base of SKILL files, example prompts and agent graphs.

| Part | Stack | Folder |
|---|---|---|
| Companion panel | Next.js 16, React 19, shadcn/ui, Tailwind v4, TanStack Query/Virtual | `frontend/` |
| API + pipeline | FastAPI, Pydantic, Gemini (`google-genai`) | `backend/` |
| Database | Tiger Data (PostgreSQL + pgvector + TimescaleDB) | `backend/app/db/migrations/` |
| Outcome classifier | Snowflake ML classification on derived features | `backend/app/analytics/` |
| Codex plugin | MCP server + skill | `plugin/` |

Docs: [brief](docs/brief.md) · [API contract](docs/api.md) · [design system](design.md) · [mockups](docs/mockups/contact-sheet.html) · [Codex plugin](docs/codex-plugin.md)

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

## Logging policy

Metadata only (request id, timestamps, operation/model, status, latency, tokens, sanitized errors); no prompts, knowledge bodies or model responses. Logs and traces are kept for 30 days through TimescaleDB retention policies.
