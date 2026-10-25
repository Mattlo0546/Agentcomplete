# Skill Issue

A prompt companion for Codex. Retrieves relevant skills and examples, reviews them with Gemini, and suggests ghost text or clarifying edits while you type.

[Architecture](docs/architecture.md) · [API reference](docs/api.md) · [Codex plugin](docs/codex-plugin.md) · [Performance](docs/performance.md)

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/architecture-technical-dark.svg">
  <img alt="Skill Issue backend pipelines: one FastAPI worker tries the complete catalog, lexical, direct semantic, then tag/pgvector retrieval before fresh Gemini review and validation. Knowledge ingestion, Codex handoff, telemetry, and offline Snowflake training share Tiger PostgreSQL." src="docs/assets/architecture-technical-light.svg" width="1200">
</picture>

The runtime consists of the companion, one API worker, and external services. Retrieval and validation run **inside the API process**. The current default is **complete-catalog review**, followed by lexical, direct semantic, and tag/pgvector fallback routes. Local EmbeddingGemma retrieval is implemented on `main` and requires optional model files and dependencies.

1. **Select context.** A fresh Tiger snapshot sends every knowledge body to review when the catalog fits 64 items and 80,000 serialized characters. Otherwise, eligible autocomplete requests try a lexical shortlist, then a direct semantic index, then Gemini tags and pgvector. The first usable route wins; semantic-first is an explicit override.
2. **Review and generate.** One structured `gemini-3.5-flash-lite` call reviews every candidate and returns a suffix, a question with edits, or `none`. Keeping a candidate requires an explicit keep decision and a score of at least 0.5.
3. **Validate and return.** Python checks response types, partial-word suffixes, anchored UTF-16 edits, and source freshness. Invalid output gets one retry. The editor enforces request/revision checks and bounded exact-prefix adoption of older suffixes.
4. **Maintain knowledge and hand off.** Knowledge ingestion summarizes and tags concurrently, embeds new tags, saves atomically, and invalidates retrieval caches. Send to Codex stores one latest prompt for the MCP plugin to fetch.
5. **Record and learn offline.** Metadata traces and usage counts persist in the background; reactions create outcome events. Explicit exports feed Snowflake classifier training, outside the suggestion path.

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

Optional visualization: [rotate the 3D model on GitHub](docs/assets/architecture.stl) or [run the minimal Three.js viewer](docs/architecture-view/README.md). The technical diagram above renders directly in the README in both light and dark mode.
