"""Step 4: generation with the strong model, converted to the UTF-16 wire schema in Python."""

import re
from typing import Literal

from pydantic import BaseModel

from app.config import get_settings
from app.llm import gemini
from app.pipeline.edits import EditOp, resolve_edit
from app.pipeline.prompts import GENERATE_SYSTEM
from app.pipeline.retrieve import Candidate
from app.pipeline.tags import TagExtraction
from app.pipeline.validate import InvalidOutput
from app.schemas.enhance import (
    AutocompleteResponse,
    Edit,
    MultipleChoiceResponse,
    NoneResponse,
    Option,
    utf16_len,
)
from app.settings_store import AppSettings

EXCERPT_CHARS = 1200
KNOWLEDGE_BUDGET_CHARS = 6000
COMPLETE_CATALOG_MAX_DOCUMENTS = 64
COMPLETE_CATALOG_MAX_CHARS = 80_000

WireResponse = AutocompleteResponse | MultipleChoiceResponse | NoneResponse


class ModelEdit(BaseModel):
    op: EditOp
    anchor: str
    text: str


class ModelOption(BaseModel):
    id: str
    label: str
    edits: list[ModelEdit]


class Generation(BaseModel):
    type: Literal["autocomplete", "multiple_choice", "none"]
    autocomplete_text: str
    completes_partial_word: bool
    question: str
    options: list[ModelOption]


def allowed_types(prompt: str, cursor: int, settings: AppSettings) -> list[str]:
    types = ["none"]
    if settings.autocomplete_enabled and cursor == utf16_len(prompt):
        types.insert(0, "autocomplete")
    if settings.questions_enabled:
        types.insert(-1, "multiple_choice")
    return types


def excerpt(body: str, tags: list[str], limit: int = EXCERPT_CHARS) -> str:
    """Most tag-relevant paragraphs of a body, kept in original order, bounded to `limit` chars."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    words = {w for tag in tags for w in tag.split("-") if len(w) > 2}
    scored = sorted(range(len(paragraphs)), key=lambda i: (-sum(p in paragraphs[i].lower() for p in words), i))
    chosen: list[int] = []
    used = 0
    for i in scored:
        if used + len(paragraphs[i]) > limit and chosen:
            continue
        chosen.append(i)
        used += len(paragraphs[i])
        if used >= limit:
            break
    return "\n\n".join(paragraphs[i] for i in sorted(chosen))[:limit]


class CatalogReviewTooLarge(ValueError):
    """The complete source cannot fit the explicitly bounded catalog review."""


def complete_knowledge_context(knowledge: list[Candidate]) -> str:
    """Render all source bodies exactly, or reject the whole catalog; never shorten individual items.

    Selection uses this same renderer, so the bound includes metadata, wrappers,
    candidate indices and separators exactly as sent to the model.
    """
    if len(knowledge) > COMPLETE_CATALOG_MAX_DOCUMENTS:
        raise CatalogReviewTooLarge("complete catalog exceeds document bound")
    blocks: list[str] = []
    characters = 0
    for index, item in enumerate(knowledge):
        block = "\n".join(
            [
                f'<knowledge candidate="{index}" kind="{item.kind}">',
                f"Title: {item.title}",
                f"Summary: {item.summary}",
                f"Body:\n{item.body}",
                "</knowledge>",
            ]
        )
        characters += len(block) + bool(blocks)
        if characters > COMPLETE_CATALOG_MAX_CHARS:
            raise CatalogReviewTooLarge("complete catalog exceeds serialized character bound")
        blocks.append(block)
    return "\n".join(blocks)


def build_contents(
    prompt: str,
    cursor: int,
    settings: AppSettings,
    extraction: TagExtraction | None,
    knowledge: list[Candidate],
    *,
    response_types: list[str] | None = None,
    full_bodies: bool = False,
) -> str:
    parts = [
        "<settings>",
        f"allowed_types: {', '.join(response_types or allowed_types(prompt, cursor, settings))}",
        f"max_options: {settings.max_options}",
        f"cursor_at_end: {str(cursor == utf16_len(prompt)).lower()}",
        "</settings>",
    ]
    if extraction:
        parts += [
            "<task_features>",
            f"task_type: {extraction.task_type}",
            f"missing_constraints: {', '.join(extraction.missing_constraints) or 'none'}",
            "</task_features>",
        ]
    if knowledge and full_bodies:
        parts.append(complete_knowledge_context(knowledge))
    elif knowledge:
        budget = KNOWLEDGE_BUDGET_CHARS
        for index, item in enumerate(knowledge):
            # Direct retrieval may match a later source chunk. Show that complete bounded
            # chunk instead of silently replacing its evidence with the document's opening.
            text = (
                item.evidence_excerpt[: min(1800, max(budget, 0))]
                if item.evidence_excerpt is not None
                else excerpt(
                    item.body,
                    extraction.tags if extraction else item.matched_tags,
                    min(EXCERPT_CHARS, max(budget, 0)),
                )
            )
            budget -= len(text)
            parts += [
                f'<knowledge candidate="{index}" kind="{item.kind}">',
                f"Title: {item.title}",
                f"Summary: {item.summary}",
                f"Excerpt:\n{text}",
                "</knowledge>",
            ]
    else:
        parts.append("<knowledge>none: do a general enhancement from the draft alone</knowledge>")
    parts += ["<draft_prompt>", prompt, "</draft_prompt>"]
    return "\n".join(parts)


async def generate(contents: str, feedback: str | None = None) -> Generation:
    if feedback:
        contents += f"\n<previous_attempt_rejected>{feedback}. Fix this.</previous_attempt_rejected>"
    return await gemini.generate_structured(
        operation="enhance.generate",
        model=get_settings().generate_model,
        system=GENERATE_SYSTEM,
        contents=contents,
        schema=Generation,
        temperature=0.3,
        thinking_level="minimal",
        max_output_tokens=2048,
    )


def _option_id(raw: str, index: int, seen: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")[:32] or f"option-{index + 1}"
    candidate, n = base, 2
    while candidate in seen:
        candidate, n = f"{base}-{n}", n + 1
    seen.add(candidate)
    return candidate


def join_suffix(prompt: str, suffix: str, completes_partial_word: bool) -> str:
    """Add the word gap the model sometimes omits ("…backoff and" + "jitter" → " jitter") unless it is
    finishing a half-typed word ("…retr" + "y with backoff")."""
    if not completes_partial_word and prompt and suffix and prompt[-1].isalnum() and suffix[0].isalnum():
        return f" {suffix}"
    return suffix


def to_response(gen: Generation, prompt: str, request_id: str, prompt_revision: int, max_options: int) -> WireResponse:
    """Convert anchored model output to wire positions. Raises InvalidOutput when anchors do not resolve."""
    if gen.type == "none":
        return NoneResponse(request_id=request_id, prompt_revision=prompt_revision)
    if gen.type == "autocomplete":
        return AutocompleteResponse(
            request_id=request_id,
            prompt_revision=prompt_revision,
            insert_at=utf16_len(prompt),
            text=join_suffix(prompt, gen.autocomplete_text, gen.completes_partial_word),
        )
    seen: set[str] = set()
    options: list[Option] = []
    for index, model_option in enumerate(gen.options[:max_options]):
        edits: list[Edit] = []
        for model_edit in model_option.edits:
            edit = resolve_edit(prompt, model_edit.op, model_edit.anchor, model_edit.text)
            if edit is None:
                raise InvalidOutput(f"anchor not found in draft for option {index + 1}")
            edits.append(edit)
        if not edits:
            raise InvalidOutput(f"option {index + 1} has no edits")
        label = model_option.label.strip()[:120] or f"Option {index + 1}"
        options.append(Option(id=_option_id(model_option.id, index, seen), label=label, edits=edits))
    if len(options) < 2:
        raise InvalidOutput("multiple_choice needs at least 2 options")
    return MultipleChoiceResponse(
        request_id=request_id, prompt_revision=prompt_revision, question=gen.question.strip(), options=options
    )
