import pytest
from httpx import AsyncClient


@pytest.fixture
async def original(client: AsyncClient):
    saved = (await client.get("/v1/settings")).json()
    yield saved
    await client.put(
        "/v1/settings",
        json={k: saved[k] for k in ("trigger_delay_ms", "autocomplete_enabled", "questions_enabled", "max_options")},
    )


async def test_get_put_roundtrip(client: AsyncClient, original: dict) -> None:
    assert original["retention_days"] == 30 and original["store_payloads"] is False
    updated = (await client.put("/v1/settings", json={"trigger_delay_ms": 700, "max_options": 3})).json()
    assert updated["trigger_delay_ms"] == 700 and updated["max_options"] == 3
    assert (await client.get("/v1/settings")).json()["trigger_delay_ms"] == 700


async def test_validation_and_read_only(client: AsyncClient, original: dict) -> None:
    assert (await client.put("/v1/settings", json={"trigger_delay_ms": 100})).status_code == 422
    assert (await client.put("/v1/settings", json={"max_options": 7})).status_code == 422
    body = (await client.put("/v1/settings", json={"retention_days": 1, "store_payloads": True})).json()
    assert body["retention_days"] == 30 and body["store_payloads"] is False
