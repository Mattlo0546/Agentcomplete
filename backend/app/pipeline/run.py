"""Orchestrates one POST /v1/enhance: tags → retrieve → judge → generate → validate → trace.

Latency: a general (knowledge-free) generation starts speculatively alongside tag extraction. It is used when
retrieval/judging keeps nothing, and cancelled as soon as knowledge is kept (then a grounded generation runs).
"""

import asyncio
import contextlib
import time
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from app.config import get_settings
from app.pipeline.features import derive_features
from app.pipeline.generate import WireResponse, allowed_types, build_contents, generate, to_response
from app.pipeline.judge import Judged, judge
from app.pipeline.retrieve import Candidate, Retrieval, has_tags, increment_use_count, retrieve
from app.pipeline.tags import TagExtraction, extract_tags
from app.pipeline.trace import TraceKnowledge, TraceStep, TraceTag, save_trace
from app.pipeline.validate import InvalidOutput, validate_response
from app.schemas.enhance import EnhanceRequest, NoneResponse
from app.settings_store import AppSettings, load_settings

Generated = tuple[WireResponse, TraceStep]


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _step(step: str, model: str, started: float | None, status: str, detail: str) -> TraceStep:
    latency = _ms(started) if started is not None else 0
    return TraceStep(step=step, model=model, latency_ms=latency, status=status, detail=detail)  # type: ignore[arg-type]


async def _tags_step(prompt: str) -> tuple[TagExtraction, TraceStep]:
    started = time.perf_counter()
    extraction = await extract_tags(prompt)
    detail = f"{len(extraction.tags)} tags · {extraction.task_type}"
    return extraction, _step("tags", get_settings().tag_model, started, "ok", detail)


async def _retrieve_step(extraction: TagExtraction, tags_present: bool) -> tuple[Retrieval, TraceStep]:
    model = get_settings().embed_model
    if not extraction.tags or not tags_present:
        detail = "no tags extracted" if not extraction.tags else "knowledge base has no tags"
        return Retrieval({t: 0.0 for t in extraction.tags}, []), _step("retrieve", model, None, "skipped", detail)
    started = time.perf_counter()
    retrieval = await retrieve(extraction.tags)
    detail = f"{len(extraction.tags)} tags → {len(retrieval.candidates)} candidates"
    return retrieval, _step("retrieve", model, started, "ok", detail)


async def _judge_step(prompt: str, candidates: list[Candidate]) -> tuple[list[Judged], TraceStep]:
    model = get_settings().judge_model
    if not candidates:
        return [], _step("judge", model, None, "skipped", "no candidates")
    started = time.perf_counter()
    judged, failed = await judge(prompt, candidates)
    detail = f"{sum(j.kept for j in judged)}/{len(judged)} kept" + (f" · {failed} failed/slow" if failed else "")
    return judged, _step("judge", model, started, "error" if failed else "ok", detail)


async def _generate_step(
    req: EnhanceRequest,
    settings: AppSettings,
    extraction: TagExtraction | None,
    kept: list[Candidate],
    allowed: list[str],
) -> Generated:
    """Generate, convert and validate; retry once on invalid output, then fall back to `none`."""
    model = get_settings().generate_model
    started = time.perf_counter()
    contents = build_contents(req.prompt, req.cursor, settings, extraction, kept)
    mode = f"{len(kept)} knowledge" if kept else "general enhancement"
    feedback = ""
    for attempt in range(2):
        generation = await generate(contents, feedback or None)
        try:
            if generation.type not in allowed:
                raise InvalidOutput(f"type {generation.type} is not in allowed_types")
            response = to_response(generation, req.prompt, req.request_id, req.prompt_revision, settings.max_options)
            validate_response(req.prompt, req.cursor, response, settings)
        except InvalidOutput as exc:
            feedback = str(exc)
            continue
        except ValidationError as exc:  # wire-model constraint; messages carry no input text
            feedback = f"invalid field: {exc.errors()[0]['msg']}"
            continue
        detail = f"{mode} → {response.type}" + (" · retried" if attempt else "")
        return response, _step("generate", model, started, "ok", detail)
    none = NoneResponse(request_id=req.request_id, prompt_revision=req.prompt_revision)
    return none, _step("generate", model, started, "error", f"{mode} → invalid output twice ({feedback})")


def _skipped_steps(reason: str) -> list[TraceStep]:
    cfg = get_settings()
    models = [("tags", cfg.tag_model), ("retrieve", cfg.embed_model), ("judge", cfg.judge_model)]
    return [_step(s, m, None, "skipped", reason) for s, m in [*models, ("generate", cfg.generate_model)]]


async def _discard(task: "asyncio.Task[Any] | None") -> None:
    if task is not None:
        task.cancel()
        with contextlib.suppress(BaseException):
            await task


async def run_enhance(req: EnhanceRequest) -> WireResponse:
    started = time.perf_counter()
    response: WireResponse = NoneResponse(request_id=req.request_id, prompt_revision=req.prompt_revision)
    extraction: TagExtraction | None = None
    retrieval = Retrieval({}, [])
    judged: list[Judged] = []
    used: list[UUID] = []

    if not req.prompt.strip():
        steps = _skipped_steps("empty prompt")
    else:
        tags_task = asyncio.create_task(_tags_step(req.prompt))
        speculative: asyncio.Task[Generated] | None = None
        try:
            settings, tags_present = await asyncio.gather(load_settings(), has_tags())
            allowed = allowed_types(req.prompt, req.cursor, settings)
            if allowed != ["none"]:
                speculative = asyncio.create_task(_generate_step(req, settings, None, [], allowed))
            extraction, tags_step = await tags_task
            retrieval, retrieve_step = await _retrieve_step(extraction, tags_present)
            judged, judge_step = await _judge_step(req.prompt, retrieval.candidates)
            kept = [j.candidate for j in judged if j.kept]
            if speculative is None:
                generate_step = _step("generate", get_settings().generate_model, None, "skipped", "disabled")
            elif kept:
                await _discard(speculative)
                response, generate_step = await _generate_step(req, settings, extraction, kept, allowed)
            else:
                response, generate_step = await speculative
        finally:
            await _discard(tags_task if not tags_task.done() else None)
            await _discard(speculative if speculative and not speculative.done() else None)
        steps = [tags_step, retrieve_step, judge_step, generate_step]
        used = [c.id for c in kept] if response.type != "none" else []

    features = derive_features(req.prompt, extraction, retrieval.tag_similarity, judged, response, _ms(started))
    trace = save_trace(
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
    )
    await asyncio.gather(trace, increment_use_count(used))
    return response
