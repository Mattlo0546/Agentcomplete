import json
import os
import uuid

import pytest
from httpx import AsyncClient

from app.db.pool import connection
from app.observability.writers import flush, record_ai_call, record_api_call


@pytest.fixture
async def rid() -> str:
    value = f"req_t{uuid.uuid4().hex[:10]}"
    yield value  # type: ignore[misc]
    async with connection() as conn:
        for table in ("api_call_log", "ai_call_log", "enhance_trace", "outcome_event"):
            await conn.execute(f"DELETE FROM {table} WHERE request_id = %s", (value,))  # type: ignore[arg-type]


async def _seed(rid: str) -> None:
    await record_api_call(rid, "POST", "/v1/enhance", 200, 120, None)
    await record_ai_call(rid, "tags", "m1", "ok", 40, 10, 5, None)
    await record_ai_call(rid, "generate", "m2", "error", 80, None, None, "boom")
    await flush()
    async with connection() as conn:
        await conn.execute(
            "INSERT INTO enhance_trace (request_id, prompt_revision, result_type, general, features)"
            " VALUES (%s, 3, 'autocomplete', false, %s)",
            (rid, json.dumps({"task_type": "writing"})),
        )
        await conn.execute(
            "INSERT INTO outcome_event (request_id, prompt_revision, event, time_to_action_ms)"
            " VALUES (%s, 3, 'accepted', 900)",
            (rid,),
        )


async def test_list_groups_children_and_filters(client: AsyncClient, rid: str) -> None:
    await _seed(rid)
    items = (await client.get("/v1/logs", params={"request_id": rid})).json()["items"]
    assert len(items) == 1 and items[0]["path"] == "/v1/enhance"
    assert {c["operation"] for c in items[0]["children"]} == {"tags", "generate"}
    assert (await client.get("/v1/logs", params={"request_id": rid, "status": "4xx"})).json()["items"] == []
    assert len((await client.get("/v1/logs", params={"request_id": rid, "status": "2xx"})).json()["items"]) == 1
    ai = (await client.get("/v1/logs", params={"request_id": rid, "kind": "ai"})).json()["items"]
    assert len(ai) == 2 and "children" not in ai[0]
    errors = (await client.get("/v1/logs", params={"request_id": rid, "kind": "ai", "status": "5xx"})).json()["items"]
    assert [e["status"] for e in errors] == ["error"]
    before = items[0]["time"]
    assert (await client.get("/v1/logs", params={"request_id": rid, "before": before})).json()["items"] == []


async def test_detail(client: AsyncClient, rid: str) -> None:
    await _seed(rid)
    body = (await client.get(f"/v1/logs/{rid}")).json()
    assert body["api"]["request_id"] == rid and len(body["ai"]) == 2
    assert body["trace"]["result_type"] == "autocomplete"
    assert body["outcome"] == {"event": "accepted", "time_to_action_ms": 900}
    assert (await client.get("/v1/logs/req_missing000000")).status_code == 404


@pytest.mark.skipif(
    os.environ.get("PE_TEST_DESTRUCTIVE") != "1",
    reason="DELETE /v1/logs clears every log row in the shared database; set PE_TEST_DESTRUCTIVE=1 to run",
)
async def test_delete_keeps_outcomes(client: AsyncClient, rid: str) -> None:
    await _seed(rid)
    # Snapshot other workers' rows is impossible, so only assert on this request's rows after clearing.
    assert (await client.delete("/v1/logs")).status_code == 204
    async with connection() as conn:
        for table, expected in (("api_call_log", 0), ("ai_call_log", 0), ("enhance_trace", 0), ("outcome_event", 1)):
            row = await (
                await conn.execute(f"SELECT count(*) AS n FROM {table} WHERE request_id = %s", (rid,))  # type: ignore[arg-type]
            ).fetchone()
            assert row is not None and row["n"] == expected, table
