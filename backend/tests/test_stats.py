import json
import uuid

from httpx import AsyncClient

from app.db.pool import connection


async def test_stats_shape_and_counts(client: AsyncClient) -> None:
    before = (await client.get("/v1/stats")).json()
    rid = f"req_s{uuid.uuid4().hex[:10]}"
    async with connection() as conn:
        await conn.execute(
            "INSERT INTO enhance_trace (request_id, prompt_revision, result_type, general)"
            " VALUES (%s, 1, 'autocomplete', false)",
            (rid,),
        )
        for event in ("shown", "accepted"):
            await conn.execute(
                "INSERT INTO outcome_event (request_id, prompt_revision, event, features) VALUES (%s, 1, %s, %s)",
                (rid, event, json.dumps({})),
            )
    try:
        body = (await client.get("/v1/stats")).json()
        assert set(body) == {
            "suggestions", "accepted_pct", "declined_pct", "p50_latency_ms", "classifier", "log_entries", "log_bytes"
        }  # fmt: skip
        assert body["suggestions"] >= before["suggestions"] + 1
        assert 0 <= body["accepted_pct"] <= 100 and 0 <= body["declined_pct"] <= 100
        assert body["log_bytes"] > 0 and isinstance(body["p50_latency_ms"], int)
    finally:
        async with connection() as conn:
            await conn.execute("DELETE FROM enhance_trace WHERE request_id = %s", (rid,))
            await conn.execute("DELETE FROM outcome_event WHERE request_id = %s", (rid,))
