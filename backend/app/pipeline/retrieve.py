"""Step 2: embed tags → pgvector nearest-neighbour over tag vectors → linked knowledge candidates."""

import time
from dataclasses import dataclass, field
from uuid import UUID

from app.config import get_settings
from app.db.pool import connection
from app.llm import gemini
from app.pipeline.cache import TTLCache

# Tuned on the live tag set (gemini-embedding-001, 768d, SEMANTIC_SIMILARITY): unrelated tags score 0.75-0.86,
# near-synonyms 0.88-0.98 (webhook→webhooks .977, unit-tests→unit-testing .978, retry-logic→retry .953) with a few
# lexical false friends up to ~.89 (data-structures→data-fetching), which the judge step drops.
SIMILARITY_THRESHOLD = 0.88
NEIGHBOURS_PER_TAG = 8
MAX_CANDIDATES = 5
BODY_PREFETCH_CHARS = 8000
RETRIEVAL_TTL_S = 15

# One round trip: nearest stored tags per query vector → best similarity per query tag, and the top
# knowledge items linked to tags above the threshold (ranked by their best tag similarity).
_RETRIEVE_SQL = """
WITH hits AS (
    SELECT q.i::int AS i, t.id AS tag_id, t.name, t.similarity
    FROM unnest(%(vectors)s::vector[]) WITH ORDINALITY AS q(v, i)
    CROSS JOIN LATERAL (
        SELECT id, name, 1 - (embedding <=> q.v) AS similarity
        FROM tag ORDER BY embedding <=> q.v LIMIT %(neighbours)s
    ) t
), ranked AS (
    SELECT kt.knowledge_id, max(h.similarity) AS similarity, array_agg(DISTINCT h.name) AS matched_tags
    FROM hits h JOIN knowledge_tag kt ON kt.tag_id = h.tag_id
    WHERE h.similarity >= %(threshold)s
    GROUP BY kt.knowledge_id ORDER BY similarity DESC LIMIT %(limit)s
)
SELECT
    (SELECT coalesce(json_object_agg(i, similarity), '{}') FROM (SELECT i, max(similarity) AS similarity
        FROM hits GROUP BY i) b) AS tag_similarity,
    (SELECT coalesce(json_agg(json_build_object(
        'id', k.id, 'kind', k.kind, 'title', k.title, 'summary', k.summary, 'body', left(k.body, %(body)s),
        'similarity', r.similarity, 'matched_tags', r.matched_tags) ORDER BY r.similarity DESC), '[]')
     FROM ranked r JOIN knowledge k ON k.id = r.knowledge_id) AS candidates
"""


@dataclass
class Candidate:
    id: UUID
    kind: str
    title: str
    summary: str
    body: str
    similarity: float
    matched_tags: list[str] = field(default_factory=list)


@dataclass
class Retrieval:
    tag_similarity: dict[str, float]
    candidates: list[Candidate]
    # Retain source age across cache hits and prompt revisions; reuse never renews freshness.
    fetched_at: float = field(default_factory=time.monotonic)
    generation: int = field(default_factory=lambda: _generation)
    # Every item from a complete bounded snapshot is available to the fresh model reviewer.
    complete_catalog: bool = False


_embeddings: TTLCache[tuple[str, int, str], list[float]] = TTLCache(1024, 3600)
_retrievals: TTLCache[tuple[str, int, tuple[str, ...], float], Retrieval] = TTLCache(128, RETRIEVAL_TTL_S)
_presence: TTLCache[str, bool] = TTLCache(1, RETRIEVAL_TTL_S)
_generation = 0


def cache_generation() -> int:
    return _generation


def invalidate_cache() -> None:
    """Call after knowledge/tag writes; don't let an older in-flight SELECT repopulate the cache."""
    global _generation
    _generation += 1
    _retrievals.clear()
    _presence.clear()


def is_fresh(retrieval: Retrieval) -> bool:
    return retrieval.generation == _generation and 0 <= time.monotonic() - retrieval.fetched_at < RETRIEVAL_TTL_S


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{x:.7g}" for x in vector) + "]"


async def has_tags() -> bool:
    cached = _presence.get("tags")
    if cached is not None:
        return cached
    generation = _generation
    async with connection() as conn:
        row = await (await conn.execute("SELECT EXISTS (SELECT 1 FROM tag) AS present")).fetchone()
    present = bool(row and row["present"])
    if generation == _generation:
        _presence.put("tags", present)
    return present


async def retrieve(tags: list[str], threshold: float = SIMILARITY_THRESHOLD, *, refresh: bool = False) -> Retrieval:
    if not tags:
        return Retrieval({}, [])
    settings = get_settings()
    key = (settings.embed_model, settings.embed_dims, tuple(sorted(set(tags))), threshold)
    cached = _retrievals.get(key)
    if not refresh and cached is not None and is_fresh(cached):
        return cached
    generation = _generation
    vectors_by_tag = {tag: _embeddings.get((settings.embed_model, settings.embed_dims, tag)) for tag in tags}
    missing = [tag for tag, vector in vectors_by_tag.items() if vector is None]
    if missing:
        embedded = await gemini.embed(missing, operation="enhance.embed")
        for tag, vector in zip(missing, embedded, strict=True):
            vectors_by_tag[tag] = vector
            _embeddings.put((settings.embed_model, settings.embed_dims, tag), vector)
    params = {
        "vectors": [_vector_literal(vectors_by_tag[tag] or []) for tag in tags],
        "neighbours": NEIGHBOURS_PER_TAG,
        "threshold": threshold,
        "limit": MAX_CANDIDATES,
        "body": BODY_PREFETCH_CHARS,
    }
    fetched_at = time.monotonic()
    async with connection() as conn:
        row = await (await conn.execute(_RETRIEVE_SQL, params)).fetchone()
    assert row is not None
    similarity = {tag: round(float(row["tag_similarity"].get(str(i + 1), 0.0)), 4) for i, tag in enumerate(tags)}
    candidates = [
        Candidate(
            id=UUID(c["id"]),
            kind=c["kind"],
            title=c["title"],
            summary=c["summary"],
            body=c["body"],
            similarity=round(float(c["similarity"]), 4),
            matched_tags=list(c["matched_tags"]),
        )
        for c in row["candidates"]
    ]
    result = Retrieval(similarity, candidates, fetched_at=fetched_at, generation=generation)
    if generation == _generation:
        _retrievals.put(key, result)
    return result


async def increment_use_count(ids: list[UUID]) -> None:
    if ids:
        async with connection() as conn:
            await conn.execute("UPDATE knowledge SET use_count = use_count + 1 WHERE id = ANY(%s)", (ids,))
