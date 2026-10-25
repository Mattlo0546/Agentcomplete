"""Latency regressions exercise scheduling, caches and contract safety without external services."""

import asyncio
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api import enhance as enhance_api
from app.errors import UpstreamError
from app.pipeline import complete as complete_module
from app.pipeline import retrieve as retrieve_module
from app.pipeline import run, tags, trace
from app.pipeline.cache import TTLCache
from app.pipeline.complete import Completion, Review, ReviewedCompletion, use_completion, validate_reviews
from app.pipeline.retrieve import Candidate, Retrieval
from app.pipeline.tags import TagExtraction
from app.pipeline.validate import InvalidOutput
from app.schemas.enhance import EnhanceRequest, NoneResponse
from app.settings_store import AppSettings


@pytest.fixture(scope="session", autouse=True)
async def database() -> AsyncIterator[None]:
    """Override the suite's live DB fixture for these entirely deterministic tests."""
    yield


@pytest.fixture(autouse=True)
def clear_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    # These tests retain coverage of the tag/pgvector fallback; fast routing has its own suite.
    monkeypatch.setattr(run.get_settings(), "fast_autocomplete_enabled", False)
    monkeypatch.setattr(run.get_settings(), "catalog_review_enabled", False)
    tags._cache.clear()
    retrieve_module.invalidate_cache()
    retrieve_module._embeddings.clear()


def candidate() -> Candidate:
    return Candidate(uuid4(), "skill", "HTTP retry", "Use safe retries", "Use jitter.", 0.95, ["retry"])


def extraction() -> TagExtraction:
    return TagExtraction(tags=["retry"], task_type="code_change", missing_constraints=[])


def request(prompt: str = "Add retry backoff and") -> EnhanceRequest:
    return EnhanceRequest(request_id="latency-test", prompt=prompt, prompt_revision=1, cursor=len(prompt))


def test_cache_is_bounded_and_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [10.0]
    monkeypatch.setattr("app.pipeline.cache.time.monotonic", lambda: now[0])
    cache: TTLCache[str, int] = TTLCache(2, 5)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1
    cache.put("c", 3)
    assert cache.get("b") is None
    now[0] = 16
    assert cache.get("a") is None and cache.get("c") is None


@pytest.mark.parametrize("ending", ["and", "that check", "so that", "by first", "with", "to"])
def test_compact_suffix_routing(ending: str) -> None:
    text = f"Improve the HTTP client {ending}"
    assert use_completion(text, len(text), AppSettings())
    assert not use_completion(text, len(text) - 1, AppSettings())
    assert not use_completion(text, len(text), AppSettings(autocomplete_enabled=False))


def test_complete_prompts_keep_question_generation() -> None:
    for text in [
        "Write a migration plan for our database.",
        "Write tests for the React login form",
        "Make the API faster",
    ]:
        assert not use_completion(text, len(text), AppSettings())


def test_every_retrieved_candidate_requires_exactly_one_review() -> None:
    candidates = [candidate(), candidate()]
    kept = validate_reviews(
        [Review(candidate=1, keep=True, score=0.4), Review(candidate=0, keep=True, score=0.9)], candidates
    )
    assert [item.kept for item in kept] == [True, False]
    for indices in ([0], [0, 0], [0, 2], [0, 1, 1]):
        with pytest.raises(InvalidOutput):
            validate_reviews([Review(candidate=i, keep=True, score=0.9) for i in indices], candidates)


async def test_fused_completion_preserves_reviews_and_suffix(monkeypatch: pytest.MonkeyPatch) -> None:
    call = AsyncMock(
        return_value=ReviewedCompletion(
            keep=[True],
            scores=[0.95],
            text=" jitter.",
            completes_partial_word=False,
        )
    )
    monkeypatch.setattr(complete_module.gemini, "generate_structured", call)
    output, judged = await complete_module.complete("draft", [candidate()], compact=True)
    assert output.type == "autocomplete" and output.autocomplete_text == " jitter."
    assert judged[0].kept
    assert call.await_count == 1
    assert call.call_args.kwargs["thinking_level"] == "minimal"
    assert call.call_args.kwargs["schema"] is ReviewedCompletion
    assert call.call_args.kwargs["model"] == complete_module.get_settings().autocomplete_model


async def test_tag_cache_is_exact_and_defensive(monkeypatch: pytest.MonkeyPatch) -> None:
    call = AsyncMock(return_value=extraction())
    monkeypatch.setattr(tags.gemini, "generate_structured", call)
    first = await tags.extract_tags("retry")
    first.tags.clear()
    assert (await tags.extract_tags("retry")).tags == ["retry"]
    await tags.extract_tags("retry with jitter")
    assert call.await_count == 2


async def test_retrieval_reuses_only_known_embeddings(monkeypatch: pytest.MonkeyPatch) -> None:
    from contextlib import asynccontextmanager

    calls: list[dict[str, Any]] = []

    class Conn:
        async def execute(self, sql: str, params: dict[str, Any]) -> Any:
            calls.append(params)
            return self

        async def fetchone(self) -> dict[str, Any]:
            return {"tag_similarity": {"1": 0.9, "2": 0.95}, "candidates": []}

    @asynccontextmanager
    async def connection() -> AsyncIterator[Conn]:
        yield Conn()

    embed = AsyncMock(side_effect=lambda texts, **_: [[float(len(t)), 1.0] for t in texts])
    monkeypatch.setattr(retrieve_module, "connection", connection)
    monkeypatch.setattr(retrieve_module.gemini, "embed", embed)
    await retrieve_module.retrieve(["retry"])
    await retrieve_module.retrieve(["retry"])
    await retrieve_module.retrieve(["retry", "jitter"])
    assert [call.args[0] for call in embed.call_args_list] == [["retry"], ["jitter"]]
    assert len(calls) == 2
    retrieve_module.invalidate_cache()
    await retrieve_module.retrieve(["retry"])
    assert len(calls) == 3 and embed.await_count == 2
    await retrieve_module.retrieve(["retry"], refresh=True)
    assert len(calls) == 4 and embed.await_count == 2


async def test_disabled_settings_skip_every_model_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        run,
        "load_settings",
        AsyncMock(
            return_value=AppSettings(
                autocomplete_enabled=False,
                questions_enabled=False,
            )
        ),
    )
    extraction_call = AsyncMock(side_effect=AssertionError("must not extract tags"))
    monkeypatch.setattr(run, "extract_tags", extraction_call)
    saved = AsyncMock()
    monkeypatch.setattr(run, "save_trace", saved)
    result = await run.run_enhance(request())
    assert result.type == "none" and not extraction_call.called
    assert all(step.status == "skipped" for step in saved.call_args.kwargs["steps"])


async def test_pipeline_uses_one_generation_and_records_reviews(monkeypatch: pytest.MonkeyPatch) -> None:
    item = candidate()
    monkeypatch.setattr(run, "load_settings", AsyncMock(return_value=AppSettings()))
    monkeypatch.setattr(run, "extract_tags", AsyncMock(return_value=extraction()))
    monkeypatch.setattr(run, "has_tags", AsyncMock(return_value=True))
    monkeypatch.setattr(run, "retrieve", AsyncMock(return_value=Retrieval({"retry": 0.95}, [item])))
    generate = AsyncMock(
        return_value=ReviewedCompletion(
            keep=[True],
            scores=[0.95],
            text=" jitter.",
            completes_partial_word=False,
        )
    )
    monkeypatch.setattr(complete_module.gemini, "generate_structured", generate)
    saved = AsyncMock()
    monkeypatch.setattr(run, "save_trace", saved)
    result = await run.run_enhance(request())
    assert result.type == "autocomplete" and result.text == " jitter."
    assert generate.await_count == 1
    metadata = saved.call_args.kwargs
    assert metadata["used_knowledge"] == [item.id] and metadata["general"] is False
    assert metadata["steps"][2].latency_ms == 0
    assert metadata["steps"][2].model == metadata["steps"][3].model


async def test_upstream_failure_remains_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        complete_module.gemini,
        "generate_structured",
        AsyncMock(
            side_effect=UpstreamError("upstream_timeout", "timed out"),
        ),
    )
    with pytest.raises(UpstreamError):
        await complete_module.complete("draft", [], compact=True)


async def test_invalid_review_retries_without_accepting_unreviewed_knowledge(monkeypatch: pytest.MonkeyPatch) -> None:
    malformed = ReviewedCompletion(keep=[], scores=[], text=" jitter.", completes_partial_word=False)
    call = AsyncMock(return_value=malformed)
    monkeypatch.setattr(complete_module.gemini, "generate_structured", call)
    result, step, judged = await run._generate_step(
        request(), AppSettings(), extraction(), [candidate()], ["autocomplete"]
    )
    assert result.type == "none" and step.status == "error" and not judged[0].kept
    assert call.await_count == 2


async def test_disconnect_cancels_upstream_work(monkeypatch: pytest.MonkeyPatch) -> None:
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def pipeline(_: EnhanceRequest) -> NoneResponse:
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
        raise AssertionError("unreachable")

    async def receive() -> dict[str, Any]:
        await started.wait()
        return {"type": "http.disconnect"}

    monkeypatch.setattr(enhance_api, "run_enhance", pipeline)
    req = Request({"type": "http"}, receive)
    body = enhance_api._ValidatedEnhanceRequest(**request().model_dump())
    with pytest.raises(HTTPException) as error:
        await asyncio.wait_for(enhance_api.enhance(body, req), 1)
    assert error.value.status_code == 499 and cancelled.is_set()


async def test_success_cancels_disconnect_listener(monkeypatch: pytest.MonkeyPatch) -> None:
    stopped = asyncio.Event()

    async def receive() -> dict[str, Any]:
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()
        raise AssertionError("unreachable")

    monkeypatch.setattr(
        enhance_api,
        "run_enhance",
        AsyncMock(
            return_value=NoneResponse(
                request_id="latency-test",
                prompt_revision=1,
            )
        ),
    )
    req = Request({"type": "http"}, receive)
    body = enhance_api._ValidatedEnhanceRequest(**request().model_dump())
    result = await asyncio.wait_for(enhance_api.enhance(body, req), 1)
    assert result.type == "none" and stopped.is_set()


async def test_trace_is_readable_before_background_database_write(monkeypatch: pytest.MonkeyPatch) -> None:
    released, written = asyncio.Event(), asyncio.Event()

    async def write(*_: Any) -> None:
        await released.wait()
        written.set()

    monkeypatch.setattr(trace, "_write", write)
    await trace.save_trace(
        request_id="pending-trace",
        prompt_revision=1,
        result_type="none",
        general=True,
        tags=[],
        knowledge=[],
        steps=[],
        features={"latency_ms": 1},
    )
    row = await asyncio.wait_for(trace.latest_trace_row("pending-trace"), 0.1)
    assert row is not None and row["features"]["latency_ms"] == 1 and not written.is_set()
    released.set()
    await trace.flush()
    assert written.is_set() and "pending-trace" not in trace._pending_rows


async def test_trace_backpressure_stays_bounded_when_waiters_wake_together(monkeypatch: pytest.MonkeyPatch) -> None:
    permits: asyncio.Queue[None] = asyncio.Queue()

    async def write(*_: Any) -> None:
        await permits.get()

    async def save(index: int) -> None:
        await trace.save_trace(
            request_id=f"bounded-{index}",
            prompt_revision=1,
            result_type="none",
            general=True,
            tags=[],
            knowledge=[],
            steps=[],
            features={},
        )

    monkeypatch.setattr(trace, "_write", write)
    for i in range(256):
        await save(i)
    waiters = [asyncio.create_task(save(256 + i)) for i in range(10)]
    try:
        await asyncio.sleep(0)
        permits.put_nowait(None)
        for _ in range(8):
            await asyncio.sleep(0)
        assert len(trace._pending) <= 256
        assert sum(task.done() for task in waiters) == 1
    finally:
        for _ in range(266):
            permits.put_nowait(None)
        await asyncio.gather(*waiters)
        await trace.flush()


async def test_compact_question_schema_converts_to_wire_edits(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.pipeline.complete import Proposal, ProposalOption
    from app.pipeline.generate import to_response
    from app.pipeline.validate import validate_response

    prompt = "Make the API faster"
    proposal = Proposal(
        type="multiple_choice",
        text="Which latency should improve?",
        completes_partial_word=False,
        options=[
            ProposalOption(label="Tail latency", op="append", anchor="", text="Prioritise p95 latency."),
            ProposalOption(label="Typical latency", op="append", anchor="", text="Prioritise median latency."),
        ],
    )
    monkeypatch.setattr(complete_module.gemini, "generate_structured", AsyncMock(return_value=proposal))
    generation, judged = await complete_module.complete("draft", [], compact=False)
    response = to_response(generation, prompt, "question-test", 1, 4)
    validate_response(prompt, len(prompt), response, AppSettings())
    assert response.type == "multiple_choice" and not judged
    assert [option.id for option in response.options] == ["option-1", "option-2"]


@pytest.mark.parametrize("operation", ["generate", "embed"])
async def test_provider_cancellation_is_propagated_and_logged(monkeypatch: pytest.MonkeyPatch, operation: str) -> None:
    from types import SimpleNamespace

    from app.llm import gemini

    started, cancelled = asyncio.Event(), asyncio.Event()

    async def call(**_: Any) -> None:
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    model_calls = SimpleNamespace(generate_content=call, embed_content=call)
    monkeypatch.setattr(gemini, "_client", lambda: SimpleNamespace(aio=SimpleNamespace(models=model_calls)))
    logged = AsyncMock()
    monkeypatch.setattr(gemini, "record_ai_call", logged)
    if operation == "embed":
        coroutine = gemini.embed(["retry"])
    else:
        coroutine = gemini.generate_structured(
            operation="enhance.generate",
            model="gemini-3.5-flash-lite",
            system="test",
            contents="draft",
            schema=Completion,
            thinking_level="minimal",
            max_output_tokens=768,
        )
    task = asyncio.create_task(coroutine)
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set() and logged.await_count == 1
    assert logged.call_args.args[-1] == "cancelled"


async def test_complete_draft_can_receive_grounded_steps_without_legacy_tag_veto(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.pipeline.generate import Generation
    from app.pipeline.judge import Judged

    item = Candidate(
        uuid4(),
        "skill",
        "Profile API latency",
        "Measure before optimizing",
        "Measure a baseline, profile the slow path, and verify the change against it.",
        0.9,
        ["performance"],
    )

    generate = AsyncMock(
        return_value=(
            Generation(
                type="autocomplete",
                autocomplete_text=" Measure a baseline, profile the slow path, and verify the change against it.",
                completes_partial_word=False,
                question="",
                options=[],
            ),
            [Judged(item, 0.9, True)],
        )
    )
    monkeypatch.setattr(run, "complete", generate)
    result, _, _ = await run._generate_step(
        request("Make the API faster"),
        AppSettings(),
        extraction(),
        [item],
        ["autocomplete", "multiple_choice", "none"],
    )
    assert result.type == "autocomplete"
    contents = generate.call_args.args[0]
    assert "allowed_types: autocomplete, multiple_choice, none" in contents
    assert generate.call_args.kwargs["compact"] is False


@pytest.mark.parametrize("prompt", ["Add retr", "Añade reintentos con retroceso exponencial y", "日本語の入力を"])
def test_model_classification_preserves_midword_and_multilingual_autocomplete(prompt: str) -> None:
    from app.schemas.enhance import utf16_len

    assert use_completion(prompt, utf16_len(prompt), AppSettings(), unfinished=True)
    assert not use_completion(prompt, 0, AppSettings(), unfinished=True)


async def test_tag_classification_sees_long_prompt_tail(monkeypatch: pytest.MonkeyPatch) -> None:
    classified = extraction().model_copy(update={"continuation_needed": True})
    call = AsyncMock(return_value=classified)
    monkeypatch.setattr(tags.gemini, "generate_structured", call)
    output = await tags.extract_tags("a" * 8000 + " Add retr")
    assert output.continuation_needed
    assert "Add retr\n</draft_prompt>" in call.call_args.kwargs["contents"]
    assert len(call.call_args.kwargs["contents"]) < 6100
