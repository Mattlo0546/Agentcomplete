import json
import os
import sys

import httpx
import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from prompt_enhance_mcp import client

API = os.environ.get("PROMPT_ENHANCE_API_URL", "http://127.0.0.1:8000")


def _backend_up() -> bool:
    try:
        return httpx.get(f"{API}/v1/health", timeout=2).status_code < 500
    except httpx.HTTPError:
        return False


live = pytest.mark.skipif(not _backend_up(), reason=f"no Prompt Enhance backend running at {API}")


async def test_backend_down_gives_clear_error(monkeypatch):
    monkeypatch.setenv("PROMPT_ENHANCE_API_URL", "http://127.0.0.1:9")
    with pytest.raises(client.BackendError, match="not reachable"):
        await client.get_refined_prompt()


@live
async def test_get_refined_prompt_roundtrip():
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{API}/v1/handoff", json={"prompt": "mcp test ☃ prompt"})
        assert r.status_code in (200, 201)
    got = await client.get_refined_prompt()
    assert got["found"] and got["prompt"] == "mcp test ☃ prompt"


@live
async def test_search_knowledge_shape():
    out = await client.search_knowledge("a", limit=2)
    assert "items" in out and len(out["items"]) <= 2


@live
async def test_enhance_prompt_shape():
    out = await client.enhance_prompt("fix the bug")
    assert out["type"] in ("autocomplete", "multiple_choice", "none")
    if out["type"] == "multiple_choice":
        assert all(o["resulting_prompt"] for o in out["options"])


async def test_stdio_lists_tools():
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "prompt_enhance_mcp.server"],
        env={**os.environ, "PROMPT_ENHANCE_API_URL": "http://127.0.0.1:9"},
    )
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            names = {t.name for t in (await s.list_tools()).tools}
            assert names == {"get_refined_prompt", "enhance_prompt", "search_knowledge"}
            res = await s.call_tool("get_refined_prompt", {})
            assert res.isError and "not reachable" in json.dumps([c.model_dump() for c in res.content])
