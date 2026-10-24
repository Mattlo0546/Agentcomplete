"""Derived features (docs/api.md "Derived features"): numbers and enums only, never text."""

from typing import Any

from app.pipeline.generate import WireResponse
from app.pipeline.judge import Judged
from app.pipeline.tags import TagExtraction
from app.schemas.enhance import MultipleChoiceResponse, utf16_len


def prompt_bucket(units: int) -> str:
    for limit, name in ((40, "xs"), (120, "s"), (400, "m"), (1200, "l")):
        if units < limit:
            return name
    return "xl"


def derive_features(
    prompt: str,
    extraction: TagExtraction | None,
    tag_similarity: dict[str, float],
    judged: list[Judged],
    response: WireResponse,
    latency_ms: int,
) -> dict[str, Any]:
    kept = [j.score for j in judged if j.kept]
    units = utf16_len(prompt)
    options = response.options if isinstance(response, MultipleChoiceResponse) else []
    missing = list(extraction.missing_constraints) if extraction else []
    return {
        "task_type": extraction.task_type if extraction else "other",
        "missing_constraints": missing,
        "n_missing_constraints": len(missing),
        "prompt_units": units,
        "prompt_bucket": prompt_bucket(units),
        "n_tags": len(extraction.tags) if extraction else 0,
        "n_candidates": len(judged),
        "n_kept": len(kept),
        "top_score": max((j.score for j in judged), default=0.0),
        "mean_kept_score": round(sum(kept) / len(kept), 4) if kept else 0.0,
        "top_tag_similarity": max(tag_similarity.values(), default=0.0),
        "general": not kept,
        "suggestion_type": response.type,
        "n_options": len(options),
        "n_edits": sum(len(o.edits) for o in options),
        "latency_ms": latency_ms,
    }
