import pytest
from httpx import AsyncClient


async def test_health_shallow(client: AsyncClient) -> None:
    body = (await client.get("/v1/health")).json()
    assert body["status"] == "ok" and body["db"] == "ok" and body["gemini"] == "unchecked"
    assert isinstance(body["latency_ms"], int)


@pytest.mark.live
async def test_health_deep(client: AsyncClient) -> None:
    body = (await client.get("/v1/health", params={"deep": 1})).json()
    assert body["gemini"] == "ok" and body["status"] == "ok"
