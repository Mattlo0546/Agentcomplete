# Local installation verification — 25 October 2026

The `prompt-enhance` 0.2.0 plugin is installed and enabled for the current user in Codex and Claude Code through the `prompt-enhance-local` marketplace. Claude Desktop also has a local MCP connection to the installed server; its Developer settings report **Running**.

The companion editor runs at `http://127.0.0.1:3000/refine`, the API at `http://127.0.0.1:8000`, and a dedicated TimescaleDB/pgvector container at loopback port 55435. The database uses the `prompt-enhance-data` Docker volume. Its generated credential is stored in the gitignored, mode-600 `.env`; no credentials belong in this report or plugin manifests.

## Verified against real services

- Full migrations `001_init.sql` and `002_prompt_history.sql` applied to the local TimescaleDB database.
- Saved a named Codex test version through the browser UI, changed the draft, restored the saved version after explicit confirmation, sent it to Codex, and verified the restored draft survived reload.
- A fresh native Codex app-server session loaded the installed plugin with status `connected` and all five tools. Actual `get_refined_prompt`, `list_prompt_versions`, and `get_prompt_version` calls returned the saved version and matching handoff, without a mock API or transport.
- Repeated the save/change/confirmed-restore/send/reload journey with a separate Claude test version.
- Claude Code's installed plugin health check connected successfully.
- A real Claude Desktop chat used `get_refined_prompt`, `list_prompt_versions`, and `get_prompt_version`, then confirmed that the restored saved text and handoff matched character for character. Each read received one-time approval; global tool approval policies were not relaxed.
- The fresh-database regression test starts the complete production app and saves/lists history on a newly created local database. The focused suite passed **19 tests**, with the older pgvector-only integration check skipped because it requires a separately named test database.

## Installation fix

On a fresh database, the connection pool previously tried to register pgvector types before migration 001 could create the extension. Pool startup now creates the extension through a plain connection first, and only publishes a successfully opened pool. A failed opening closes the candidate so startup can be retried.

## Live model and Codex verification

Gemini is now configured in the private `.env`. The API accepted the credential, returned the configured generation and embedding models, and passed deep health checks. Live requests produced both clarifying questions and autocomplete suffixes. The six backend core/health/handoff smoke tests passed, including structured generation and real 768-dimensional embeddings. All **20 plugin tests passed**, including the three previously skipped live-backend/model tests.

The browser's real ghost suffix was right-clicked and saved as **Codex live autocomplete** before acceptance. The draft remained unchanged; PostgreSQL retained the base prompt and a nonempty suggestion separately, and the outcome log contained `shown`/`superseded` with no `accepted` event. After changing the draft, confirmed restore recovered the combined saved text, which survived reload and was sent to Codex.

A fresh native Codex runtime then successfully called all five installed tools: `enhance_prompt` generated another real autocomplete, `search_knowledge` returned a valid list, and `list_prompt_versions`/`get_prompt_version`/`get_refined_prompt` confirmed exact equality between the saved base plus suffix, restored version, and handoff. This pass used actual Gemini, PostgreSQL, the installed plugin, and the browser UI, with no intercepted API responses.

Two live autocomplete requests exceeded the original eight-second per-model timeout. This installation now uses `LLM_TIMEOUT_S=20`; one successful observed autocomplete generation took 5.40 seconds. The repository default is unchanged.

The standalone Codex CLI rejected the desktop configuration's `gpt-6.1-sol` model alias. Its live model list identified `gpt-6-astra` as the account-supported CLI default. A final ephemeral chat used that model for the probe, called the installed history/handoff tools, and returned:

```json
{"title":"Codex live autocomplete","suggestion_saved_separately":true,"exact_match":true}
```

The owner's app model and reasoning settings were left unchanged. Codex desktop UI automation is restricted in this session, so verification used the native runtime and fresh CLI chat. Claude was installed and its initial history round-trip was verified above; further Claude testing was deferred at the owner's request after Desktop required sign-in again.

To rerun the fresh-database test, set `PROMPT_ENHANCE_TEST_DATABASE_URL` to the explicitly opted-in local `prompt_enhance` database and run from `backend/`:

```bash
uv run python -m pytest --confcutdir=tests/offline tests/offline -q
```

The test refuses external hosts and creates/removes a separate temporary database; it does not delete the installation's saved history.
