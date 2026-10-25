"""Fast-path quality boundaries, source freshness and one-call orchestration."""

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.pipeline import catalog, complete, retrieve, run
from app.pipeline.complete import ReviewedCompletion, validate_decisions
from app.pipeline.generate import Generation
from app.pipeline.judge import Judged
from app.pipeline.tags import TagExtraction
from app.pipeline.validate import InvalidOutput
from app.schemas.enhance import EnhanceRequest, utf16_len
from app.settings_store import AppSettings


@pytest.fixture(scope="session", autouse=True)
async def database() -> AsyncIterator[None]:
    yield


@pytest.fixture(autouse=True)
def memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(catalog, "_snapshot", None)
    monkeypatch.setattr(catalog, "_lock", asyncio.Lock())
    monkeypatch.setattr(run.get_settings(), "fast_autocomplete_enabled", True)
    retrieve.invalidate_cache()


def row(title: str, tags: list[str], body: str = "") -> dict[str, Any]:
    return {"id": uuid4(), "kind": "skill", "title": title, "tags": tags, "summary": title, "body": body}


def install(rows: list[dict[str, Any]]) -> catalog.Snapshot:
    snapshot = catalog.build_snapshot(rows, time.monotonic(), retrieve.cache_generation())
    catalog._snapshot = snapshot
    return snapshot


def request(prompt: str = "Add retry backoff and") -> EnhanceRequest:
    return EnhanceRequest(request_id="fast-test", prompt=prompt, prompt_revision=1, cursor=utf16_len(prompt))


@pytest.fixture
def corpus() -> list[dict[str, Any]]:
    return [
        row("HTTP retries with exponential backoff", ["retry", "python", "http-client"], "Use jitter and idempotency."),
        row("Vitest login form tests", ["vitest", "react", "unit-testing"], "Test validation and submission."),
        row(
            "Zero-downtime PostgreSQL migrations", ["postgresql", "migration"], "Add a nullable column before NOT NULL."
        ),
        row("Stripe webhook idempotency", ["stripe", "webhook", "idempotency"], "Deduplicate repeated events."),
        row("Atomic FastAPI PostgreSQL operations", ["fastapi", "postgresql", "transaction"], "Use one transaction."),
        row("Brand newsletter copy", ["newsletter", "marketing"], "Choose a subject line and call to action."),
    ]


@pytest.mark.parametrize(
    ("prompt", "expected"),
    [
        ("Add retries to the payment client using exponential backoff and", 0),
        ("Write Vitest tests for the login form that check", 1),
        ("Create a zero-downtime migration that adds a NOT NULL column by first", 2),
        ("Deduplicate Stripe webhook events", 3),
        ("Make FastAPI PostgreSQL updates atomic", 4),
        ("Add retr", 0),
    ],
)
async def test_nomination_recall_and_irrelevant_distractors(corpus, prompt, expected):
    install(corpus)
    result = await catalog.select(prompt)
    assert result is not None
    ids = [candidate.id for candidate in result.candidates]
    assert corpus[expected]["id"] in ids
    assert corpus[-1]["id"] not in ids
    assert result.tag_similarity == {}  # lexical weights must never masquerade as cosine similarity


async def test_unknown_paraphrase_falls_back_instead_of_claiming_no_knowledge(corpus):
    install(corpus)
    assert await catalog.select("Recover gracefully after transient upstream failures") is None
    install([])
    empty = await catalog.select("Unknown concept")
    assert empty is not None and not empty.candidates


async def test_incidental_body_match_preserves_semantic_fallback():
    install(
        [
            row("HTTP retries with exponential backoff", ["retry", "http-client"], "Use jitter and idempotency."),
            row("Brand newsletter copy", ["newsletter", "marketing"], "A sample marketing draft."),
        ]
    )
    prompt = "Recover gracefully after transient upstream failures"
    assert await catalog.select(prompt) is None
    assert await catalog.select(f"{prompt} in this draft") is None


async def test_body_terms_rank_metadata_supported_candidates():
    generic = row("HTTP retry guide", ["retry"], "Use jitter.")
    specific = row("HTTP retry guide", ["retry"], "Preserve idempotency.")
    distractor = row("Brand newsletter copy", ["newsletter"], "Discuss retry idempotency.")
    install([generic, specific, distractor])
    result = await catalog.select("Add retry idempotency and")
    assert result is not None
    assert [candidate.id for candidate in result.candidates] == [specific["id"], generic["id"]]


async def test_current_full_prompt_replaces_previous_topic(corpus):
    install(corpus)
    react = await catalog.select("React login form")
    fastapi = await catalog.select("FastAPI PostgreSQL")
    assert react is not None and fastapi is not None
    assert react.candidates[0].id == corpus[1]["id"]
    assert fastapi.candidates[0].id == corpus[4]["id"]
    assert corpus[1]["id"] not in {candidate.id for candidate in fastapi.candidates}
    # No head/tail truncation in the ranker: a changed middle participates.
    middle = await catalog.select("x " * 4000 + "FastAPI PostgreSQL " + "z " * 2000)
    assert middle is not None and middle.candidates[0].id == corpus[4]["id"]


def test_token_boundaries_unicode_and_inflections():
    assert {"c++", "c#", "next.js", "日本語"} <= catalog.tokens("C++ C# Next.js 日本語")
    assert "react" not in catalog.tokens("reactive reactor")
    assert "retry" in catalog.tokens("retries")
    assert "test" in catalog.tokens("testing tests")
    assert catalog.tokens("retry " * 100) == catalog.tokens("retry")


def fake_database(monkeypatch, rows, during_read=None):
    calls = []

    class Conn:
        async def execute(self, sql, params):
            calls.append(sql)
            await asyncio.sleep(0)
            return self

        async def fetchall(self):
            if during_read:
                during_read()
            return rows

    @asynccontextmanager
    async def connection():
        yield Conn()

    monkeypatch.setattr(catalog, "connection", connection)
    return calls


async def test_concurrent_cold_load_is_one_read(monkeypatch, corpus):
    calls = fake_database(monkeypatch, corpus)
    results = await asyncio.gather(*(catalog.select("retry") for _ in range(8)))
    assert len(calls) == 1 and all(result and result.candidates for result in results)


async def test_mutation_expiry_and_inflight_refresh_never_republish_old_source(monkeypatch, corpus):
    initial = install(corpus)
    retrieve.invalidate_cache()
    assert not catalog.current(initial)
    calls = fake_database(monkeypatch, [])
    assert not (await catalog.select("retry")).candidates
    assert len(calls) == 1
    catalog._snapshot = catalog.build_snapshot(corpus, time.monotonic() - 16, retrieve.cache_generation())
    assert not (await catalog.select("retry")).candidates
    assert len(calls) == 2
    retrieve.invalidate_cache()
    fake_database(monkeypatch, corpus, retrieve.invalidate_cache)
    assert await catalog.select("retry") is None
    assert catalog._snapshot is not None and not catalog.current(catalog._snapshot)


async def test_oversize_corpus_is_never_partially_searched(monkeypatch, corpus):
    monkeypatch.setattr(catalog, "MAX_DOCUMENTS", 2)
    install(corpus)
    assert await catalog.select("retry") is None
    monkeypatch.setattr(catalog, "MAX_DOCUMENTS", 256)
    monkeypatch.setattr(catalog, "MAX_SOURCE_CHARS", 10)
    install(corpus)
    assert await catalog.select("retry") is None


def prepare_pipeline(monkeypatch, corpus):
    install(corpus)
    monkeypatch.setattr(run, "load_settings", AsyncMock(return_value=AppSettings()))
    for module, name in ((run, "extract_tags"), (run, "has_tags"), (run, "retrieve"), (catalog, "connection")):
        monkeypatch.setattr(module, name, AsyncMock(side_effect=AssertionError(f"warm fast path called {name}")))
    saved = AsyncMock()
    monkeypatch.setattr(run, "save_trace", saved)
    return saved


async def test_warm_path_generates_once_without_tags_embedding_or_database(monkeypatch, corpus):
    saved = prepare_pipeline(monkeypatch, corpus)

    async def generate(**kwargs):
        assert kwargs["schema"] is ReviewedCompletion
        count = kwargs["contents"].count('<knowledge candidate="')
        return ReviewedCompletion(
            keep=[True] * count, scores=[0.9] * count, text=" jitter.", completes_partial_word=False
        )

    model = AsyncMock(side_effect=generate)
    monkeypatch.setattr(complete.gemini, "generate_structured", model)
    response = await run.run_enhance(request())
    assert response.type == "autocomplete" and response.text == " jitter."
    assert model.await_count == 1
    assert saved.call_args.kwargs["steps"][0].status == "skipped"
    assert saved.call_args.kwargs["steps"][1].model == "tiger-lexical"
    assert saved.call_args.kwargs["features"]["task_type"] == "other"


async def test_invalidation_during_generation_discards_stale_advice(monkeypatch, corpus):
    saved = prepare_pipeline(monkeypatch, corpus)

    async def generate(contents, candidates, **kwargs):
        retrieve.invalidate_cache()
        return Generation(
            type="autocomplete", autocomplete_text=" jitter.", completes_partial_word=False, question="", options=[]
        ), [Judged(candidate, 0.9, True) for candidate in candidates]

    monkeypatch.setattr(run, "complete", generate)
    response = await run.run_enhance(request())
    assert response.type == "none"
    assert saved.call_args.kwargs["used_knowledge"] == []
    assert "discarded" in saved.call_args.kwargs["steps"][-1].detail


async def test_general_fast_schema_can_classify_partial_words_in_same_call(monkeypatch, corpus):
    prepare_pipeline(monkeypatch, corpus)

    async def generate(contents, candidates, **kwargs):
        assert kwargs["compact"] is False
        assert "allowed_types: autocomplete, multiple_choice, none" in contents
        return Generation(
            type="autocomplete", autocomplete_text="y logic.", completes_partial_word=True, question="", options=[]
        ), [Judged(candidate, 0.9, True) for candidate in candidates]

    monkeypatch.setattr(run, "complete", generate)
    response = await run.run_enhance(request("Add retr"))
    assert response.type == "autocomplete" and response.text == "y logic."


async def test_no_match_preserves_semantic_fallback(monkeypatch, corpus):
    install(corpus)
    monkeypatch.setattr(run, "load_settings", AsyncMock(return_value=AppSettings()))
    tagging = AsyncMock(return_value=TagExtraction(tags=[], task_type="other", missing_constraints=[]))
    monkeypatch.setattr(run, "extract_tags", tagging)
    monkeypatch.setattr(run, "has_tags", AsyncMock(return_value=True))
    monkeypatch.setattr(run, "save_trace", AsyncMock())
    monkeypatch.setattr(
        run,
        "complete",
        AsyncMock(
            return_value=(
                Generation(type="none", autocomplete_text="", completes_partial_word=False, question="", options=[]),
                [],
            )
        ),
    )
    await run.run_enhance(request("Recover gracefully after transient upstream failures"))
    assert tagging.await_count == 1


def test_compact_decisions_preserve_independent_keep_and_exact_accounting(corpus):
    candidates = [doc.candidate for doc in install(corpus).documents[:3]]
    judged = validate_decisions([False, True, True], [0.9, 0.49999, 0.5], candidates)
    assert [item.kept for item in judged] == [False, False, True]
    for keep, scores in (([True], [0.9]), ([True] * 3, [0.9]), ([True] * 4, [0.9] * 4)):
        with pytest.raises(InvalidOutput):
            validate_decisions(keep, scores, candidates)
    for scores in ([float("nan")], [float("inf")], [-1], [1.1], [True]):
        with pytest.raises(ValidationError):
            ReviewedCompletion(keep=[True], scores=scores, text="", completes_partial_word=False)
    with pytest.raises(ValidationError):
        ReviewedCompletion(keep=["true"], scores=[0.9], text="", completes_partial_word=False)
