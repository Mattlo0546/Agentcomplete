# Codex plugin: prompt-enhance

Bundles an MCP server (`get_refined_prompt`, `enhance_prompt`, `search_knowledge`) and a skill. It talks to the local backend at `PROMPT_ENHANCE_API_URL` (default `http://127.0.0.1:8000`). Requires `uv` and Codex CLI.

## Install

Add the repo-local marketplace:

```bash
codex plugin marketplace add ./plugin
```

Install the plugin:

```bash
codex plugin add prompt-enhance@prompt-enhance-local
```

This writes the marketplace and `[plugins."prompt-enhance@prompt-enhance-local"]` into `~/.codex/config.toml` and copies the plugin to `~/.codex/plugins/cache/`. Restart Codex afterwards. The first start runs `uv` once to create the server's environment.

Remove:

```bash
codex plugin remove prompt-enhance@prompt-enhance-local
```

## Use

1. Start the backend on `127.0.0.1:8000` and the companion panel.
2. In the panel, refine a prompt and press Send to Codex.
3. In Codex, say `@prompt-enhance use my refined prompt`. Codex calls `get_refined_prompt` and works from it.

`enhance_prompt` returns an autocomplete suffix, or a question with options and the resulting prompt for each. `search_knowledge` returns matching saved items as reference data only.

## Backend elsewhere

Change `PROMPT_ENHANCE_API_URL` in `plugin/prompt-enhance/.mcp.json`, then reinstall.

## Test

```bash
cd plugin/prompt-enhance/mcp && uv run pytest -q
```

Tests that need the real backend are skipped when nothing listens on `127.0.0.1:8000`.
