import httpx
import pytest

from prompt_enhance_mcp import client

VERSION_ID = "ee8bab83-e165-4dd8-bd34-f7951555798a"


async def test_list_versions_requests_page_and_excludes_full_prompt_content(monkeypatch):
    calls = []

    async def request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return httpx.Response(200, json={
            "total": 251,
            "items": [{"id": VERSION_ID, "title": "Release plan", "description": "Include rollback",
                       "prompt": "not included in listing", "suggestion_text": "or this", "saved_text": "nor this"}],
        })

    monkeypatch.setattr(client, "_request", request)
    result = await client.list_prompt_versions(limit=500, offset=-1)
    assert calls == [("GET", "/v1/prompt-history", {"params": {"limit": 200, "offset": 0}})]
    assert result["total"] == 251
    assert result["items"][0]["title"] == "Release plan"
    assert not {"prompt", "suggestion_text", "saved_text"} & result["items"][0].keys()


async def test_get_version_preserves_draft_and_unaccepted_suggestion(monkeypatch):
    version = {"id": VERSION_ID, "prompt": "Ship it", "suggestion_text": " with tests", "saved_text": "Ship it with tests"}

    async def request(method, path, **kwargs):
        assert method == "GET" and path == f"/v1/prompt-history/{VERSION_ID}"
        return httpx.Response(200, json=version)

    monkeypatch.setattr(client, "_request", request)
    assert (await client.get_prompt_version(VERSION_ID))["version"] == version


@pytest.mark.parametrize("version_id", ["../handoff/latest", "not-an-id", ""])
async def test_get_version_rejects_invalid_ids_without_network(monkeypatch, version_id):
    async def unexpected_request(*args, **kwargs):
        pytest.fail("Invalid history ids must not reach the network")

    monkeypatch.setattr(client, "_request", unexpected_request)
    with pytest.raises(client.BackendError, match="must be a UUID"):
        await client.get_prompt_version(version_id)


async def test_missing_version_is_actionable(monkeypatch):
    async def request(*args, **kwargs):
        return httpx.Response(404)

    monkeypatch.setattr(client, "_request", request)
    result = await client.get_prompt_version(VERSION_ID)
    assert result["found"] is False and "deleted" in result["message"]


async def test_history_backend_errors_remain_errors(monkeypatch):
    async def request(*args, **kwargs):
        return httpx.Response(503, json={"error": {"code": "unavailable", "message": "Database unavailable"}})

    monkeypatch.setattr(client, "_request", request)
    with pytest.raises(client.BackendError, match="503 unavailable"):
        await client.list_prompt_versions()


async def test_empty_handoff_uses_host_neutral_guidance(monkeypatch):
    async def request(*args, **kwargs):
        return httpx.Response(404)

    monkeypatch.setattr(client, "_request", request)
    result = await client.get_refined_prompt()
    assert not result["found"] and "Codex or Claude" in result["message"]
