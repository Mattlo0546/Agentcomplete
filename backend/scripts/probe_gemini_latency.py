"""Sequential synthetic Gemini comparisons; persist metadata only, never generated text or credentials."""

import argparse
import asyncio
import hashlib
import json
import logging
import random
import re
import statistics
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.config import get_settings
from app.pipeline.complete import (
    _COMPLETE,
    _PROPOSE,
    _REVIEW,
    Completion,
    Proposal,
    ReviewedCompletion,
    ReviewedGeneration,
    validate_decisions,
)
from app.pipeline.generate import Generation, ModelEdit, ModelOption, build_contents, to_response
from app.pipeline.retrieve import Candidate
from app.pipeline.validate import validate_response
from app.schemas.enhance import utf16_len
from app.settings_store import AppSettings


@dataclass(frozen=True)
class Case:
    name: str
    prompt: str
    compact: bool
    expected_types: tuple[str, ...]
    candidates: tuple[Candidate, ...] = ()
    expected_keep: tuple[tuple[int, bool], ...] = ()


RETRY = Candidate(
    UUID(int=1),
    "skill",
    "Safe HTTP retries",
    "Bounded retries for transient HTTP failures.",
    "Retry only transient errors and operations safe to repeat. Use exponential backoff with jitter, "
    "a maximum attempt count and a total deadline. Payments need idempotency safeguards. "
    "Respect Retry-After and propagate the last error when attempts are exhausted.",
    1.0,
    ["retry", "http"],
)
REACT = Candidate(
    UUID(int=2),
    "skill",
    "React component state",
    "State management for React components.",
    "Use React hooks to manage component state and clean up subscriptions in effects.",
    0.3,
    ["react"],
)
API_ERRORS = Candidate(
    UUID(int=3),
    "skill",
    "HTTP API error contract",
    "Consistent errors and safe error reporting for APIs.",
    "Distinguish invalid requests from server failures. Return consistent machine-readable error codes. "
    "Keep credentials and internal stack traces out of public responses; test failure paths.",
    0.8,
    ["http", "error-handling"],
)
CASES = (
    Case(
        "retry_suffix",
        "Add retry logic with exponential backoff to the HTTP client in our Python payments service so that",
        True,
        ("autocomplete",),
        (RETRY, REACT, API_ERRORS),
        ((0, True), (1, False)),
    ),
    Case(
        "semantic_suffix",
        "Make outbound calls recover from temporary network failures with increasing delays and",
        True,
        ("autocomplete",),
        (RETRY, REACT, API_ERRORS),
        ((0, True), (1, False)),
    ),
    Case(
        "question",
        "Improve error handling in our Python HTTP API.",
        False,
        ("multiple_choice", "none"),
        (API_ERRORS, REACT),
        ((0, True), (1, False)),
    ),
    Case("partial_word", "Add retr", False, ("autocomplete", "none")),
    Case(
        "spanish",
        "Añade reintentos con retroceso exponencial para llamadas HTTP y",
        False,
        ("autocomplete",),
        (RETRY, REACT),
        ((0, True), (1, False)),
    ),
)


def elapsed(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 2)


def quality(result: BaseModel, case: Case, settings: AppSettings) -> dict[str, Any]:
    values = result.model_dump()
    judged = validate_decisions(values["keep"], values["scores"], list(case.candidates)) if case.candidates else []
    kind = values.get("type", "autocomplete" if values["text"].strip() else "none")
    generation = Generation(
        type=kind,
        autocomplete_text=values["text"] if kind == "autocomplete" else "",
        completes_partial_word=values["completes_partial_word"],
        question=values["text"] if kind == "multiple_choice" else "",
        options=[
            ModelOption(
                id=f"option-{i}",
                label=o["label"],
                edits=[ModelEdit(**{key: o[key] for key in ("op", "anchor", "text")})],
            )
            for i, o in enumerate(values.get("options", []))
        ],
    )
    response = to_response(generation, case.prompt, "req_probe_synthetic", 1, settings.max_options)
    validate_response(case.prompt, utf16_len(case.prompt), response, settings)
    return {
        "result_type": kind,
        "wire_valid": True,
        "expected_type": kind in case.expected_types,
        "expected_relevance": all(judged[i].kept == expected for i, expected in case.expected_keep),
        "keep": [item.kept for item in judged],
        "scores": [item.score for item in judged],
        "text_chars": len(values["text"]),
        "text_sha256": hashlib.sha256(values["text"].encode()).hexdigest(),
        "option_count": len(generation.options),
    }


async def sample(
    client: genai.Client, model: str, tier: str, mode: str, case: Case, round_no: int, thinking_mode: str
) -> dict[str, Any]:
    settings = AppSettings.model_validate({})
    schema: type[BaseModel] = (
        (ReviewedCompletion if case.candidates else Completion)
        if case.compact
        else (ReviewedGeneration if case.candidates else Proposal)
    )
    resolved_thinking = (
        ("off" if model.startswith("gemini-2.5-") else "minimal") if thinking_mode == "auto" else thinking_mode
    )
    thinking = (
        types.ThinkingConfig(thinking_budget=0)
        if resolved_thinking == "off"
        else types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL)
    )
    config = types.GenerateContentConfig(
        system_instruction=(_REVIEW if case.candidates else "") + (_COMPLETE if case.compact else _PROPOSE),
        response_schema=schema,
        response_mime_type="application/json",
        temperature=0.2,
        thinking_config=thinking,
        max_output_tokens=768 if case.compact else 2048,
        service_tier=types.ServiceTier(tier),
    )
    contents = build_contents(case.prompt, utf16_len(case.prompt), settings, None, list(case.candidates))
    row: dict[str, Any] = {
        "case": case.name,
        "round": round_no,
        "model": model,
        "requested_tier": tier,
        "mode": mode,
        "schema": schema.__name__,
        "candidate_count": len(case.candidates),
        "thinking": resolved_thinking,
    }
    started = time.perf_counter()
    fragments: list[str] = []
    usage = None
    headers: dict[str, str] = {}
    finish = None
    try:
        async with asyncio.timeout(12):
            if mode == "stream":
                stream = await client.aio.models.generate_content_stream(model=model, contents=contents, config=config)
                async for chunk in stream:
                    chunk_text = "".join(
                        part.text or ""
                        for candidate in chunk.candidates or []
                        for part in (candidate.content.parts or [] if candidate.content else [])
                        if not part.thought
                    )
                    if chunk_text:
                        row.setdefault("first_non_thinking_token_ms", elapsed(started))
                        fragments.append(chunk_text)
                        partial = "".join(fragments)
                        if re.search(r'"text"\s*:\s*"(?:[^"\\]|\\.)+', partial):
                            row.setdefault("first_text_field_ms", elapsed(started))
                        try:
                            schema.model_validate_json(partial)
                        except ValueError:
                            pass
                        else:
                            row.setdefault("complete_schema_ms", elapsed(started))
                    if chunk.usage_metadata:
                        usage = chunk.usage_metadata
                    if chunk.sdk_http_response and chunk.sdk_http_response.headers:
                        headers.update(chunk.sdk_http_response.headers)
                    for candidate in chunk.candidates or []:
                        if candidate.finish_reason:
                            finish = str(candidate.finish_reason)
            else:
                response = await client.aio.models.generate_content(model=model, contents=contents, config=config)
                fragments.append(response.text or "")
                usage = response.usage_metadata
                if response.sdk_http_response and response.sdk_http_response.headers:
                    headers.update(response.sdk_http_response.headers)
                finish = str(response.candidates[0].finish_reason) if response.candidates else None
        row["response_complete_ms"] = elapsed(started)
        result = schema.model_validate_json("".join(fragments))
        row.update(quality(result, case, settings))
        row["validated_ms"] = elapsed(started)
        row["status"] = "ok"
    except Exception as exc:
        row.update(
            status="error",
            error_type=type(exc).__name__,
            http_code=getattr(exc, "code", None),
            response_complete_ms=elapsed(started),
        )
    row["applied_tier"] = next((v for k, v in headers.items() if k.lower() == "x-gemini-service-tier"), None)
    row["response_header_names"] = sorted(k.lower() for k in headers)
    row["finish_reason"] = finish
    if usage:
        row.update(
            {
                name: getattr(usage, name)
                for name in (
                    "prompt_token_count",
                    "candidates_token_count",
                    "thoughts_token_count",
                    "cached_content_token_count",
                    "total_token_count",
                )
            }
        )
    return row


async def main(args: argparse.Namespace) -> None:
    logging.getLogger("google_genai").setLevel(logging.ERROR)
    client = genai.Client(api_key=get_settings().gemini_api_key)
    rows: list[dict[str, Any]] = []
    inventory = []
    try:
        async for model in await client.aio.models.list():
            if model.name and model.name.removeprefix("models/") in args.models:
                inventory.append({"name": model.name.removeprefix("models/"), "actions": model.supported_actions})
        available = {m["name"] for m in inventory if "generateContent" in (m["actions"] or [])}
        if set(args.models) - available:
            raise ValueError("requested model absent from accessible generateContent inventory")
        print(json.dumps({"inventory": inventory}), flush=True)
        rng = random.Random(args.seed)
        for round_no in range(1, args.rounds + 1):
            jobs = [
                (model, tier, mode, case)
                for model in args.models
                for tier in args.tiers
                for mode in args.modes
                for case in CASES
                if case.name in args.cases
            ]
            rng.shuffle(jobs)
            for model, tier, mode, case in jobs:
                row = await sample(client, model, tier, mode, case, round_no, args.thinking)
                rows.append(row)
                print(json.dumps(row), flush=True)
    finally:
        await client.aio.aclose()
        client.close()
    summaries = {}
    for model in args.models:
        for tier in args.tiers:
            for mode in args.modes:
                subset = [r for r in rows if (r["model"], r["requested_tier"], r["mode"]) == (model, tier, mode)]
                valid = [r for r in subset if r["status"] == "ok"]
                summaries[f"{model}/{tier}/{mode}"] = {
                    "n": len(subset),
                    "valid": len(valid),
                    "expected_type_pass": sum(r["expected_type"] for r in valid),
                    "relevance_pass": sum(r["expected_relevance"] for r in valid),
                    "median_validated_ms": statistics.median(r["validated_ms"] for r in valid) if valid else None,
                    "median_first_token_ms": statistics.median(r["first_non_thinking_token_ms"] for r in valid)
                    if valid and mode == "stream"
                    else None,
                }
    result = {
        "measured_at": datetime.now(UTC).isoformat(),
        "sdk_version": genai.__version__,
        "scope": "Sequential randomized synthetic provider-only probes; no application database writes",
        "seed": args.seed,
        "inventory": inventory,
        "summaries": summaries,
        "samples": rows,
    }
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"summaries": summaries}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", default=["gemini-3.5-flash-lite"])
    parser.add_argument("--tiers", nargs="+", choices=["standard", "priority"], default=["standard"])
    parser.add_argument("--modes", nargs="+", choices=["stream", "full"], default=["stream"])
    parser.add_argument("--thinking", choices=["auto", "minimal", "off"], default="auto")
    parser.add_argument("--cases", nargs="+", choices=[c.name for c in CASES], default=[c.name for c in CASES])
    parser.add_argument("--rounds", type=int, default=1)
    parser.add_argument("--seed", type=int, default=20261025)
    parser.add_argument("--output", type=Path)
    parsed_args = parser.parse_args()
    if parsed_args.rounds < 1:
        parser.error("rounds must be positive")
    asyncio.run(main(parsed_args))
