"""Conservative previous-prompt reuse: semantic gate, fresh source age, invalidation and re-review."""

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.pipeline import context, retrieve, run, tags
from app.pipeline.generate import Generation, WireResponse
from app.pipeline.judge import Judged
from app.pipeline.retrieve import Candidate, Retrieval
from app.pipeline.tags import TagExtraction
from app.schemas.enhance import EnhanceRequest
from app.settings_store import AppSettings


@pytest.fixture(scope="session", autouse=True)
async def database() -> AsyncIterator[None]:
    yield


@pytest.fixture(autouse=True)
def reset_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(run.get_settings(), "fast_autocomplete_enabled", False)
    context._contexts.clear()
    tags._cache.clear()
    retrieve.invalidate_cache()


def extraction(**changes: object) -> TagExtraction:
    return TagExtraction(
        tags=["python", "retry"],
        task_type="code_change",
        missing_constraints=["scope"],
    ).model_copy(update=changes)


def retrieved() -> Retrieval:
    item = Candidate(uuid4(), "skill", "Retry safely", "Idempotent requests only", "Use jitter", 0.95, ["retry"])
    return Retrieval({"python": 0.9, "retry": 0.95}, [item])


def remember(prompt: str = "Add Python retry logic", request_id: str = "prior") -> context.DraftContext:
    context.remember(request_id, prompt, extraction(), retrieved())
    result = context.previous(request_id)
    assert result is not None
    return result


def request(
    prompt: str = "Add Python retry logic ", previous: str | None = "prior", request_id: str = "current"
) -> EnhanceRequest:
    return EnhanceRequest(
        request_id=request_id,
        prompt=prompt,
        prompt_revision=2,
        cursor=len(prompt),
        previous_request_id=previous,
    )


def test_previous_request_id_remains_optional_and_bounded() -> None:
    assert request(previous=None).previous_request_id is None
    for invalid in ["", "x" * 65]:
        with pytest.raises(ValidationError):
            request(previous=invalid)


def test_explicit_positive_decision_and_stable_features_are_required() -> None:
    previous = remember()
    assert not context.can_reuse(previous, request().prompt, extraction())
    assert context.can_reuse(previous, request().prompt, extraction(reuse_knowledge=True))
    assert context.can_reuse(previous, request().prompt, extraction(reuse_knowledge=True, tags=["retry", "python"]))
    assert context.can_reuse(previous, request().prompt, extraction(reuse_knowledge=True, missing_constraints=[]))
    for changes in [
        {"tags": ["javascript", "retry"]},
        {"task_type": "debugging"},
    ]:
        assert not context.can_reuse(previous, request().prompt, extraction(reuse_knowledge=True, **changes))
    assert context.previous("unknown") is None


def test_reuse_chain_does_not_renew_original_retrieval_age(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [100.0]
    monkeypatch.setattr(retrieve.time, "monotonic", lambda: now[0])
    source = retrieved()
    source.fetched_at = now[0]
    context.remember("first", "Add Python retry logic", extraction(), source)
    now[0] = 114.0
    previous = context.previous("first")
    assert previous is not None
    # Even storing an already-cached retrieval in a later request retains its ORIGINAL age.
    context.remember("second", "Add Python retry logic ", extraction(), previous.retrieval)
    now[0] = 115.0
    assert context.previous("second") is None
    assert not context.can_reuse(previous, "Add Python retry logic ", extraction(reuse_knowledge=True))


def test_knowledge_write_and_model_change_invalidate_context(monkeypatch: pytest.MonkeyPatch) -> None:
    previous = remember()
    retrieve.invalidate_cache()
    assert context.previous("prior") is None
    assert not context.can_reuse(previous, request().prompt, extraction(reuse_knowledge=True))
    previous = remember()
    changed = context.get_settings().model_copy(update={"embed_dims": 1536})
    monkeypatch.setattr(context, "get_settings", lambda: changed)
    assert context.previous("prior") is None
    assert not context.can_reuse(previous, request().prompt, extraction(reuse_knowledge=True))


def test_model_change_during_request_cannot_store_mixed_context(monkeypatch: pytest.MonkeyPatch) -> None:
    original_models = context.model_fingerprint()
    changed = context.get_settings().model_copy(update={"generate_model": "different-model"})
    monkeypatch.setattr(context, "get_settings", lambda: changed)
    context.remember("prior", "Add Python retry logic", extraction(), retrieved(), models=original_models)
    assert context.previous("prior") is None


def test_context_cache_is_bounded_and_colliding_invalid_snapshots_are_forgotten() -> None:
    for i in range(129):
        remember(request_id=str(i))
    assert context.previous("0") is None and context.previous("128") is not None
    context.remember("128", "", extraction(), Retrieval({}, []))
    assert context.previous("128") is None


def test_hidden_middle_change_blocks_reuse_even_if_model_claims_safe() -> None:
    original = "a" * 4000 + " use Python " + "z" * 2000
    changed = "a" * 4000 + " use Rust " + "z" * 2000
    previous = remember(prompt=original)
    assert not context.can_reuse(previous, changed, extraction(reuse_knowledge=True))
    assert tags.visible_comparison(original, original[:-1] + "x")


async def test_comparison_is_in_existing_tag_call_and_preserves_current_features(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = AsyncMock(return_value=extraction(reuse_knowledge=True, continuation_needed=True))
    monkeypatch.setattr(tags.gemini, "generate_structured", model)
    result = await tags.extract_tags(
        "Add Python retry logic and",
        previous_prompt="Add Python retry logic an",
        previous_tags=["python", "retry"],
    )
    assert result.reuse_knowledge and result.continuation_needed
    assert model.await_count == 1
    contents = model.call_args.kwargs["contents"]
    assert "<draft_prompt>" in contents and "<previous_draft>" in contents and "<previous_tags>" in contents
    assert contents.index("<previous_draft>") < contents.index("<draft_prompt>")
    assert next(iter(TagExtraction.model_json_schema()["properties"])) == "reuse_knowledge"
    # Approval without a supplied prior draft is never trusted or cached as an approval.
    unlinked = await tags.extract_tags("Add Python retry logic and")
    assert not unlinked.reuse_knowledge
    assert model.await_count == 2


async def test_hidden_middle_change_uses_full_current_input_and_disables_model_reuse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = "a" * 4000 + " use Python " + "z" * 2000
    changed = "a" * 4000 + " never use Python; use Rust " + "z" * 2000
    model = AsyncMock(return_value=extraction(reuse_knowledge=True))
    monkeypatch.setattr(tags.gemini, "generate_structured", model)
    result = await tags.extract_tags(changed, previous_prompt=original, previous_tags=["python", "retry"])
    assert not result.reuse_knowledge
    contents = model.call_args.kwargs["contents"]
    assert "never use Python; use Rust" in contents
    assert "<previous_draft>" not in contents


async def test_tag_cache_does_not_hide_an_omitted_middle_change(monkeypatch: pytest.MonkeyPatch) -> None:
    first = "a" * 4000 + " use Python " + "z" * 2000
    second = "a" * 4000 + " use Rust " + "z" * 2000
    model = AsyncMock(return_value=extraction())
    monkeypatch.setattr(tags.gemini, "generate_structured", model)
    await tags.extract_tags(first)
    await tags.extract_tags(second)
    assert model.await_count == 2


def setup_pipeline(
    monkeypatch: pytest.MonkeyPatch, tag_result: TagExtraction
) -> tuple[AsyncMock, AsyncMock, AsyncMock]:
    monkeypatch.setattr(run, "load_settings", AsyncMock(return_value=AppSettings()))
    monkeypatch.setattr(run, "extract_tags", AsyncMock(return_value=tag_result))
    retrieval = AsyncMock(return_value=retrieved())
    monkeypatch.setattr(run, "retrieve", retrieval)
    monkeypatch.setattr(run, "has_tags", AsyncMock(return_value=True))

    async def generate(contents: str, candidates: list[Candidate], **_: object) -> tuple[Generation, list[Judged]]:
        return Generation(
            type="none",
            autocomplete_text="",
            completes_partial_word=False,
            question="",
            options=[],
        ), [Judged(candidate, 0.0, False) for candidate in candidates]

    review = AsyncMock(side_effect=generate)
    monkeypatch.setattr(run, "complete", review)
    saved = AsyncMock()
    monkeypatch.setattr(run, "save_trace", saved)
    return retrieval, review, saved


async def test_approved_reuse_skips_retrieval_but_rechecks_every_candidate(monkeypatch: pytest.MonkeyPatch) -> None:
    previous = remember()
    retrieval, review, saved = setup_pipeline(monkeypatch, extraction(reuse_knowledge=True))
    await run.run_enhance(request())
    assert not retrieval.called
    assert review.await_count == 1
    assert review.call_args.args[1] is previous.retrieval.candidates
    assert request().prompt in review.call_args.args[0]
    assert "reused previous context" in saved.call_args.kwargs["steps"][1].detail
    assert saved.call_args.kwargs["knowledge"][0].kept is False
    current = context.previous("current")
    assert current is not None and current.retrieval.fetched_at == previous.retrieval.fetched_at


async def test_identical_linked_draft_reuses_extraction_but_regenerates_for_current_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    previous = remember()
    retrieval, review, saved = setup_pipeline(monkeypatch, extraction())
    extract = AsyncMock(side_effect=AssertionError("unchanged draft must not re-extract tags"))
    presence = AsyncMock(side_effect=AssertionError("unchanged draft must not query knowledge presence"))
    embed = AsyncMock(side_effect=AssertionError("unchanged draft must not embed tags"))
    monkeypatch.setattr(run, "extract_tags", extract)
    monkeypatch.setattr(run, "has_tags", presence)
    monkeypatch.setattr(retrieve.gemini, "embed", embed)
    copied, _ = await run._tags_step(previous.prompt, previous)
    copied.tags.clear()
    assert previous.extraction.tags == ["python", "retry"]
    validate = run.validate_response
    checked: list[int] = []

    def validate_current(prompt: str, cursor: int, response: WireResponse, settings: AppSettings) -> None:
        checked.append(cursor)
        validate(prompt, cursor, response, settings)

    monkeypatch.setattr(run, "validate_response", validate_current)
    req = request(prompt=previous.prompt).model_copy(update={"cursor": 3})
    await run.run_enhance(req)
    assert not extract.called and not presence.called and not retrieval.called and not embed.called
    assert review.await_count == 1 and checked == [3]
    assert review.call_args.args[1] is previous.retrieval.candidates
    assert "cursor_at_end: false" in review.call_args.args[0]
    tag_step = saved.call_args.kwargs["steps"][0]
    assert tag_step.latency_ms == 0 and "unchanged draft" in tag_step.detail
    assert saved.call_args.kwargs["knowledge"][0].kept is False
    assert previous.extraction.reuse_knowledge is False
    current = context.previous("current")
    assert current is not None and current.extraction is not previous.extraction
    assert current.extraction.missing_constraints == previous.extraction.missing_constraints


@pytest.mark.parametrize("reason", ["denied", "tags_changed", "unknown", "write_during_comparison", "collision"])
async def test_unsafe_or_missing_context_runs_retrieval(monkeypatch: pytest.MonkeyPatch, reason: str) -> None:
    remember()
    result = extraction(reuse_knowledge=reason != "denied")
    if reason == "tags_changed":
        result.tags = ["typescript", "retry"]
    retrieval, review, _ = setup_pipeline(monkeypatch, result)
    req = request(
        previous="unknown" if reason == "unknown" else "prior",
        request_id="prior" if reason == "collision" else "current",
    )
    if reason == "write_during_comparison":

        async def extract(*_: object, **__: object) -> TagExtraction:
            retrieve.invalidate_cache()
            return result

        monkeypatch.setattr(run, "extract_tags", extract)
    await run.run_enhance(req)
    assert retrieval.await_count == 1 and review.await_count == 1
    assert retrieval.call_args.kwargs["refresh"] is True


async def test_expired_or_unknown_context_refresh_can_inspect_the_full_current_draft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prompt = "a" * 4000 + " never use Python; use Rust " + "z" * 2000
    model = AsyncMock(return_value=extraction())
    monkeypatch.setattr(tags.gemini, "generate_structured", model)
    await tags.extract_tags(prompt, full_prompt=True)
    assert "never use Python; use Rust" in model.call_args.kwargs["contents"]


async def test_expiry_during_comparison_forces_retrieval(monkeypatch: pytest.MonkeyPatch) -> None:
    previous = remember()
    retrieval, review, _ = setup_pipeline(monkeypatch, extraction(reuse_knowledge=True))

    async def extract(*_: object, **__: object) -> TagExtraction:
        previous.retrieval.fetched_at -= 16
        return extraction(reuse_knowledge=True)

    monkeypatch.setattr(run, "extract_tags", extract)
    await run.run_enhance(request())
    assert retrieval.await_count == 1 and review.await_count == 1
    assert retrieval.call_args.kwargs["refresh"] is True
