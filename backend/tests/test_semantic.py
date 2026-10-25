"""Semantic nomination remains complete, current, bounded, and separate from legacy tag vectors."""

import asyncio
import math
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from app.errors import UpstreamError
from app.llm import gemini
from app.pipeline import catalog, retrieve, semantic
from app.pipeline.cache import TTLCache
from app.pipeline.generate import build_contents
from app.schemas.enhance import utf16_len
from app.settings_store import AppSettings


@pytest.fixture(scope="session", autouse=True)
def database():
    """No database, model files, or external requests are used by these tests."""


@pytest.fixture(autouse=True)
async def state(monkeypatch):
    settings = SimpleNamespace(
        direct_semantic_enabled=True,
        semantic_embed_backend="gemini",
        embed_model="test-embedding",
        embed_dims=2,
        llm_timeout_s=1,
    )
    now = [100.0]
    monkeypatch.setattr(semantic, "get_settings", lambda: settings)
    monkeypatch.setattr(semantic, "time", SimpleNamespace(monotonic=lambda: now[0]))
    monkeypatch.setattr(semantic, "_lock", asyncio.Lock())
    monkeypatch.setattr(semantic, "_queries", TTLCache(256, 3600))
    monkeypatch.setattr(retrieve, "_generation", 0)
    semantic.clear()
    calls = []

    async def embed(texts, config, task, *, titles=None):
        calls.append((list(texts), config, task, titles))
        if task == "query":
            return [[8.0, 0.0] for _ in texts]
        return [
            [8.0, 0.0]
            if text.startswith("Alpha") or "needle" in text
            else [1.0, 1.0]
            if text.startswith("Delta")
            else [-5.0, 0.0]
            if text.startswith("Gamma")
            else [0.0, 3.0]
            for text in texts
        ]

    monkeypatch.setattr(semantic, "_embed", embed)
    yield SimpleNamespace(settings=settings, now=now, calls=calls, embed=embed)
    await semantic.stop()


def row(number, title, body="Guidance", tags=None):
    return {
        "id": UUID(int=number),
        "kind": "skill",
        "title": title,
        "summary": "Summary",
        "body": body,
        "tags": tags or ["stored-tag"],
    }


def snapshot(rows, fetched_at=100.0):
    return catalog.build_snapshot(rows, fetched_at, retrieve.cache_generation())


async def test_unready_never_builds_document_vectors_on_request(state):
    source = snapshot([row(1, "Alpha")])
    assert await semantic.select("current full draft", source) is None
    assert not state.calls


async def test_full_current_query_ranks_normalized_documents_without_fake_tag_scores(state):
    source = snapshot([row(i, title) for i, title in enumerate(("Alpha", "Beta", "Gamma", "Delta"), 1)])
    assert await semantic.prepare(source)
    prompt = "Use the WHOLE current draft, including the changed middle and ending"
    result = await semantic.select(prompt, source)
    assert result is not None
    assert [c.title for c in result.candidates] == ["Alpha", "Delta", "Beta"]
    assert [c.similarity for c in result.candidates] == [1.0, 0.7071, 0.0]
    assert result.tag_similarity == {} and all(c.matched_tags == [] for c in result.candidates)
    assert (result.fetched_at, result.generation) == (source.fetched_at, source.generation)
    assert [call[2] for call in state.calls] == ["document", "query"]
    assert state.calls[-1][0] == [prompt]
    assert all(key[1] == semantic.DOCUMENT_TASK and len(key[2]) == 64 for key in semantic._vectors)


async def test_refresh_reuses_unchanged_vectors_and_prunes_updated_deleted_documents(state):
    rows = [row(1, "Alpha"), row(2, "Beta"), row(3, "Gamma")]
    first = snapshot(rows)
    assert await semantic.prepare(first)
    initial_keys = set(semantic._vectors)
    refreshed = snapshot(rows, 101)
    state.now[0] = 101
    assert await semantic.prepare(refreshed)
    assert len(state.calls) == 1
    old_fingerprint = semantic._index.fingerprint
    changed = snapshot([rows[0], row(2, "Beta", body="Changed guidance")], 102)
    state.now[0] = 102
    assert await semantic.prepare(changed)
    assert len(state.calls) == 2 and len(state.calls[-1][0]) == 1
    assert "Changed guidance" in state.calls[-1][0][0]
    assert len(initial_keys & semantic._vectors.keys()) == 1
    assert len(semantic._vectors) == 2
    assert semantic._index.fingerprint != old_fingerprint
    assert await semantic.select("draft", first) is None
    result = await semantic.select("draft", changed)
    assert result is not None and {c.id for c in result.candidates} == {UUID(int=1), UUID(int=2)}


@pytest.mark.parametrize("condition", ["expired", "future", "mutation", "disabled", "model", "dimensions"])
async def test_stale_or_changed_configuration_rejected_before_query(state, condition):
    source = snapshot([row(1, "Alpha")])
    assert await semantic.prepare(source)
    if condition == "expired":
        state.now[0] += retrieve.RETRIEVAL_TTL_S
    elif condition == "future":
        state.now[0] = 99
    elif condition == "mutation":
        retrieve.invalidate_cache()
    elif condition == "disabled":
        state.settings.direct_semantic_enabled = False
    elif condition == "model":
        state.settings.embed_model = "different-model"
    else:
        state.settings.embed_dims = 3
    assert await semantic.select("draft", source) is None
    assert len(state.calls) == 1


@pytest.mark.parametrize("condition", ["expired", "mutation", "replacement", "model", "clear"])
async def test_inflight_query_cannot_return_stale_source(state, monkeypatch, condition):
    source = snapshot([row(1, "Alpha")])
    assert await semantic.prepare(source)
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked(*args, **kwargs):
        entered.set()
        await release.wait()
        return [[1.0, 0.0]]

    monkeypatch.setattr(semantic, "_embed", blocked)
    pending = asyncio.create_task(semantic.select("draft", source))
    await entered.wait()
    if condition == "expired":
        state.now[0] += 16
    elif condition == "mutation":
        retrieve.invalidate_cache()
    elif condition == "replacement":
        state.now[0] = 101
        await semantic.prepare(snapshot([], 101))
    elif condition == "model":
        state.settings.embed_model = "different-model"
    else:
        semantic.clear()
    release.set()
    assert await pending is None
    assert not semantic._queries._items


async def test_expired_build_caches_complete_vectors_but_requires_fresh_snapshot(state, monkeypatch):
    rows = [row(1, "Alpha"), row(2, "Beta")]
    source = snapshot(rows)

    async def slow(texts, config, task, **kwargs):
        result = await state.embed(texts, config, task, **kwargs)
        state.now[0] = 125
        return result

    monkeypatch.setattr(semantic, "_embed", slow)
    assert not await semantic.prepare(source)
    assert semantic._index is None and len(semantic._vectors) == 2
    assert await semantic.select("draft", source) is None
    fresh = snapshot(rows, 125)
    assert await semantic.prepare(fresh)
    assert len(state.calls) == 1
    assert semantic._index.snapshot is fresh


async def test_mutation_during_preparation_never_publishes_or_caches_old_vectors(state, monkeypatch):
    async def mutate(*args, **kwargs):
        retrieve.invalidate_cache()
        return [[1.0, 0.0]]

    monkeypatch.setattr(semantic, "_embed", mutate)
    assert not await semantic.prepare(snapshot([row(1, "Alpha")]))
    assert semantic._index is None and not semantic._vectors


@pytest.mark.parametrize("vectors", [[], [[1.0]], [[float("nan"), 0.0]], [[0.0, 0.0]], [[math.inf, 1.0]]])
async def test_invalid_document_vectors_never_publish_partial_index(state, monkeypatch, vectors):
    monkeypatch.setattr(semantic, "_embed", AsyncMock(return_value=vectors))
    source = snapshot([row(1, "Alpha")])
    assert not await semantic.prepare(source)
    assert semantic._index is None and await semantic.select("draft", source) is None


async def test_failed_later_batch_preserves_fallback_and_retries_only_missing_chunks(state, monkeypatch, caplog):
    monkeypatch.setattr(semantic, "BATCH_SIZE", 1)
    source = snapshot([row(1, "Alpha"), row(2, "Beta")])
    calls = 0

    async def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("private user body must not be logged")
        return await state.embed(*args, **kwargs)

    monkeypatch.setattr(semantic, "_embed", fail_second)
    assert not await semantic.prepare(source)
    assert semantic._index is None and len(semantic._vectors) == 1
    assert await semantic.select("draft", source) is None
    assert "private user body" not in caplog.text
    assert await semantic.prepare(source)
    assert calls == 3 and len(semantic._vectors) == 2


async def test_query_failure_is_not_cached_and_cancellation_propagates(state, monkeypatch, caplog):
    source = snapshot([row(1, "Alpha")])
    assert await semantic.prepare(source)
    monkeypatch.setattr(semantic, "_embed", AsyncMock(side_effect=RuntimeError("private draft")))
    assert await semantic.select("draft", source) is None
    assert not semantic._queries._items and "private draft" not in caplog.text
    monkeypatch.setattr(semantic, "_embed", AsyncMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        await semantic.select("draft", source)


async def test_query_cache_is_bounded_content_addressed_and_not_an_output_cache(state, monkeypatch):
    monkeypatch.setattr(semantic, "_queries", TTLCache(2, 3600))
    source = snapshot([row(1, "Alpha")])
    assert await semantic.prepare(source)
    first = await semantic.select("current one", source)
    first.candidates[0].body = "Caller mutation"
    first.candidates[0].matched_tags.append("fake")
    second = await semantic.select("current one", source)
    assert second.candidates[0].body == "Guidance" and second.candidates[0].matched_tags == []
    assert len(state.calls) == 2
    await semantic.select("current two", source)
    await semantic.select("current three", source)
    await semantic.select("current one", source)
    assert len(state.calls) == 5 and len(semantic._queries._items) == 2
    assert all(key[1] == semantic.QUERY_TASK and len(key[2]) == 64 for key in semantic._queries._items)


async def test_empty_and_oversized_corpora_never_embed(state, monkeypatch):
    empty = snapshot([])
    assert await semantic.prepare(empty)
    result = await semantic.select("draft", empty)
    assert result is not None and not result.candidates
    large = replace(empty, fetched_at=101, oversized=True)
    state.now[0] = 101
    assert not await semantic.prepare(large)
    assert await semantic.select("draft", large) is None
    assert not state.calls
    monkeypatch.setattr(semantic, "MAX_DOCUMENTS", 1)
    state.now[0] = 102
    assert not await semantic.prepare(snapshot([row(1, "Alpha"), row(2, "Beta")], 102))


async def test_source_and_chunk_bounds_fail_closed(state, monkeypatch):
    source = snapshot([row(1, "Alpha", "x" * 2000)])
    monkeypatch.setattr(semantic, "MAX_SOURCE_CHARS", 100)
    assert not await semantic.prepare(source)
    monkeypatch.setattr(semantic, "MAX_SOURCE_CHARS", 2_000_000)
    monkeypatch.setattr(semantic, "MAX_CHUNKS", 1)
    assert not await semantic.prepare(source)
    assert not state.calls


async def test_multilingual_chunks_preserve_entire_body_and_tail_can_rank(state):
    body = "".join(f"日本語😀 {number}. " for number in range(300)) + " needle at the end"
    chunks = semantic._chunks(body)
    previous_start, previous_end = -1, 0
    for chunk in chunks:
        start = body.index(chunk, previous_start + 1)
        assert start <= previous_end
        if previous_start >= 0:
            assert previous_end - start >= semantic.OVERLAP_CHARS
        previous_start, previous_end = start, start + len(chunk)
    assert previous_end == len(body)
    assert all(len(chunk.encode("utf-8")) <= semantic.MAX_INPUT_BYTES for chunk in chunks)
    source = snapshot([row(1, "Long document", body), row(2, "Beta")])
    assert await semantic.prepare(source)
    embedded_text = "".join(state.calls[0][0][:-1])
    assert "needle at the end" in embedded_text
    result = await semantic.select("find the needle", source)
    assert result.candidates[0].id == UUID(int=1) and result.candidates[0].body == body
    assert "needle at the end" in result.candidates[0].evidence_excerpt
    prompt = "find the needle"
    contents = build_contents(prompt, utf16_len(prompt), AppSettings.model_validate({}), None, result.candidates)
    assert "needle at the end" in contents
    assert source.documents[0].candidate.body == body
    assert source.documents[0].candidate.evidence_excerpt is None


@pytest.mark.parametrize(
    "prefix,sentence,phrase,context",
    [
        ("x" * 1794, "Never disable authorization checks.", "disable authorization", "Never"),
        (
            "x" * 1740 + " ",
            "Only if this is an isolated test fixture:\ndisable authorization checks.",
            "disable authorization",
            "Only if",
        ),
        (
            "Prior sentence. " * 115,
            "Unless requests are authenticated,\nnever trust the account identifier.",
            "trust the account",
            "Unless",
        ),
    ],
)
async def test_chunk_boundaries_preserve_negation_and_conditions_for_reviewer(
    state, monkeypatch, prefix, sentence, phrase, context
):
    body = prefix + sentence
    excerpts = semantic._chunks(body)
    assert any(sentence in excerpt for excerpt in excerpts)
    assert all(context in excerpt for excerpt in excerpts if phrase in excerpt)
    source = snapshot([row(1, "Security", body)])

    async def relevant_tail(texts, config, task, **kwargs):
        return [[1.0, 0.0] if task == "query" or phrase in text else [0.0, 1.0] for text in texts]

    monkeypatch.setattr(semantic, "_embed", relevant_tail)
    assert await semantic.prepare(source)
    result = await semantic.select("Review authorization safeguards", source)
    assert result is not None and context in result.candidates[0].evidence_excerpt
    assert phrase in result.candidates[0].evidence_excerpt
    contents = build_contents("draft", 5, AppSettings.model_validate({}), None, result.candidates)
    assert sentence in contents
    assert source.documents[0].candidate.body == body


def test_local_title_prefix_and_overlap_share_the_input_budget(state):
    config = semantic._Config("local", "local-test", 2)
    source = snapshot([row(1, "日本語の権限ガイド", "条件付きの説明。 " * 300)])
    _, texts, _ = semantic._sources(source, config)
    assert len(texts) > 1
    assert all(
        len(f"title: {title} | text: {chunk}".encode()) <= semantic.MAX_INPUT_BYTES for chunk, title in texts.values()
    )
    too_long = snapshot([row(2, "長" * 600)])
    with pytest.raises(ValueError, match="context budget"):
        semantic._sources(too_long, config)


@pytest.mark.parametrize("after_expiry", [False, True])
async def test_equivalent_refresh_rebinds_pending_query_to_verified_fresh_source(state, monkeypatch, after_expiry):
    rows = [row(1, "Alpha"), row(2, "Beta")]
    source = snapshot(rows)
    assert await semantic.prepare(source)
    sequence = semantic._sequence
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked_query(texts, config, task, **kwargs):
        if task == "query":
            entered.set()
            await release.wait()
        return await state.embed(texts, config, task, **kwargs)

    monkeypatch.setattr(semantic, "_embed", blocked_query)
    pending = asyncio.create_task(semantic.select("current draft", source))
    await entered.wait()
    state.now[0] = 125 if after_expiry else 110
    refreshed = snapshot(rows, state.now[0])
    # schedule() must preserve the ready index immediately, before its worker runs.
    semantic.schedule(refreshed)
    assert semantic._index.snapshot is refreshed and semantic._sequence == sequence
    release.set()
    result = await pending
    assert result is not None and result.fetched_at == refreshed.fetched_at
    assert result.generation == refreshed.generation
    assert await semantic.prepare(refreshed)
    assert len([call for call in state.calls if call[2] == "document"]) == 1


async def test_changed_source_refresh_still_discards_pending_query(state, monkeypatch):
    source = snapshot([row(1, "Alpha")])
    assert await semantic.prepare(source)
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked_query(texts, config, task, **kwargs):
        if task == "query":
            entered.set()
            await release.wait()
        return await state.embed(texts, config, task, **kwargs)

    monkeypatch.setattr(semantic, "_embed", blocked_query)
    pending = asyncio.create_task(semantic.select("current draft", source))
    await entered.wait()
    state.now[0] = 110
    changed = snapshot([row(1, "Alpha", body="New contradictory guidance")], 110)
    assert await semantic.prepare(changed)
    release.set()
    assert await pending is None
    assert not semantic._queries._items


@pytest.mark.parametrize("prompt", ["x" * 1801, "😀" * 451, " ", "x\ud800"])
async def test_query_limit_falls_back_without_slicing_or_embedding(state, prompt):
    source = snapshot([row(1, "Alpha")])
    assert await semantic.prepare(source)
    assert await semantic.select(prompt, source) is None
    assert len(state.calls) == 1


async def test_duplicate_concurrent_prepares_share_one_build(state):
    source = snapshot([row(1, "Alpha")])
    assert all(await asyncio.gather(*(semantic.prepare(source) for _ in range(8))))
    assert len(state.calls) == 1


async def test_schedule_coalesces_latest_snapshot_and_stop_awaits_cancellation(state, monkeypatch):
    entered, release, cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def blocked(texts, config, task, **kwargs):
        entered.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return await state.embed(texts, config, task, **kwargs)

    monkeypatch.setattr(semantic, "_embed", blocked)
    original = snapshot([row(1, "Alpha")])
    semantic.schedule(original)
    worker = semantic._worker
    await entered.wait()
    for n in range(2, 8):
        latest = snapshot([row(n, f"Document {n}")], 100 + n / 10)
        state.now[0] = latest.fetched_at
        semantic.schedule(latest)
        assert semantic._worker is worker
    state.now[0] = latest.fetched_at
    release.set()
    await worker
    assert semantic._index.snapshot is latest
    assert len(state.calls) == 2  # Initial in-flight and latest; intermediate snapshots are skipped.
    release.clear()
    entered.clear()
    state.now[0] = 101
    semantic.schedule(snapshot([row(9, "New")], 101))
    await entered.wait()
    await semantic.stop()
    assert cancelled.is_set() and semantic._worker is None and semantic._pending is None
    assert semantic._index is None and not semantic._vectors


async def test_local_descriptor_identity_and_missing_runtime_are_isolated(state, monkeypatch):
    descriptor = SimpleNamespace(
        model="google-local",
        dimensions=2,
        revision="one",
        preprocessing="search-v1",
        model_dir="/test/model",
        artifact_identity=(),
    )
    monkeypatch.setattr(semantic.local_embeddings, "descriptor", lambda: descriptor)
    state.settings.semantic_embed_backend = "local"
    source = snapshot([row(1, "Alpha")])
    assert await semantic.prepare(source)
    first_keys = set(semantic._vectors)
    assert await semantic.select("draft", source) is not None
    descriptor.revision = "two"
    assert await semantic.select("draft", source) is None
    assert await semantic.prepare(source)
    assert not first_keys & semantic._vectors.keys()
    assert await semantic.select("draft", source) is not None
    assert len([c for c in state.calls if c[2] == "query"]) == 2
    monkeypatch.setattr(semantic.local_embeddings, "descriptor", lambda: None)
    assert await semantic.select("draft", source) is None
    assert not await semantic.prepare(source)


async def test_dispatch_uses_local_pair_or_explicit_remote_pair(state, monkeypatch):
    # Exercise dispatch separately from the fake embedding fixture.
    from importlib import import_module

    module = import_module("app.pipeline.semantic")
    dispatch = _REAL_EMBED
    local = AsyncMock(return_value=[[1.0, 0.0]])
    remote = AsyncMock(return_value=[[1.0, 0.0]])
    monkeypatch.setattr(module.local_embeddings, "embed", local)
    monkeypatch.setattr(module.gemini, "embed_retrieval", remote)
    config = semantic._Config("local", "google-local", 2, ("revision", "prefix", "path"))
    await dispatch(["doc"], config, "document", titles=["Title"])
    local.assert_awaited_once_with(["doc"], task="document", titles=["Title"], operation="catalog.embed_documents")
    remote.assert_not_awaited()
    config = semantic._Config("gemini", "test-remote", 2)
    await dispatch(["query"], config, "query")
    remote.assert_awaited_once_with(
        ["query"], task_type="RETRIEVAL_QUERY", model="test-remote", dimensions=2, operation="enhance.embed_query"
    )


_REAL_EMBED = semantic._embed


async def test_remote_helper_freezes_model_dimensions_task_and_sanitizes_failure(state, monkeypatch):
    embed = AsyncMock(return_value=SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0, 2.0])]))
    monkeypatch.setattr(
        gemini, "_client", lambda: SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(embed_content=embed)))
    )
    monkeypatch.setattr(gemini, "get_settings", lambda: state.settings)
    record = AsyncMock()
    monkeypatch.setattr(gemini, "record_ai_call", record)
    result = await gemini.embed_retrieval(
        ["synthetic"], task_type="RETRIEVAL_DOCUMENT", model="frozen-model", dimensions=2, operation="test.embed"
    )
    assert result == [[1.0, 2.0]]
    kwargs = embed.await_args.kwargs
    assert kwargs["model"] == "frozen-model"
    assert kwargs["config"].task_type == "RETRIEVAL_DOCUMENT" and kwargs["config"].output_dimensionality == 2
    assert kwargs["config"].auto_truncate is None
    embed.side_effect = RuntimeError("private request text")
    with pytest.raises(UpstreamError):
        await gemini.embed_retrieval(
            ["synthetic"], task_type="RETRIEVAL_QUERY", model="frozen-model", dimensions=2, operation="test.embed"
        )
    assert record.await_args.args[-1] == "RuntimeError"
