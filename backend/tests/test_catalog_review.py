"""Complete catalog nomination and rendering without database or model calls."""

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from app.pipeline import catalog, generate, retrieve
from app.settings_store import AppSettings


@pytest.fixture(scope="session", autouse=True)
async def database() -> AsyncIterator[None]:
    yield


@pytest.fixture(autouse=True)
def memory(monkeypatch):
    settings = SimpleNamespace(catalog_review_enabled=True)
    monkeypatch.setattr(catalog, "get_settings", lambda: settings)
    monkeypatch.setattr(catalog, "_snapshot", None)
    monkeypatch.setattr(catalog, "_lock", asyncio.Lock())
    monkeypatch.setattr(catalog, "_worker", None)
    monkeypatch.setattr(retrieve, "_generation", 0)
    return settings


def row(number, body="Source guidance", *, title=None, summary="Summary"):
    return {
        "id": UUID(int=number),
        "kind": "skill",
        "title": title or f"Reference {number}",
        "summary": summary,
        "body": body,
        "tags": ["unrelated-term"],
    }


def install(rows):
    snapshot = catalog.build_snapshot(rows, time.monotonic(), retrieve.cache_generation())
    catalog._snapshot = snapshot
    return snapshot


def contents(candidates):
    return generate.build_contents("Current task", 12, AppSettings(), None, candidates, full_bodies=True)


async def test_no_overlap_does_not_hide_any_candidate_and_results_are_isolated():
    snapshot = install([row(number) for number in range(1, 10)])
    assert await catalog.select("A completely different request") is None
    result = await catalog.select_complete()
    assert result is not None and result.complete_catalog
    assert [candidate.id for candidate in result.candidates] == [doc.candidate.id for doc in snapshot.documents]
    assert result.tag_similarity == {} and all(candidate.similarity == 0 for candidate in result.candidates)
    assert result.fetched_at == snapshot.fetched_at and result.generation == snapshot.generation
    result.candidates[0].body = "Caller modification"
    result.candidates[0].matched_tags.append("caller-tag")
    again = await catalog.select_complete()
    assert again.candidates[0].body == "Source guidance"
    assert again.candidates[0].matched_tags == ["unrelated-term"]
    assert not retrieve.Retrieval({}, []).complete_catalog


async def test_complete_bodies_preserve_late_constraints_unicode_and_every_candidate():
    rows = [
        row(number, (f"Reference {number} text. " * 90) + f"\nNever assume requirement {number}. 日本語 😀")
        for number in range(1, 10)
    ]
    install(rows)
    result = await catalog.select_complete()
    assert result is not None
    rendered = contents(result.candidates)
    assert len(rendered) > generate.KNOWLEDGE_BUDGET_CHARS
    for number, source in enumerate(rows):
        assert source["body"] in rendered
        assert f'<knowledge candidate="{number}"' in rendered
    assert rendered.count("</knowledge>") == len(rows)


@pytest.mark.parametrize("character", ["x", "😀"])
async def test_exact_serialized_character_bound_accepts_then_rejects_without_truncating(character):
    snapshot = install([row(1, "")])
    source = snapshot.documents[0].candidate
    overhead = len(generate.complete_knowledge_context([source]))
    source.body = character * (generate.COMPLETE_CATALOG_MAX_CHARS - overhead)
    assert len(generate.complete_knowledge_context([source])) == generate.COMPLETE_CATALOG_MAX_CHARS
    result = await catalog.select_complete()
    assert result is not None and source.body in contents(result.candidates)
    source.body += character
    assert await catalog.select_complete() is None
    with pytest.raises(generate.CatalogReviewTooLarge, match="serialized"):
        contents([source])


async def test_document_count_bound_keeps_all_or_falls_back():
    install([row(number) for number in range(1, 17)])
    result = await catalog.select_complete()
    assert result is not None and len(result.candidates) == 16
    oversized = install([row(number) for number in range(1, 18)])
    assert await catalog.select_complete() is None
    with pytest.raises(generate.CatalogReviewTooLarge, match="document"):
        contents([doc.candidate for doc in oversized.documents])


async def test_metadata_and_wrapper_overhead_count_towards_bound():
    install([row(1, "", title="Title" * 100, summary="s" * generate.COMPLETE_CATALOG_MAX_CHARS)])
    assert await catalog.select_complete() is None


@pytest.mark.parametrize("condition", ["expired", "future", "mutation", "oversized", "missing"])
async def test_invalid_snapshot_is_never_promoted_to_complete(monkeypatch, condition):
    source = install([row(1)])
    if condition == "expired":
        source = replace(source, fetched_at=time.monotonic() - retrieve.RETRIEVAL_TTL_S - 1)
    elif condition == "future":
        source = replace(source, fetched_at=time.monotonic() + 10)
    elif condition == "mutation":
        retrieve.invalidate_cache()
    elif condition == "oversized":
        source = replace(source, oversized=True)
    else:
        source = None
    monkeypatch.setattr(catalog, "get_snapshot", AsyncMock(return_value=source))
    assert await catalog.select_complete() is None


async def test_disabled_mode_never_reads_snapshot(monkeypatch, memory):
    memory.catalog_review_enabled = False
    read = AsyncMock()
    monkeypatch.setattr(catalog, "get_snapshot", read)
    assert await catalog.select_complete() is None
    read.assert_not_awaited()


async def test_empty_catalog_is_complete_without_fabricated_candidates():
    install([])
    result = await catalog.select_complete()
    assert result is not None and result.complete_catalog and not result.candidates
    assert "none: do a general enhancement" in contents(result.candidates)


@pytest.mark.parametrize("count", [16, 17])
async def test_refresh_preserves_all_sources_across_complete_review_bound(monkeypatch, count):
    rows = [row(number) for number in range(1, count + 1)]

    class Connection:
        async def execute(self, *args, **kwargs):
            return SimpleNamespace(fetchall=AsyncMock(return_value=rows))

    @asynccontextmanager
    async def connection():
        yield Connection()

    monkeypatch.setattr(catalog, "connection", connection)
    snapshot = await catalog.refresh()
    assert snapshot is not None and len(snapshot.documents) == count
    assert catalog._snapshot is snapshot
    assert (await catalog.select_complete() is not None) == (count <= 16)


async def test_startup_and_shutdown_manage_snapshot_refresh(monkeypatch):
    source = install([row(number) for number in range(1, 18)])
    refresh = AsyncMock(return_value=source)
    monkeypatch.setattr(catalog, "refresh", refresh)
    try:
        await catalog.start()
        worker = catalog._worker
        assert worker is not None and not worker.done()
        await catalog.start()
        assert catalog._worker is worker
    finally:
        await catalog.stop()
    assert refresh.await_count == 2
    assert worker.done()
    assert catalog._worker is None and catalog._snapshot is None
