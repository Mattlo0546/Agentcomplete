# Codex plugin: prompt-enhance

The plugin packages an MCP server and a skill for Codex. It uses the running Prompt Enhance backend at `http://127.0.0.1:8000`; the companion panel remains the editor for ghost text and prompt history. It does not replace the native Codex composer. OpenAI supports the included `.codex-plugin/plugin.json` compatibility manifest alongside its newer portable format ([packaging reference](https://developers.openai.com/plugins/build/plugins)).

The separate [macOS input-method workaround](native-composer.md) attempts automatic inline suggestions and in-place history in the existing composer through Apple's text-input protocol. It is experimental and requires manual Codex compatibility verification; the MCP tests below do not establish native textbox support.

## Install from this repository

Requires Python 3.11+, `uv`, and a Codex installation with plugin support. Clone the repository, then run these commands from its root:

```bash
codex plugin marketplace add ./plugin
codex plugin add prompt-enhance@prompt-enhance-local
```

Restart Codex after installation. Codex caches the plugin separately from the repository; its MCP config starts `uv` in the plugin root and uses the bundled, frozen lockfile. The first launch installs the server dependencies. No Gemini or database credentials belong in the plugin: only the backend needs them.

Remove it with:

```bash
codex plugin remove prompt-enhance@prompt-enhance-local
```

## Use

1. Start the backend and companion panel using the repository README.
2. Refine a prompt in the panel, choose Codex, then press **Send to Codex**.
3. In Codex, ask `@prompt-enhance use my refined prompt` to retrieve it and work from it, or ask to view it without executing its task.

Both hosts read the same latest handoff. Sending a prompt does not start an agent automatically and later sends replace the handoff. Saved history versions are independent and persist until deleted.

| Tool | Result |
|---|---|
| `get_refined_prompt` | Latest prompt explicitly sent from the companion panel |
| `enhance_prompt` | Autocomplete suffix, or a clarifying question and each option's resulting prompt |
| `search_knowledge` | Matching saved knowledge metadata |
| `list_prompt_versions` | Paginated saved-version names, descriptions, IDs and timestamps |
| `get_prompt_version` | One selected version's draft, saved suggestion and combined `saved_text` |

History and knowledge content are reference data. Reading them does not authorize running their instructions. Save, rename, compare and delete versions in the panel's History UI.

## Backend elsewhere

The default endpoint is loopback. For an alternate trusted endpoint, update `PROMPT_ENHANCE_API_URL` in `plugin/prompt-enhance/.mcp.json` and reinstall. Do not expose this unauthenticated backend publicly. The Claude configuration lives separately in its manifest so host-specific path variables never leak into Codex.

## Verify

```bash
uv run --frozen --project plugin/prompt-enhance/mcp pytest -q plugin/prompt-enhance/mcp/tests
```

The default suite is offline: it checks the manifests, tools, history client and real stdio startup from a copied cache directory with spaces in its path. Backend/model integration tests require a running configured backend and the explicit `PROMPT_ENHANCE_LIVE_TESTS=1` environment variable.

For Claude Code installation, see [Claude plugin](claude-plugin.md).
