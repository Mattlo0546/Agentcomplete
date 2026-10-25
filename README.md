# Skill Issue

Ghost-text autocomplete and multiple-choice clarifying questions for Codex and Claude prompts. Suggestions are grounded in a knowledge base of SKILL files, example prompts and agent graphs. Save named prompt versions, compare their changes and restore one in the companion editor.

| Part | Stack | Folder |
|---|---|---|
| Companion panel | Next.js 16, React 19, shadcn/ui, Tailwind v4, TanStack Query/Virtual | `frontend/` |
| API + pipeline | FastAPI, Pydantic, Gemini (`google-genai`) | `backend/` |
| Database | Tiger Data (PostgreSQL + pgvector + TimescaleDB) | `backend/app/db/migrations/` |
| Outcome classifier | Snowflake ML classification on derived features | `backend/app/analytics/` |
| Codex and Claude Code plugins | Shared MCP server + skill, host-specific manifests | `plugin/` |

Docs: [architecture & performance](docs/architecture.md) · [brief](docs/brief.md) · [API contract](docs/api.md) · [design system](design.md) · [mockups](docs/mockups/contact-sheet.html) · [Codex plugin](docs/codex-plugin.md) · [Claude plugin](docs/claude-plugin.md)

For automatic suggestions in the existing Codex textbox on macOS, see the experimental [native input-method workaround](docs/native-composer.md). It is separate from MCP plugin installation and requires selecting its macOS input source. Codex host compatibility must be verified before treating it as supported.

## Plugins and prompt history

Install the Codex plugin from the included local marketplace or the Claude Code plugin from this GitHub repository; see the host-specific guides above. Both connect to the same running local backend. They expose prompt enhancement, clarifying questions, knowledge search, handoff retrieval and saved-version retrieval. The companion panel provides the editor, ghost text and History UI; the plugins do not replace either host's native text box.

Right-click (including a two-finger trackpad click) an unaccepted autocomplete to save it as a named version with a description. The Save version action also works from the keyboard. Open the History icon to compare saved versions or restore a version to the editor. Saving a suggestion preserves the current draft without accepting the ghost text.

Sending a prompt publishes one shared latest handoff for Codex and Claude. In the destination agent, explicitly ask to use or view that handoff. Switching the destination does not create a separate queue or run a task automatically.

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/architecture-technical-dark.svg">
  <img alt="Skill Issue technical architecture: browser and Codex MCP clients call a single FastAPI worker; retrieval, Gemini review and generation, and output validation connect to Tiger PostgreSQL, pgvector, TimescaleDB, and offline Snowflake analytics." src="docs/assets/architecture-technical-light.svg" width="1200">
</picture>

The deployed units are the companion, one API worker, and the external services. Retrieval and validation run **inside the API process**. The local EmbeddingGemma index marked † is active development; `main` currently uses the lexical route with tag/pgvector fallback.

1. **Retrieve.** A fresh in-process knowledge snapshot nominates up to three candidates for eligible autocomplete requests. Otherwise, Gemini extracts tags and `gemini-embedding-001` produces 768-dimensional vectors for pgvector search.
2. **Review and generate.** One structured `gemini-3.5-flash-lite` call reviews every candidate and returns a suffix, a question with edits, or `none`. Keeping a candidate requires an explicit keep decision and a score of at least 0.5.
3. **Validate and return.** Python checks response types, anchored UTF-16 edits, and source freshness. Invalid output gets one retry. The editor rejects stale revisions and supports Tab to accept, Escape to dismiss, and IME composition.
4. **Record.** Tiger stores knowledge, handoffs, outcomes, and metadata traces. Snowflake receives explicit exports for offline classifier training; it is outside the suggestion path.

## Stack

| Layer             | Implementation                                              |
| :---------------- | :---------------------------------------------------------- |
| Companion         | Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui |
| API               | Python 3.12+ · FastAPI · Pydantic · Psycopg 3               |
| Inference         | Google Gen AI SDK · Gemini Flash-Lite · Gemini Embedding    |
| Storage           | Tiger Data / PostgreSQL · pgvector · TimescaleDB            |
| Agent integration | MCP server + Codex skill · explicit prompt handoff          |
| Analytics         | Snowflake ML Classification · derived outcome features      |

Source defaults and failure behavior are documented in the [architecture guide](docs/architecture.md). The application currently assumes **one user and one API worker**.

## Run locally

Requires Python **3.12+**, `uv`, Node.js **20.9+**, `pnpm`, a Gemini API key, and a Tiger Data PostgreSQL database with pgvector and TimescaleDB.

```bash
cp .env.example .env
python3 scripts/set-secret.py GEMINI_API_KEY
python3 scripts/set-secret.py DATABASE_URL

cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Migrations run at startup. In another terminal:

```bash
cd frontend
pnpm install
pnpm dev
```

Open [localhost:3000](http://localhost:3000). To load sample knowledge, run `uv run python -m app.knowledge.seed` from `backend/`. Follow the [Codex plugin guide](docs/codex-plugin.md) to enable **Send to Codex**. Snowflake is optional for suggestions and required only for export/training.

## Repository

| Path                             | Contents                                                   |
| :------------------------------- | :--------------------------------------------------------- |
| [`frontend/`](frontend/)         | Companion UI, request state, browser tests                 |
| [`backend/app/`](backend/app/)   | API, retrieval/generation pipeline, persistence, analytics |
| [`backend/seed/`](backend/seed/) | Sample skills and coding guidance                          |
| [`plugin/`](plugin/)             | Codex marketplace, MCP server, and skill                   |
| [`docs/`](docs/)                 | API contract, architecture, measured performance, research |

The [performance report](docs/performance.md) records measured runs with their settings and corpus. Local embedding work is not an end-to-end latency claim. Logs contain metadata; knowledge records and explicit handoff prompts store content in Tiger, and Gemini receives the context needed for generation.

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

Optional visualization: [rotate the 3D model on GitHub](docs/assets/architecture.stl) or [run the minimal Three.js viewer](docs/architecture-view/README.md). The technical diagram above renders directly in the README in both light and dark mode.
