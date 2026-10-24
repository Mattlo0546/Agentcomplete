"""Step 2: embed tags → pgvector nearest-neighbour over tag vectors → linked knowledge candidates."""

from dataclasses import dataclass, field
from uuid import UUID

from app.db.pool import connection
from app.llm import gemini

# Tuned on the live tag set (gemini-embedding-001, 768d, SEMANTIC_SIMILARITY): unrelated tags score 0.75-0.86,
# near-synonyms 0.88-0.98 (webhook→webhooks .977, unit-tests→unit-testing .978, retry-logic→retry .953) with a few
# lexical false friends up to ~.89 (data-structures→data-fetching), which the judge step drops.
SIMILARITY_THRESHOLD = 0.88
NEIGHBOURS_PER_TAG = 8
MAX_CANDIDATES = 5
BODY_PREFETCH_CHARS = 8000

# One round trip: nearest stored tags per query vector → best similarity per query tag, and the top
# knowledge items linked to tags above the threshold (ranked by their best tag similarity).
_RETRIEVE_SQL = """
WITH hits AS (
    SELECT q.i::int AS i, t.id AS tag_id, t.name, t.similarity
    FROM unnest(%(vectors)s::text[]) WITH ORDINALITY AS q(v, i)
    CROSS JOIN LATERAL (
        SELECT id, name, 1 - (embedding <=> q.v::vector) AS similarity
        FROM tag ORDER BY embedding <=> q.v::vector LIMIT %(neighbours)s
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


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{x:.7g}" for x in vector) + "]"


async def has_tags() -> bool:
    async with connection() as conn:
        row = await (await conn.execute("SELECT EXISTS (SELECT 1 FROM tag) AS present")).fetchone()
    return bool(row and row["present"])


async def retrieve(tags: list[str], threshold: float = SIMILARITY_THRESHOLD) -> Retrieval:
    if not tags:
        return Retrieval({}, [])
    vectors = await gemini.embed(tags, operation="enhance.embed")
    params = {
        "vectors": [_vector_literal(v) for v in vectors],
        "neighbours": NEIGHBOURS_PER_TAG,
        "threshold": threshold,
        "limit": MAX_CANDIDATES,
        "body": BODY_PREFETCH_CHARS,
    }
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
    return Retrieval(similarity, candidates)


async def increment_use_count(ids: list[UUID]) -> None:
    if ids:
        async with connection() as conn:
            await conn.execute("UPDATE knowledge SET use_count = use_count + 1 WHERE id = ANY(%s)", (ids,))
