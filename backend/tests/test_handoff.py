from httpx import AsyncClient

from app.db.pool import connection


async def test_handoff_keeps_only_newest(client: AsyncClient) -> None:
    first = await client.post("/v1/handoff", json={"prompt": "First refined prompt 😀"})
    second = await client.post("/v1/handoff", json={"prompt": "Second refined prompt 日本語"})
    assert first.status_code == second.status_code == 200
    assert {"id", "created_at"} == second.json().keys()
    latest = await client.get("/v1/handoff/latest")
    assert latest.status_code == 200
    assert latest.json() == {**second.json(), "prompt": "Second refined prompt 日本語"}
    async with connection() as conn:
        rows = await (await conn.execute("SELECT id FROM handoff")).fetchall()
    assert [str(r["id"]) for r in rows] == [second.json()["id"]]
    assert (await client.post("/v1/handoff", json={"prompt": "  "})).status_code == 422
