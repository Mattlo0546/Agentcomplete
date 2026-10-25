# Claude Code plugin: prompt-enhance

The Claude Code plugin uses the same MCP server and skill as the Codex package. The companion panel remains the prompt editor and history UI. This package does not replace Claude's native composer or add a Claude chat website extension. Claude Desktop's separate MCP configuration is covered below.

## Install

Requires Python 3.11+, `uv`, and Claude Code with plugin support. After this branch is merged, register the GitHub marketplace and install:

```bash
claude plugin marketplace add Mattlo0546/Agentcomplete
claude plugin install prompt-enhance@prompt-enhance-local
```

To test an unmerged checkout, run from the repository root:

```bash
claude plugin marketplace add ./plugin
claude plugin install prompt-enhance@prompt-enhance-local
```

Alternatively, load it for one development session with `claude --plugin-dir ./plugin/prompt-enhance`. The local and GitHub marketplaces use the same name; register the source you intend to use.

Claude's manifest overrides the root Codex MCP entry with the same server name and passes `${CLAUDE_PLUGIN_ROOT}/mcp` directly as a `uv` argument. The installed path can change or contain spaces, and startup does not depend on the current project directory. The frozen Python lockfile stays inside the package. Claude documents the merge and path variable behavior in its [manifest reference](https://code.claude.com/docs/en/plugins-reference).

## Use

Start the backend and companion panel. Choose Claude, then **Send to Claude** in the panel. In Claude Code, invoke `/prompt-enhance:prompt-enhance` with a request to use or view the refined prompt. You can also ask Prompt Enhance to improve a draft or list saved prompt versions. Its `enhance_prompt` tool returns ghost-text content or a clarifying question with option previews.

Both Codex and Claude retrieve the same latest handoff; they do not have separate queues. A send stores the prompt and copies it for pasting. It does not execute anything automatically. To use an older version, ask `list_prompt_versions`, then `get_prompt_version` for the chosen UUID, or restore it through the panel's History control. Saved versions remain separate from the latest handoff.

The tools are documented in the [Codex plugin guide](codex-plugin.md#use). Knowledge and historical prompts are reference data; fetching one does not authorize executing it.

## Claude Desktop MCP setup

Claude Desktop can connect to the stdio server as a local MCP integration. Add an entry to its MCP configuration, replacing the project path with the absolute path to your checkout:

```json
{
  "mcpServers": {
    "prompt-enhance": {
      "command": "uv",
      "args": ["run", "--quiet", "--frozen", "--project", "/absolute/path/to/Agentcomplete/plugin/prompt-enhance/mcp", "prompt-enhance-mcp"],
      "env": { "PROMPT_ENHANCE_API_URL": "http://127.0.0.1:8000" }
    }
  }
}
```

Use an absolute path to `uv` too if Desktop cannot find it on `PATH`, then restart Desktop. This is an MCP connection, not the Claude Code plugin installer; the skill is not installed through that JSON. Do not paste backend Gemini/database credentials into either host's configuration.

## Verify and remove

Run from the repository root:

```bash
claude plugin validate --strict plugin/prompt-enhance
claude plugin validate --strict plugin
claude plugin validate --strict .
uv run --frozen --project plugin/prompt-enhance/mcp pytest -q plugin/prompt-enhance/mcp/tests
```

The default tests do not call Gemini or modify a running backend. Remove the plugin with `claude plugin uninstall prompt-enhance@prompt-enhance-local`.

Marketplace layout and installation follow Claude's [marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces). The backend is a local single-user service with no account authentication. Saved prompt text persists until deleted; metadata-only telemetry retention does not delete versions. Do not expose the backend on a public network without adding authentication and ownership checks.
