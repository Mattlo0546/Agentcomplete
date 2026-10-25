"""Ephemeral completed-request context for conservative reuse across edits.

Only process memory holds prompt text. Retrieval age is anchored to the original database read,
not the newest request, and every reuse still requires a fresh model review of the candidates.
"""

from dataclasses import dataclass

from app.config import get_settings
from app.pipeline.cache import TTLCache
from app.pipeline.retrieve import RETRIEVAL_TTL_S, Retrieval, is_fresh
from app.pipeline.tags import TagExtraction, visible_comparison


def model_fingerprint() -> tuple[str | int, ...]:
    settings = get_settings()
    return (
        settings.tag_model,
        settings.judge_model,
        settings.generate_model,
        settings.autocomplete_model,
        settings.embed_model,
        settings.embed_dims,
    )


@dataclass(frozen=True)
class DraftContext:
    prompt: str
    extraction: TagExtraction
    retrieval: Retrieval
    models: tuple[str | int, ...]


_contexts: TTLCache[str, DraftContext] = TTLCache(128, RETRIEVAL_TTL_S)


def current(context: DraftContext) -> bool:
    return context.models == model_fingerprint() and is_fresh(context.retrieval)


def previous(request_id: str | None) -> DraftContext | None:
    context = _contexts.get(request_id) if request_id else None
    return context if context is not None and current(context) else None


def forget(request_id: str) -> None:
    # A reused/colliding request id must never leave an older snapshot available after failure.
    _contexts.discard(request_id)


def remember(
    request_id: str,
    prompt: str,
    extraction: TagExtraction,
    retrieval: Retrieval,
    *,
    models: tuple[str | int, ...] | None = None,
) -> None:
    forget(request_id)
    models = models or model_fingerprint()
    if retrieval.candidates and is_fresh(retrieval) and models == model_fingerprint():
        _contexts.put(request_id, DraftContext(prompt, extraction.model_copy(deep=True), retrieval, models))


def can_reuse(context: DraftContext, prompt: str, extraction: TagExtraction) -> bool:
    """A model's explicit approval is necessary, but changed tags/task independently veto it.

    Missing-constraint labels are recomputed for generation, not used as a second semantic classifier:
    their wording-level ambiguity can change even on an otherwise identical draft.
    """
    return (
        current(context)
        and visible_comparison(context.prompt, prompt)
        and extraction.reuse_knowledge
        and set(extraction.tags) == set(context.extraction.tags)
        and extraction.task_type == context.extraction.task_type
    )
