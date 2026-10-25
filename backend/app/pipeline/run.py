"""Enhance with cached retrieval and one combined relevance-review/generation call."""

import asyncio
import time
from uuid import UUID

from pydantic import ValidationError

from app.config import get_settings
from app.pipeline import catalog, context
from app.pipeline.complete import complete, generation_model, use_completion
from app.pipeline.features import derive_features
from app.pipeline.generate import WireResponse, allowed_types, build_contents, to_response
from app.pipeline.judge import Judged
from app.pipeline.retrieve import Candidate, Retrieval, has_tags, is_fresh, retrieve
from app.pipeline.tags import TagExtraction, extract_tags
from app.pipeline.trace import TraceKnowledge, TraceStep, TraceTag, save_trace
from app.pipeline.validate import InvalidOutput, validate_response
from app.schemas.enhance import EnhanceRequest, NoneResponse, utf16_len
from app.settings_store import AppSettings, load_settings


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _step(step: str, model: str, started: float | None, status: str, detail: str) -> TraceStep:
    latency = _ms(started) if started is not None else 0
    return TraceStep(step=step, model=model, latency_ms=latency, status=status, detail=detail)  # type: ignore[arg-type]


async def _tags_step(
    prompt: str, previous: context.DraftContext | None = None, *, full_prompt: bool = False
) -> tuple[TagExtraction, TraceStep]:
    if previous is not None and prompt == previous.prompt and context.current(previous):
        extraction = previous.extraction.model_copy(deep=True, update={"reuse_knowledge": True})
        detail = f"{len(extraction.tags)} tags · {extraction.task_type} · unchanged draft"
        return extraction, _step("tags", get_settings().tag_model, None, "ok", detail)
    started = time.perf_counter()
    if previous is not None:
        extraction = await extract_tags(prompt, previous_prompt=previous.prompt, previous_tags=previous.extraction.tags)
    elif full_prompt:
        extraction = await extract_tags(prompt, full_prompt=True)
    else:
        extraction = await extract_tags(prompt)
    detail = f"{len(extraction.tags)} tags · {extraction.task_type}"
    return extraction, _step("tags", get_settings().tag_model, started, "ok", detail)


async def _retrieve_step(
    extraction: TagExtraction, tags_present: bool, *, refresh: bool = False
) -> tuple[Retrieval, TraceStep]:
    model = get_settings().embed_model
    if not extraction.tags or not tags_present:
        detail = "no tags extracted" if not extraction.tags else "knowledge base has no tags"
        return Retrieval({t: 0.0 for t in extraction.tags}, []), _step("retrieve", model, None, "skipped", detail)
    started = time.perf_counter()
    retrieval = await retrieve(extraction.tags, refresh=True) if refresh else await retrieve(extraction.tags)
    detail = f"{len(extraction.tags)} tags → {len(retrieval.candidates)} candidates"
    return retrieval, _step("retrieve", model, started, "ok", detail)


async def _generate_step(
    req: EnhanceRequest,
    settings: AppSettings,
    extraction: TagExtraction | None,
    candidates: list[Candidate],
    allowed: list[str],
) -> tuple[WireResponse, TraceStep, list[Judged]]:
    """Review every candidate before generating; retry invalid output once, then return `none`."""
    compact = use_completion(
        req.prompt, req.cursor, settings, unfinished=bool(extraction and extraction.continuation_needed)
    )
    # A complete or ambiguous draft needs an explicit choice before adding inferred requirements.
    # Compact mode is reserved for unfinished clauses (or autocomplete-only user settings).
    if not compact and extraction is not None:
        allowed = [kind for kind in allowed if kind != "autocomplete"]
    model = generation_model(compact)
    started = time.perf_counter()
    contents = build_contents(req.prompt, req.cursor, settings, extraction, candidates, response_types=allowed)
    feedback = ""
    for attempt in range(2):
        try:
            generation, judged = await complete(contents, candidates, compact=compact, feedback=feedback or None)
            if generation.type not in allowed:
                raise InvalidOutput(f"type {generation.type} is not in allowed_types")
            response = to_response(generation, req.prompt, req.request_id, req.prompt_revision, settings.max_options)
            validate_response(req.prompt, req.cursor, response, settings)
        except InvalidOutput as exc:
            feedback = str(exc)
            continue
        except ValidationError as exc:  # messages carry no input text
            feedback = f"invalid field: {exc.errors()[0]['msg']}"
            continue
        kept = sum(item.kept for item in judged)
        mode = f"{kept} knowledge" if kept else "general enhancement"
        detail = f"{mode} → {response.type}" + (" · compact suffix" if compact else "")
        if attempt:
            detail += " · retried"
        return response, _step("generate", model, started, "ok", detail), judged
    none = NoneResponse(request_id=req.request_id, prompt_revision=req.prompt_revision)
    return (
        none,
        _step("generate", model, started, "error", f"invalid output twice ({feedback})"),
        [Judged(candidate, 0.0, False) for candidate in candidates],
    )


def _skipped_steps(reason: str) -> list[TraceStep]:
    cfg = get_settings()
    models = [("tags", cfg.tag_model), ("retrieve", cfg.embed_model), ("judge", cfg.judge_model)]
    return [_step(s, m, None, "skipped", reason) for s, m in [*models, ("generate", cfg.generate_model)]]


async def run_enhance(req: EnhanceRequest) -> WireResponse:
    started = time.perf_counter()
    # Clear colliding IDs even if this request fails or disables enhancement.
    context.forget(req.request_id)
    previous = context.previous(req.previous_request_id)
    models = context.model_fingerprint()
    response: WireResponse = NoneResponse(request_id=req.request_id, prompt_revision=req.prompt_revision)
    extraction: TagExtraction | None = None
    retrieval = Retrieval({}, [])
    judged: list[Judged] = []
    used: list[UUID] = []

    if not req.prompt.strip():
        steps = _skipped_steps("empty prompt")
    else:
        settings = await load_settings()
        allowed = allowed_types(req.prompt, req.cursor, settings)
        if allowed == ["none"]:
            steps = _skipped_steps("disabled")
        else:
            local_started = time.perf_counter()
            local = (
                await catalog.select(req.prompt)
                if get_settings().fast_autocomplete_enabled
                and settings.autocomplete_enabled
                and req.cursor == utf16_len(req.prompt)
                else None
            )
            if local is not None:
                retrieval = local
                tags_step = _step("tags", "local", None, "skipped", "mode selection in generation; no tag inference")
                retrieve_step = _step(
                    "retrieve",
                    "tiger-lexical",
                    local_started,
                    "ok",
                    f"local knowledge snapshot · {len(local.candidates)} candidates; fresh review",
                )
            elif previous is not None:
                extraction, tags_step = await _tags_step(req.prompt, previous)
                if context.can_reuse(previous, req.prompt, extraction):
                    retrieval = previous.retrieval
                    retrieve_step = _step(
                        "retrieve",
                        get_settings().embed_model,
                        None,
                        "ok",
                        f"reused previous context · {len(retrieval.candidates)} candidates; re-reviewing current draft",
                    )
                else:
                    retrieval, retrieve_step = await _retrieve_step(extraction, await has_tags(), refresh=True)
            else:
                tag_result, tags_present = await asyncio.gather(
                    _tags_step(req.prompt, full_prompt=bool(req.previous_request_id)), has_tags()
                )
                extraction, tags_step = tag_result
                retrieval, retrieve_step = await _retrieve_step(
                    extraction, tags_present, refresh=bool(req.previous_request_id)
                )
            response, generate_step, judged = await _generate_step(
                req, settings, extraction, retrieval.candidates, allowed
            )
            if local is not None and not is_fresh(local):
                response = NoneResponse(request_id=req.request_id, prompt_revision=req.prompt_revision)
                judged = [Judged(candidate, 0.0, False) for candidate in local.candidates]
                generate_step.detail = "knowledge changed or expired during generation; suggestion discarded"
                generate_step.status = "skipped"
            kept = [j.candidate for j in judged if j.kept]
            judge_step = _step(
                "judge",
                generate_step.model,
                None,
                generate_step.status if judged else "skipped",
                f"{len(kept)}/{len(judged)} kept · reviewed in generation call" if judged else "no candidates",
            )
            steps = [tags_step, retrieve_step, judge_step, generate_step]
            used = [c.id for c in kept] if response.type != "none" else []
            if extraction is not None:
                context.remember(req.request_id, req.prompt, extraction, retrieval, models=models)

    features = derive_features(req.prompt, extraction, retrieval.tag_similarity, judged, response, _ms(started))
    await save_trace(
        request_id=req.request_id,
        prompt_revision=req.prompt_revision,
        result_type=response.type,
        general=features["general"],
        tags=[TraceTag(name=n, similarity=s) for n, s in retrieval.tag_similarity.items()],
        knowledge=[
            TraceKnowledge(
                id=str(j.candidate.id),
                kind=j.candidate.kind,  # type: ignore[arg-type]
                title=j.candidate.title,
                score=j.score,
                kept=j.kept,
            )
            for j in judged
        ],
        steps=steps,
        features=features,
        used_knowledge=used,
    )
    return response
