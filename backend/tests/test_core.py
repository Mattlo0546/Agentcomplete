from httpx import AsyncClient
from pydantic import BaseModel

from app.db.pool import connection
from app.llm import gemini
from app.observability.context import set_request_id
from app.observability.writers import flush


class _Echo(BaseModel):
    word: str


async def test_structured_generation_and_ai_log() -> None:
    set_request_id("req_coretest0001")
    out = await gemini.generate_structured(
        operation="core_smoke",
        model="gemini-3.5-flash-lite",
        system="Return JSON only.",
        contents="Return the word ok in field `word`.",
        schema=_Echo,
    )
    assert out.word.lower().strip() == "ok"
    await flush()
    async with connection() as conn:
        row = await (
            await conn.execute(
                "SELECT status, input_tokens FROM ai_call_log WHERE request_id = %s ORDER BY time DESC LIMIT 1",
                ("req_coretest0001",),
            )
        ).fetchone()
    assert row is not None and row["status"] == "ok" and row["input_tokens"]


async def test_embed_dimensions() -> None:
    vectors = await gemini.embed(["retry backoff", "postgres migrations"])
    assert [len(v) for v in vectors] == [768, 768]


async def test_request_id_echoed_and_api_logged(client: AsyncClient) -> None:
    response = await client.get("/v1/does-not-exist", headers={"X-Request-ID": "req_coretest0002"})
    assert response.headers["X-Request-ID"] == "req_coretest0002"
    await flush()
    async with connection() as conn:
        row = await (
            await conn.execute("SELECT status FROM api_call_log WHERE request_id = %s", ("req_coretest0002",))
        ).fetchone()
    assert row is not None and row["status"] == 404
