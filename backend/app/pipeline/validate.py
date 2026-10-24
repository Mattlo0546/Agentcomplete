"""Invariant checks for EnhanceResponse (docs/api.md). Anything that fails here is never sent to the client."""

from itertools import pairwise

from app.pipeline.edits import apply_edits, cp_index
from app.schemas.enhance import AutocompleteResponse, MultipleChoiceResponse, NoneResponse, utf16_len
from app.settings_store import AppSettings

MAX_GHOST_UNITS = 400


class InvalidOutput(ValueError):
    """Model output violates a wire invariant."""


def validate_response(
    prompt: str,
    cursor: int,
    response: AutocompleteResponse | MultipleChoiceResponse | NoneResponse,
    settings: AppSettings,
) -> None:
    if isinstance(response, AutocompleteResponse):
        _validate_autocomplete(prompt, cursor, response, settings)
    elif isinstance(response, MultipleChoiceResponse):
        _validate_choice(prompt, response, settings)


def _validate_autocomplete(prompt: str, cursor: int, r: AutocompleteResponse, settings: AppSettings) -> None:
    length = utf16_len(prompt)
    if not settings.autocomplete_enabled:
        raise InvalidOutput("autocomplete disabled")
    if cursor != length or r.insert_at != length:
        raise InvalidOutput("autocomplete only at end of prompt")
    if not r.text.strip():
        raise InvalidOutput("empty autocomplete")
    if utf16_len(r.text) > MAX_GHOST_UNITS:
        raise InvalidOutput("autocomplete too long")


def _validate_choice(prompt: str, r: MultipleChoiceResponse, settings: AppSettings) -> None:
    if not settings.questions_enabled:
        raise InvalidOutput("questions disabled")
    if not r.question.strip():
        raise InvalidOutput("empty question")
    if not 2 <= len(r.options) <= settings.max_options:
        raise InvalidOutput(f"need 2..{settings.max_options} options")
    if len({o.id for o in r.options}) != len(r.options):
        raise InvalidOutput("duplicate option ids")
    length = utf16_len(prompt)
    results: set[str] = set()
    for option in r.options:
        if not option.edits:
            raise InvalidOutput("option without edits")
        edits = sorted(option.edits, key=lambda e: (e.start, e.end))
        for edit in edits:
            if not 0 <= edit.start <= edit.end <= length:
                raise InvalidOutput("edit out of bounds")
            if cp_index(prompt, edit.start) is None or cp_index(prompt, edit.end) is None:
                raise InvalidOutput("edit splits a surrogate pair")
        for prev, cur in pairwise(edits):
            if prev.end > cur.start or prev.start == cur.start:
                raise InvalidOutput("overlapping edits")
        result = apply_edits(prompt, option.edits)
        if result == prompt:
            raise InvalidOutput("option does not change the prompt")
        if result in results:
            raise InvalidOutput("duplicate options")
        results.add(result)
