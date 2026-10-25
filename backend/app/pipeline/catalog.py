"""A bounded, versioned Tiger snapshot for complete review or candidate selection.

This only nominates candidates: Gemini still reviews every candidate against the current draft.
No-match and oversized corpora use the tag/pgvector pipeline. Lexical scores are never cosine scores.
"""

import asyncio
import contextlib
import logging
import math
import re
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass, replace
from typing import Any
from uuid import UUID

from app.config import get_settings
from app.db.pool import connection
from app.pipeline.generate import CatalogReviewTooLarge, complete_knowledge_context
from app.pipeline.retrieve import (
    MAX_CANDIDATES,
    RETRIEVAL_TTL_S,
    Candidate,
    Retrieval,
    cache_generation,
)

log = logging.getLogger(__name__)
MAX_DOCUMENTS = 256
MAX_SOURCE_CHARS = 2_000_000
REFRESH_S = 10.0
MAX_LOCAL_CANDIDATES = 3
_WORDS = re.compile(r"[^\W_]+(?:[.+][^\W_]+)*(?:\+\+|#)?", re.UNICODE)
_STOP = frozenset(
    [
        "a",
        "an",
        "the",
        "and",
        "or",
        "so",
        "that",
        "which",
        "by",
        "first",
        "such",
        "as",
        "including",
        "using",
        "with",
        "to",
        "for",
        "check",
        "add",
        "create",
        "make",
        "write",
        "use",
        "our",
        "your",
        "their",
        "this",
        "these",
        "those",
        "it",
        "its",
        "is",
        "are",
        "be",
        "been",
        "will",
        "should",
        "must",
        "can",
        "could",
        "would",
        "of",
        "in",
        "on",
        "at",
        "from",
        "into",
        "then",
        "than",
        "only",
        "all",
        "any",
        "do",
        "does",
        "not",
        "no",
        "never",
        "without",
        "when",
        "while",
        "where",
        "how",
        "what",
        "why",
        "please",
        "help",
        "want",
        "need",
    ]
)
_SQL = """
WITH bounded AS (
    SELECT k.*, sum(length(title) + length(summary) + length(body)) OVER () AS source_chars
    FROM (SELECT id, kind, title, left(summary, 2000) AS summary, body
          FROM knowledge ORDER BY id LIMIT %(limit)s) k
)
SELECT k.id, k.kind, k.title, k.summary,
       CASE WHEN k.source_chars <= %(chars)s THEN k.body ELSE '' END AS body,
       k.source_chars > %(chars)s AS source_oversized,
       coalesce(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
FROM bounded k
LEFT JOIN knowledge_tag kt ON kt.knowledge_id = k.id
LEFT JOIN tag t ON t.id = kt.tag_id
GROUP BY k.id, k.kind, k.title, k.summary, k.body, k.source_chars ORDER BY k.id
"""


def tokens(text: str) -> set[str]:
    result: set[str] = set()
    for word in _WORDS.findall(unicodedata.normalize("NFKC", text).casefold()):
        if word in _STOP or len(word) < 2:
            continue
        # One canonical term per concept avoids counting both an inflection and its stem.
        # Keep technical identifiers intact (Next.js, C++, C#).
        if not any(char in word for char in ".+#"):
            if len(word) > 4 and word.endswith("ies"):
                word = word[:-3] + "y"
            elif len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
                word = word[:-1]
            elif len(word) > 5 and word.endswith("ing"):
                word = word[:-3]
                if len(word) > 2 and word[-1] == word[-2] and word[-1] in "bdgmnprt":
                    word = word[:-1]
                # Removing -ing can remove a silent e: making/writing/creating are still stopwords.
                if word + "e" in _STOP:
                    continue
        if word not in _STOP:
            result.add(word)
    return result


@dataclass(frozen=True)
class Document:
    candidate: Candidate
    weights: dict[str, float]
    metadata_tokens: frozenset[str]


@dataclass(frozen=True)
class Snapshot:
    documents: tuple[Document, ...]
    idf: dict[str, float]
    fetched_at: float
    generation: int
    oversized: bool = False


_snapshot: Snapshot | None = None
_lock = asyncio.Lock()
_worker: asyncio.Task[None] | None = None


def current(snapshot: Snapshot) -> bool:
    return snapshot.generation == cache_generation() and 0 <= time.monotonic() - snapshot.fetched_at < RETRIEVAL_TTL_S


def build_snapshot(rows: list[dict[str, Any]], fetched_at: float, generation: int) -> Snapshot:
    chars = sum(len(str(row.get(key, ""))) for row in rows for key in ("title", "summary", "body", "tags"))
    if len(rows) > MAX_DOCUMENTS or chars > MAX_SOURCE_CHARS or any(row.get("source_oversized") for row in rows):
        return Snapshot((), {}, fetched_at, generation, oversized=True)
    documents: list[Document] = []
    frequencies: Counter[str] = Counter()
    for row in rows:
        weights: dict[str, float] = {}
        for text, weight in ((" ".join(row["tags"]), 4), (row["title"], 3), (row["summary"], 2), (row["body"], 0.5)):
            for token in tokens(text):
                weights[token] = weights.get(token, 0.0) + weight
        candidate = Candidate(
            UUID(str(row["id"])), row["kind"], row["title"], row["summary"], row["body"], 0.0, list(row["tags"])
        )
        metadata_tokens = frozenset(tokens(" ".join([*row["tags"], row["title"], row["summary"]])))
        documents.append(Document(candidate, dict(weights), metadata_tokens))
        frequencies.update(weights.keys())
    idf = {word: math.log(1 + (len(documents) - count + 0.5) / (count + 0.5)) for word, count in frequencies.items()}
    return Snapshot(tuple(documents), idf, fetched_at, generation)


def _complete_review_fits(snapshot: Snapshot) -> bool:
    if not get_settings().catalog_review_enabled or snapshot.oversized or not current(snapshot):
        return False
    try:
        complete_knowledge_context([document.candidate for document in snapshot.documents])
    except CatalogReviewTooLarge:
        return False
    return current(snapshot)


async def refresh(*, force: bool = False) -> Snapshot | None:
    global _snapshot
    async with _lock:
        if not force and _snapshot is not None and current(_snapshot):
            return _snapshot
        generation = cache_generation()
        fetched_at = time.monotonic()
        async with connection() as conn:
            rows = await (await conn.execute(_SQL, {"chars": MAX_SOURCE_CHARS, "limit": MAX_DOCUMENTS + 1})).fetchall()
        snapshot = build_snapshot(rows, fetched_at, generation)
        # A committed mutation during the read must never republish the old knowledge.
        if current(snapshot):
            _snapshot = snapshot
            return snapshot
        return None


async def get_snapshot() -> Snapshot | None:
    """Return a complete, current source snapshot; never expose an oversized partial corpus."""
    snapshot = _snapshot
    if snapshot is None or not current(snapshot):
        snapshot = await refresh()
    if snapshot is None or snapshot.oversized or not current(snapshot):
        return None
    return snapshot


async def select_complete() -> Retrieval | None:
    """Offer every source to the reviewer, independent of query-word or embedding overlap."""
    if not get_settings().catalog_review_enabled:
        return None
    snapshot = await get_snapshot()
    if snapshot is None or not _complete_review_fits(snapshot):
        return None
    candidates = [
        replace(
            document.candidate,
            similarity=0.0,
            matched_tags=list(document.candidate.matched_tags),
        )
        for document in snapshot.documents
    ]
    return Retrieval(
        {}, candidates, fetched_at=snapshot.fetched_at, generation=snapshot.generation, complete_catalog=True
    )


async def select(prompt: str) -> Retrieval | None:
    """None means tag/pgvector fallback; an empty Retrieval means the corpus itself is empty."""
    snapshot = await get_snapshot()
    if snapshot is None:
        return None
    query = tokens(prompt)
    # Nominate candidates for a partially typed final token without arbitrary substring matches.
    words = _WORDS.findall(unicodedata.normalize("NFKC", prompt).casefold())
    if words and not prompt[-1:].isspace() and words[-1] not in snapshot.idf and len(words[-1]) >= 3:
        query.update(word for word in snapshot.idf if word.startswith(words[-1]))
    ranked = []
    for document in snapshot.documents:
        # Incidental body overlap must not suppress tag retrieval of an unknown paraphrase.
        # Body terms still rank candidates supported by their title, summary or tags.
        if not document.metadata_tokens & query:
            continue
        score = sum(
            snapshot.idf[word] * weight / (weight + 1.2) for word, weight in document.weights.items() if word in query
        )
        if score > 0:
            ranked.append((score, document))
    if snapshot.documents and not ranked:
        return None
    ranked.sort(key=lambda item: (-item[0], str(item[1].candidate.id)))
    limit = min(MAX_LOCAL_CANDIDATES, MAX_CANDIDATES)
    if len(ranked) > limit:
        leading_evidence = ranked[0][1].metadata_tokens & query
        if len(leading_evidence) == 1 and all(
            document.metadata_tokens & query == leading_evidence for _, document in ranked[: limit + 1]
        ):
            # A shared platform/topic alone cannot choose which of several documents to omit.
            # Incidental body matches may rank them, but tag retrieval must resolve the ambiguity.
            return None
    candidates = []
    for _, document in ranked[:limit]:
        source = document.candidate
        candidates.append(
            Candidate(
                source.id,
                source.kind,
                source.title,
                source.summary,
                source.body,
                0.0,
                [tag for tag in source.matched_tags if tokens(tag) & query],
            )
        )
    return Retrieval({}, candidates, fetched_at=snapshot.fetched_at, generation=snapshot.generation)


async def start() -> None:
    global _worker
    await refresh()
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_maintain())


async def _maintain() -> None:
    while True:
        await asyncio.sleep(REFRESH_S)
        try:
            await refresh(force=True)
        except Exception:
            # Expired snapshots are rejected; the next request can retry the normal database read.
            log.warning("knowledge snapshot refresh failed", exc_info=False)


async def stop() -> None:
    global _worker, _snapshot
    if _worker is not None:
        _worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _worker
        _worker = None
    _snapshot = None
