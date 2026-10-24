"""SQL for knowledge, tags and links."""

from uuid import UUID

from pgvector import Vector
from psycopg import AsyncConnection

from app.knowledge.models import Kind, TagCount

_SELECT = """
SELECT k.id, k.kind, k.title, k.summary, k.use_count, k.created_at, k.updated_at{body},
       COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL), '{{}}') AS tags
FROM knowledge k
LEFT JOIN knowledge_tag kt ON kt.knowledge_id = k.id
LEFT JOIN tag t ON t.id = kt.tag_id
"""


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


async def get_detail(conn: AsyncConnection, kid: UUID) -> dict | None:
    cur = await conn.execute(_SELECT.format(body=", k.body") + "WHERE k.id = %s GROUP BY k.id", (kid,))
    return await cur.fetchone()


async def title_exists(conn: AsyncConnection, title: str) -> bool:
    cur = await conn.execute("SELECT 1 FROM knowledge WHERE title = %s LIMIT 1", (title,))
    return await cur.fetchone() is not None


async def list_items(
    conn: AsyncConnection, *, q: str | None, kind: Kind | None, tags: list[str], offset: int, limit: int
) -> tuple[list[dict], int]:
    where: list[str] = []
    params: list[object] = []
    if q:
        where.append("(k.title ILIKE %s OR k.summary ILIKE %s OR k.body ILIKE %s)")
        params += [_like(q)] * 3
    if kind:
        where.append("k.kind = %s")
        params.append(kind)
    if tags:
        where.append(
            "k.id IN (SELECT kt2.knowledge_id FROM knowledge_tag kt2 JOIN tag t2 ON t2.id = kt2.tag_id "
            "WHERE t2.name = ANY(%s) GROUP BY kt2.knowledge_id HAVING count(DISTINCT t2.name) = %s)"
        )
        params += [tags, len(set(tags))]
    clause = ("WHERE " + " AND ".join(where) + " ") if where else ""
    total_cur = await conn.execute(f"SELECT count(*) AS n FROM knowledge k {clause}", params)
    total = (await total_cur.fetchone())["n"]  # type: ignore[index]
    cur = await conn.execute(
        _SELECT.format(body="") + clause + "GROUP BY k.id ORDER BY k.updated_at DESC, k.id LIMIT %s OFFSET %s",
        [*params, limit, offset],
    )
    return await cur.fetchall(), total


async def insert(conn: AsyncConnection, kind: str, title: str, body: str, summary: str) -> UUID:
    cur = await conn.execute(
        "INSERT INTO knowledge (kind, title, body, summary) VALUES (%s, %s, %s, %s) RETURNING id",
        (kind, title, body, summary),
    )
    return (await cur.fetchone())["id"]  # type: ignore[index]


async def update_fields(conn: AsyncConnection, kid: UUID, fields: dict[str, str]) -> None:
    sets = ", ".join(f"{col} = %s" for col in fields)
    await conn.execute(f"UPDATE knowledge SET {sets}, updated_at = now() WHERE id = %s", [*fields.values(), kid])


async def delete(conn: AsyncConnection, kid: UUID) -> bool:
    cur = await conn.execute("DELETE FROM knowledge WHERE id = %s", (kid,))
    return cur.rowcount > 0


async def replace_tags(
    conn: AsyncConnection, kid: UUID, names: list[str], vectors: dict[str, list[float]]
) -> list[str]:
    """Upsert tags (vectors needed only for names not yet stored) and replace the item's links.

    Returns the names that were newly created.
    """
    created: list[str] = []
    ids: list[UUID] = []
    for name in names:
        if name in vectors:
            cur = await conn.execute(
                "INSERT INTO tag (name, embedding) VALUES (%s, %s) "
                "ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, (xmax = 0) AS inserted",
                (name, Vector(vectors[name])),
            )
        else:
            cur = await conn.execute("SELECT id, false AS inserted FROM tag WHERE name = %s", (name,))
        row = await cur.fetchone()
        if row is None:
            raise LookupError(f"tag {name} vanished")
        ids.append(row["id"])
        if row["inserted"]:
            created.append(name)
    await conn.execute("DELETE FROM knowledge_tag WHERE knowledge_id = %s", (kid,))
    if ids:
        await conn.execute(
            "INSERT INTO knowledge_tag (knowledge_id, tag_id) SELECT %s, unnest(%s::uuid[]) ON CONFLICT DO NOTHING",
            (kid, ids),
        )
    return created


async def list_tags(conn: AsyncConnection, q: str | None, limit: int) -> list[TagCount]:
    cur = await conn.execute(
        "SELECT t.name, count(kt.knowledge_id)::int AS knowledge_count FROM tag t "
        "LEFT JOIN knowledge_tag kt ON kt.tag_id = t.id WHERE (%s::text IS NULL OR t.name ILIKE %s) "
        "GROUP BY t.id ORDER BY knowledge_count DESC, t.name LIMIT %s",
        (q, _like(q) if q else None, limit),
    )
    return [TagCount(**r) for r in await cur.fetchall()]
