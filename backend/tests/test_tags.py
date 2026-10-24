import uuid

from httpx import AsyncClient
from pgvector import Vector

from app.db.pool import connection
from app.knowledge import tags as tag_service
from app.llm import gemini


async def test_tags_endpoint_counts_and_search(client: AsyncClient) -> None:
    name = f"test-{uuid.uuid4().hex[:10]}-tag"
    [vec] = await gemini.embed([name])
    async with connection() as conn:
        tag_id = (
            await (
                await conn.execute(
                    "INSERT INTO tag (name, embedding) VALUES (%s, %s) RETURNING id", (name, Vector(vec))
                )
            ).fetchone()
        )["id"]
        try:
            items = (await client.get("/v1/tags", params={"q": name})).json()["items"]
            assert items == [{"name": name, "knowledge_count": 0}]
        finally:
            await conn.execute("DELETE FROM tag WHERE id = %s", (tag_id,))


async def test_normalise_and_merge_similar() -> None:
    assert tag_service.normalise("  Exponential Backoff! ") == "exponential-backoff"
    assert tag_service.normalise_all(["Retry", "retry", "A_B"]) == ["retry", "a-b"]
    unique = f"test-{uuid.uuid4().hex[:8]}-retries"
    [vec] = await gemini.embed(["retry"])
    async with connection() as conn:
        await conn.execute(
            "INSERT INTO tag (name, embedding) VALUES ('retry', %s) ON CONFLICT (name) DO NOTHING", (Vector(vec),)
        )
        names, vectors = await tag_service.embed_new_tags(conn, ["retry"], merge_similar=True)
        assert names == ["retry"] and vectors == {}
        names, _ = await tag_service.embed_new_tags(conn, [unique], merge_similar=False)
        assert names == [unique]
