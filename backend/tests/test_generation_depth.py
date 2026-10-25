"""Depth survives generation/routing/validation; semantic model quality needs separate live checks."""

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from app.llm import gemini
from app.pipeline import complete, run
from app.pipeline.edits import apply_edits
from app.pipeline.generate import allowed_types
from app.pipeline.retrieve import Candidate
from app.pipeline.tags import TagExtraction
from app.pipeline.validate import MAX_GHOST_UNITS, validate_response
from app.schemas.enhance import EnhanceRequest, utf16_len
from app.settings_store import AppSettings

PROMPT = "Build a Python command-line expense tracker."
CONTINUATION = (
    " First define the required entries and validation rules, then implement one working path from input to saved "
    "results before expanding it. Keep the input handling separate from the core logic, and test valid entries, "
    "invalid amounts, repeated saves and the resulting totals."
)
WORKFLOW = Candidate(
    UUID(int=1),
    "skill",
    "Deliver a small validated feature",
    "Clarify requirements, implement one working path, and verify behavior.",
    "Use when implementing a bounded feature. Define acceptance criteria, deliver a thin working path, separate "
    "input handling from core logic, and test normal and failure cases. "
    "Next: deploy only when deployment is requested.",
    0.0,
    [],
)
UNRELATED = Candidate(
    UUID(int=2),
    "skill",
    "React browser layout",
    "Responsive component layouts for a React browser app.",
    "Use React components and responsive CSS for browser layouts.",
    0.0,
    [],
)


@pytest.fixture(scope="session", autouse=True)
async def database() -> AsyncIterator[None]:
    """These contract tests never access a provider or database."""
    yield


def request() -> EnhanceRequest:
    return EnhanceRequest(
        request_id="depth-fixture", prompt=PROMPT, prompt_revision=2, cursor=utf16_len(PROMPT), previous_request_id=None
    )


@pytest.mark.parametrize("questions_enabled", [True, False])
@pytest.mark.parametrize("legacy_features", [True, False])
async def test_complete_brief_can_receive_a_substantive_grounded_suffix(
    monkeypatch: pytest.MonkeyPatch, questions_enabled: bool, legacy_features: bool
) -> None:
    settings = AppSettings.model_validate({"questions_enabled": questions_enabled})
    result = (
        complete.ReviewedGeneration(
            keep=[True, False],
            scores=[0.9, 0.8],
            type="autocomplete",
            completes_partial_word=False,
            text=CONTINUATION,
            options=[],
        )
        if questions_enabled
        else complete.ReviewedCompletion(
            keep=[True, False], scores=[0.9, 0.8], completes_partial_word=False, text=CONTINUATION
        )
    )
    provider = AsyncMock(return_value=result)
    monkeypatch.setattr(gemini, "generate_structured", provider)
    extraction = (
        TagExtraction(tags=["python"], task_type="code_change", missing_constraints=[], continuation_needed=False)
        if legacy_features
        else None
    )
    req = request()
    response, step, judged = await run._generate_step(
        req, settings, extraction, [WORKFLOW, UNRELATED], allowed_types(PROMPT, req.cursor, settings)
    )
    assert 25 < len(CONTINUATION.split()) <= 60 and utf16_len(CONTINUATION) <= MAX_GHOST_UNITS
    assert response.type == "autocomplete" and response.text == CONTINUATION
    assert step.status == "ok" and provider.await_count == 1
    assert [(item.kept, item.score) for item in judged] == [(True, 0.9), (False, 0.8)]
    validate_response(PROMPT, req.cursor, response, settings)
    contents = provider.call_args.kwargs["contents"]
    assert PROMPT in contents and WORKFLOW.body in contents


async def test_material_choice_can_carry_useful_steps_in_each_option(monkeypatch: pytest.MonkeyPatch) -> None:
    choices = [
        complete.ProposalOption(
            label="Portable file storage",
            op="append",
            anchor="",
            text=" Use a portable data file for persistence, validate each entry before writing, and test loading "
            "existing records, invalid values and interrupted saves without losing earlier entries.",
        ),
        complete.ProposalOption(
            label="Embedded database storage",
            op="append",
            anchor="",
            text=" Use an embedded database for persistence, group related writes atomically, and test valid inserts, "
            "rejected values, transaction rollback and loading the saved results in Python.",
        ),
    ]
    provider = AsyncMock(
        return_value=complete.ReviewedGeneration(
            keep=[True],
            scores=[0.9],
            type="multiple_choice",
            completes_partial_word=False,
            text="How should entries persist between runs?",
            options=choices,
        )
    )
    monkeypatch.setattr(gemini, "generate_structured", provider)
    settings, req = AppSettings.model_validate({}), request()
    response, _, judged = await run._generate_step(
        req, settings, None, [WORKFLOW], allowed_types(PROMPT, req.cursor, settings)
    )
    assert response.type == "multiple_choice" and judged[0].kept
    validate_response(PROMPT, req.cursor, response, settings)
    for option, choice in zip(response.options, choices, strict=True):
        assert len(choice.text.split()) > 15
        assert apply_edits(PROMPT, option.edits) == PROMPT + choice.text
    assert provider.await_count == 1


async def test_depth_does_not_bypass_existing_ghost_length_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = AsyncMock(
        return_value=complete.ReviewedGeneration(
            keep=[True],
            scores=[0.9],
            type="autocomplete",
            completes_partial_word=False,
            text=" Check behavior." * 40,
            options=[],
        )
    )
    monkeypatch.setattr(gemini, "generate_structured", provider)
    settings, req = AppSettings.model_validate({}), request()
    response, step, judged = await run._generate_step(
        req, settings, None, [WORKFLOW], allowed_types(PROMPT, req.cursor, settings)
    )
    assert response.type == "none" and step.status == "error"
    assert not judged[0].kept and provider.await_count == 2
