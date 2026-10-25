"""Exercise the shipped manifests from a cached plugin path outside the caller's CWD."""

import json
import os
import shutil
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

PLUGIN = Path(__file__).resolve().parents[2]


def read_json(path):
    return json.loads(path.read_text())


def test_manifests_and_marketplaces_resolve_inside_package():
    codex = read_json(PLUGIN / ".codex-plugin/plugin.json")
    claude = read_json(PLUGIN / ".claude-plugin/plugin.json")
    assert codex["name"] == claude["name"] == "prompt-enhance"
    assert codex["version"] == claude["version"]
    assert (PLUGIN / codex["mcpServers"]).is_file()
    assert (PLUGIN / codex["skills"] / "prompt-enhance/SKILL.md").is_file()
    # Both the local plugin directory and GitHub repository are installable marketplaces.
    for root in (PLUGIN.parent, PLUGIN.parents[1]):
        marketplace = read_json(root / ".claude-plugin/marketplace.json")
        for entry in marketplace["plugins"]:
            assert (root / entry["source"] / ".claude-plugin/plugin.json").is_file()
    codex_marketplace = read_json(PLUGIN.parent / ".agents/plugins/marketplace.json")
    source = codex_marketplace["plugins"][0]["source"]["path"]
    assert (PLUGIN.parent / source / ".codex-plugin/plugin.json").is_file()


@pytest.mark.parametrize("host", ["codex", "claude"])
async def test_cached_package_starts_outside_repository(tmp_path, monkeypatch, host):
    cached = tmp_path / "plugin cache with spaces" / "prompt-enhance"
    shutil.copytree(PLUGIN, cached, ignore=shutil.ignore_patterns(".venv", "__pycache__", ".pytest_cache"))
    outside = tmp_path / "unrelated project"
    outside.mkdir()
    monkeypatch.chdir(outside)
    if host == "codex":
        config = read_json(cached / ".mcp.json")["mcpServers"]["prompt-enhance"]
        # Codex documents relative cwd as plugin-root-relative.
        cwd = str(cached / config["cwd"])
    else:
        # Claude merges the manifest after .mcp.json; the same server name overrides it.
        config = read_json(cached / ".claude-plugin/plugin.json")["mcpServers"]["prompt-enhance"]
        config["args"] = [arg.replace("${CLAUDE_PLUGIN_ROOT}", str(cached)) for arg in config["args"]]
        cwd = str(outside)
    assert "--frozen" in config["args"]
    params = StdioServerParameters(
        command=config["command"], args=config["args"], cwd=cwd,
        env={**os.environ, "PROMPT_ENHANCE_API_URL": "http://127.0.0.1:9"},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            assert {tool.name for tool in (await session.list_tools()).tools} >= {
                "get_refined_prompt", "enhance_prompt", "list_prompt_versions", "get_prompt_version"
            }
