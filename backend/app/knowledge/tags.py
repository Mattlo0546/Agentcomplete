"""Tag normalisation, reuse of semantically equal tags, and embedding of new tags."""

import re

from pgvector import Vector
from psycopg import AsyncConnection

from app.errors import UpstreamError
from app.knowledge.models import GeneratedTags
from app.knowledge.prompts import MAX_MODEL_CHARS, TAG_SYSTEM, tag_prompt
from app.llm import gemini

REUSE_SIMILARITY = 0.9
HINT_LIMIT = 25
MAX_TAGS = 6


def normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64].strip("-")


def normalise_all(names: list[str], limit: int = 12) -> list[str]:
    seen: dict[str, None] = {}
    for n in names:
        slug = normalise(n)
        if slug:
            seen.setdefault(slug)
    return list(seen)[:limit]


async def nearest_tags(conn: AsyncConnection, vector: list[float], limit: int) -> list[tuple[str, float]]:
    cur = await conn.execute(
        "SELECT name, 1 - (embedding <=> %s) AS similarity FROM tag ORDER BY embedding <=> %s LIMIT %s",
        (Vector(vector), Vector(vector), limit),
    )
    return [(r["name"], float(r["similarity"])) for r in await cur.fetchall()]


async def existing_names(conn: AsyncConnection, names: list[str]) -> set[str]:
    cur = await conn.execute("SELECT name FROM tag WHERE name = ANY(%s)", (names,))
    return {r["name"] for r in await cur.fetchall()}


async def generate_tags(conn: AsyncConnection, kind: str, title: str, body: str, model: str) -> list[str]:
    """Ask the model for tags, hinting it with the existing tags nearest to the item."""
    [probe] = await gemini.embed([f"{title}\n{body[:800]}"], operation="knowledge_tag_probe")
    hints = [name for name, _ in await nearest_tags(conn, probe, HINT_LIMIT)]
    out = await gemini.generate_structured(
        operation="knowledge_tag",
        model=model,
        system=TAG_SYSTEM,
        contents=tag_prompt(kind, title, body[:MAX_MODEL_CHARS], hints),
        schema=GeneratedTags,
    )
    tags = normalise_all(out.tags, MAX_TAGS)
    if not tags:
        raise UpstreamError("upstream_invalid", "knowledge_tag returned no tags")
    return tags


async def embed_new_tags(
    conn: AsyncConnection, names: list[str], *, merge_similar: bool
) -> tuple[list[str], dict[str, list[float]]]:
    """Return final tag names and vectors for names that do not exist yet.

    With `merge_similar`, a new name whose nearest existing tag is >= 0.9 similar is replaced by that tag.
    """
    present = await existing_names(conn, names)
    fresh = [n for n in names if n not in present]
    vectors: dict[str, list[float]] = {}
    final = [n for n in names if n in present]
    if fresh:
        embedded = await gemini.embed(fresh, operation="knowledge_tag_embed")
        for name, vec in zip(fresh, embedded, strict=True):
            if merge_similar:
                near = await nearest_tags(conn, vec, 1)
                if near and near[0][1] >= REUSE_SIMILARITY:
                    final.append(near[0][0])
                    continue
            vectors[name] = vec
            final.append(name)
    return list(dict.fromkeys(final)), vectors
