"""Paired query/document retrieval over a complete, current Tiger snapshot.

Document embeddings are prepared outside requests. This nominates candidates only:
the existing Gemini reviewer must still decide their relevance to each current draft.
"""

import asyncio
import contextlib
import hashlib
import logging
import math
import re
import time
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Literal

from app.config import get_settings
from app.llm import gemini, local_embeddings
from app.pipeline.cache import TTLCache
from app.pipeline.retrieve import RETRIEVAL_TTL_S, Candidate, Retrieval, cache_generation

if TYPE_CHECKING:
    from app.pipeline.catalog import Snapshot

log = logging.getLogger(__name__)
MAX_DOCUMENTS = 256
MAX_SOURCE_CHARS = 2_000_000
# embedding-001 accepts 2,048 tokens. The Developer API cannot disable truncation;
# use a conservative byte budget and retain every document byte through chunking.
MAX_INPUT_BYTES = 1800
MIN_CHUNK_BYTES = 1024
OVERLAP_CHARS = 128
_PARAGRAPH = re.compile(r"\n[ \t]*\n")
_SENTENCE = re.compile(r"[.!?\u3002\uff01\uff1f][\"'\u201d\u2019)\]]*(?:\s+|$)")
_SPACE = re.compile(r"\s+")
MAX_CHUNKS = 4096
BATCH_SIZE = 32
MAX_CANDIDATES = 3
QUERY_TASK = "RETRIEVAL_QUERY"
DOCUMENT_TASK = "RETRIEVAL_DOCUMENT"
type Vector = tuple[float, ...]


@dataclass(frozen=True)
class _Config:
    backend: str
    model: str
    dimensions: int
    local_identity: tuple[str, ...] = ()


type VectorKey = tuple[_Config, str, str]


@dataclass(frozen=True)
class _Entry:
    candidate: Candidate
    chunks: tuple[VectorKey, ...]


@dataclass(frozen=True)
class _Index:
    snapshot: Snapshot
    config: _Config
    fingerprint: str
    entries: tuple[_Entry, ...]
    vectors: dict[VectorKey, Vector]
    texts: dict[VectorKey, str]
    sequence: int


_index: _Index | None = None
_vectors: dict[VectorKey, Vector] = {}
_queries: TTLCache[VectorKey, Vector] = TTLCache(256, 3600)
_lock = asyncio.Lock()
_latest: Snapshot | None = None
_sequence = 0
_pending: tuple[Snapshot, int] | None = None
_worker: asyncio.Task[None] | None = None


def _config() -> _Config | None:
    settings = get_settings()
    if not settings.direct_semantic_enabled:
        return None
    if settings.semantic_embed_backend == "local":
        descriptor = local_embeddings.descriptor()
        if descriptor is None:
            return None
        return _Config(
            "local",
            descriptor.model,
            descriptor.dimensions,
            (descriptor.revision, descriptor.preprocessing, descriptor.model_dir, repr(descriptor.artifact_identity)),
        )
    return _Config("gemini", settings.embed_model, settings.embed_dims) if settings.embed_dims > 0 else None


def _fresh(snapshot: Snapshot) -> bool:
    return snapshot.generation == cache_generation() and 0 <= time.monotonic() - snapshot.fetched_at < RETRIEVAL_TTL_S


def _aligned(snapshot: Snapshot, sequence: int, config: _Config) -> bool:
    return (
        _latest is snapshot
        and sequence == _sequence
        and snapshot.generation == cache_generation()
        and _config() == config
    )


def _current(snapshot: Snapshot, sequence: int, config: _Config) -> bool:
    return _aligned(snapshot, sequence, config) and _fresh(snapshot)


def _request(snapshot: Snapshot) -> int | None:
    global _latest, _sequence, _index
    if not _fresh(snapshot):
        return None
    if _latest is snapshot:
        return _sequence
    if _latest is not None and (snapshot.generation, snapshot.fetched_at) < (_latest.generation, _latest.fetched_at):
        return None
    config = _config()
    if _index is not None and _index.config == config and _index.snapshot.generation == snapshot.generation:
        try:
            equivalent = _fingerprint(snapshot, _index.config) == _index.fingerprint
        except ValueError:
            equivalent = False
        if equivalent:
            # A fresh read of identical source data renews source age without invalidating
            # an in-flight query or forcing a request through the legacy pipeline.
            _latest = snapshot
            _index = replace(_index, snapshot=snapshot)
            return _sequence
    _latest = snapshot
    _sequence += 1
    _index = None
    return _sequence


def _chunks(text: str, max_bytes: int = MAX_INPUT_BYTES) -> tuple[str, ...]:
    """Cover the complete source with bounded, overlapping, boundary-aware excerpts.

    Single newlines are not sentence boundaries: a condition may govern the next line.
    Preceding context is retained even when an unusually long word requires a hard split.
    """
    if max_bytes < MIN_CHUNK_BYTES:
        raise ValueError("document title leaves insufficient context budget")
    offsets = [0]
    for char in text:
        offsets.append(offsets[-1] + len(char.encode("utf-8")))
    chunks: list[str] = []
    start = 0
    while start < len(text):
        hard_end = bisect_right(offsets, offsets[start] + max_bytes) - 1
        end = hard_end
        if hard_end < len(text):
            # Prefer a complete paragraph/sentence; fall back to a word boundary.
            for boundary in (_PARAGRAPH, _SENTENCE, _SPACE):
                choices = [match.end() for match in boundary.finditer(text, start, hard_end)]
                if (
                    choices
                    and choices[-1] - start > OVERLAP_CHARS
                    and offsets[choices[-1]] - offsets[start] >= max_bytes // 2
                ):
                    end = choices[-1]
                    break
        chunks.append(text[start:end])
        if end == len(text):
            break
        target = end - OVERLAP_CHARS
        earliest = max(start + 1, bisect_left(offsets, offsets[end] - max_bytes // 2))
        next_start = max(earliest, target)
        # Expand the overlap to include the preceding complete sentence/word where
        # it fits. Never move forward past the mandatory context into a negation.
        for boundary in (_PARAGRAPH, _SENTENCE, _SPACE):
            choices = [match.end() for match in boundary.finditer(text, earliest, target)]
            if choices:
                next_start = choices[-1]
                break
        start = next_start
    return tuple(chunks)


def _key(text: str, config: _Config, task: str, title: str = "") -> VectorKey:
    return config, task, hashlib.sha256(repr((title, text)).encode("utf-8")).hexdigest()


def _document_text(source: Candidate) -> str:
    return f"{source.title}\n{source.summary}\nTags: {', '.join(source.matched_tags)}\n{source.body}"


def _fingerprint(snapshot: Snapshot, config: _Config) -> str:
    if snapshot.oversized or len(snapshot.documents) > MAX_DOCUMENTS:
        raise ValueError("semantic corpus exceeds document bound")
    fingerprint = hashlib.sha256(repr(config).encode("utf-8"))
    chars = 0
    seen = set()
    for document in snapshot.documents:
        source = document.candidate
        if source.id in seen:
            raise ValueError("duplicate semantic document")
        seen.add(source.id)
        text = _document_text(source)
        chars += len(text)
        if chars > MAX_SOURCE_CHARS:
            raise ValueError("semantic corpus exceeds character bound")
        for value in (str(source.id), source.kind, text):
            encoded = value.encode("utf-8")
            fingerprint.update(len(encoded).to_bytes(8, "big"))
            fingerprint.update(encoded)
    return fingerprint.hexdigest()


def _sources(snapshot: Snapshot, config: _Config) -> tuple[tuple[_Entry, ...], dict[VectorKey, tuple[str, str]], str]:
    fingerprint = _fingerprint(snapshot, config)
    entries: list[_Entry] = []
    texts: dict[VectorKey, tuple[str, str]] = {}
    for document in snapshot.documents:
        source = document.candidate
        text = _document_text(source)
        # Prefixes count toward the same byte budget, including a long/non-ASCII title.
        prefix_bytes = len(f"title: {source.title} | text: ".encode()) if config.backend == "local" else 0
        keys = []
        for chunk in _chunks(text, MAX_INPUT_BYTES - prefix_bytes):
            key = _key(chunk, config, DOCUMENT_TASK, source.title if config.backend == "local" else "")
            keys.append(key)
            texts[key] = chunk, source.title
        if len(texts) > MAX_CHUNKS:
            raise ValueError("semantic corpus exceeds chunk bound")
        # Copy source metadata: callers must not be able to mutate the prepared index through a result.
        candidate = Candidate(source.id, source.kind, source.title, source.summary, source.body, 0.0, [])
        entries.append(_Entry(candidate, tuple(keys)))
    return tuple(entries), texts, fingerprint


def _equivalent_current(index: _Index) -> _Index | None:
    current = _index
    if (
        current is not None
        and current.sequence == index.sequence
        and current.config == index.config
        and current.fingerprint == index.fingerprint
        and current.snapshot.generation == index.snapshot.generation
        and _current(current.snapshot, current.sequence, current.config)
    ):
        return current
    return None


def _normalize(vector: list[float], dimensions: int) -> Vector:
    if len(vector) != dimensions or not all(math.isfinite(value) for value in vector):
        raise ValueError("invalid semantic embedding")
    norm = math.hypot(*vector)
    if not norm or not math.isfinite(norm):
        raise ValueError("invalid semantic embedding norm")
    return tuple(value / norm for value in vector)


async def _embed(
    texts: list[str],
    config: _Config,
    task: Literal["query", "document"],
    *,
    titles: list[str] | None = None,
) -> list[list[float]]:
    operation = "catalog.embed_documents" if task == "document" else "enhance.embed_query"
    if config.backend == "local":
        return await local_embeddings.embed(texts, task=task, titles=titles, operation=operation)
    return await gemini.embed_retrieval(
        texts,
        task_type="RETRIEVAL_DOCUMENT" if task == "document" else "RETRIEVAL_QUERY",
        model=config.model,
        dimensions=config.dimensions,
        operation=operation,
    )


async def prepare(snapshot: Snapshot) -> bool:
    """Prepare a complete index, normally at startup or in the background; never called by select."""
    sequence = _request(snapshot)
    return False if sequence is None else await _prepare(snapshot, sequence)


async def _prepare(snapshot: Snapshot, sequence: int) -> bool:
    global _index, _vectors
    async with _lock:
        config = _config()
        if config is None or not _current(snapshot, sequence, config):
            return False
        if _index is not None and _index.snapshot is snapshot and _index.config == config:
            return True
        _index = None
        try:
            try:
                entries, texts, fingerprint = _sources(snapshot, config)
            except ValueError:
                _vectors.clear()
                raise
            # Removed/changed documents and model/task changes cannot retain old cached vectors.
            _vectors = {key: vector for key, vector in _vectors.items() if key in texts}
            missing = [key for key in texts if key not in _vectors]
            # The local encoder serializes one job at a time. Small background jobs
            # allow foreground queries to interleave between changed documents.
            batch_size = 1 if config.backend == "local" else BATCH_SIZE
            for offset in range(0, len(missing), batch_size):
                keys = missing[offset : offset + batch_size]
                embedded = await _embed(
                    [texts[key][0] for key in keys],
                    config,
                    "document",
                    titles=[texts[key][1] for key in keys],
                )
                if not _aligned(snapshot, sequence, config):
                    return False
                if len(embedded) != len(keys):
                    raise ValueError("semantic embedding count mismatch")
                normalized = [_normalize(vector, config.dimensions) for vector in embedded]
                # A cold local build may outlast source TTL. Cache valid content-addressed
                # vectors so a fresh read can reuse them, but never publish an expired index.
                _vectors.update(zip(keys, normalized, strict=True))
            if not _current(snapshot, sequence, config):
                return False
            _index = _Index(
                snapshot,
                config,
                fingerprint,
                entries,
                dict(_vectors),
                {key: text for key, (text, _) in texts.items()},
                sequence,
            )
            return True
        except Exception as exc:
            log.warning("semantic index unavailable (%s)", type(exc).__name__)
            return False


async def select(prompt: str, snapshot: Snapshot) -> Retrieval | None:
    """Return up to three document candidates, or None to preserve the existing fallback."""
    index = _index
    if index is None or index.snapshot is not snapshot or not _current(snapshot, index.sequence, index.config):
        return None
    if not index.entries:
        return Retrieval({}, [], fetched_at=snapshot.fetched_at, generation=snapshot.generation)
    try:
        if not prompt.strip() or len(prompt.encode("utf-8")) > MAX_INPUT_BYTES:
            return None
        key = _key(prompt, index.config, QUERY_TASK)
        query = _queries.get(key)
        if query is None:
            embedded = await _embed([prompt], index.config, "query")
            if len(embedded) != 1:
                raise ValueError("semantic query embedding count mismatch")
            query = _normalize(embedded[0], index.config.dimensions)
            current = _equivalent_current(index)
            if current is None:
                return None
            index = current
            _queries.put(key, query)
        ranked = []
        for entry in index.entries:
            score, best_key = max(
                ((math.sumprod(query, index.vectors[key]), key) for key in entry.chunks), key=lambda item: item[0]
            )
            ranked.append((score, entry.candidate, index.texts[best_key]))
        ranked.sort(key=lambda item: (-item[0], str(item[1].id)))
        current = _equivalent_current(index)
        if current is None:
            return None
        candidates = [
            Candidate(
                c.id,
                c.kind,
                c.title,
                c.summary,
                c.body,
                round(max(-1.0, min(1.0, score)), 4),
                [],
                evidence_excerpt=text,
            )
            for score, c, text in ranked[:MAX_CANDIDATES]
        ]
        return Retrieval({}, candidates, fetched_at=current.snapshot.fetched_at, generation=current.snapshot.generation)
    except Exception as exc:
        log.warning("semantic query unavailable (%s)", type(exc).__name__)
        return None


def schedule(snapshot: Snapshot) -> None:
    """Coalesce refreshes into one worker and one latest pending snapshot."""
    global _pending, _worker
    sequence = _request(snapshot)
    if sequence is None:
        return
    _pending = snapshot, sequence
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_maintain())


async def _maintain() -> None:
    global _pending
    while _pending is not None:
        snapshot, sequence = _pending
        _pending = None
        await _prepare(snapshot, sequence)


def clear() -> None:
    """Invalidate in-flight work and remove all process-local embeddings."""
    global _index, _latest, _pending, _sequence
    _sequence += 1
    _index = _latest = _pending = None
    _vectors.clear()
    _queries.clear()


async def stop() -> None:
    global _worker
    clear()
    if _worker is not None:
        _worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _worker
        _worker = None
    await local_embeddings.stop()
