"""Unit tests for UTF-16 offsets, anchored edits, conversion and invariant validation (no network)."""

import pytest

from app.pipeline.edits import apply_edits, cp_index, resolve_edit, u16_offset
from app.pipeline.features import prompt_bucket
from app.pipeline.generate import Generation, ModelEdit, ModelOption, allowed_types, excerpt, to_response
from app.pipeline.tags import normalize_tag
from app.pipeline.validate import InvalidOutput, validate_response
from app.schemas.enhance import AutocompleteResponse, Edit, MultipleChoiceResponse, Option, utf16_len
from app.settings_store import AppSettings

EMOJI = "Fix 😀 bug in 日本語 parser"  # 😀 is 2 UTF-16 units, each CJK char is 1
SETTINGS = AppSettings()


def test_offsets_with_astral_and_cjk() -> None:
    assert utf16_len(EMOJI) == len(EMOJI) + 1
    cp = EMOJI.index("bug")
    assert u16_offset(EMOJI, cp) == cp + 1
    assert cp_index(EMOJI, cp + 1) == cp
    assert cp_index(EMOJI, EMOJI.index("😀") + 1) is None  # inside the surrogate pair
    assert cp_index(EMOJI, utf16_len(EMOJI)) == len(EMOJI)
    assert cp_index(EMOJI, utf16_len(EMOJI) + 1) is None


def test_resolve_replace_after_emoji() -> None:
    edit = resolve_edit(EMOJI, "replace", "日本語", "JSON")
    assert edit is not None
    assert (edit.start, edit.end) == (EMOJI.index("日") + 1, EMOJI.index("日") + 4)
    assert apply_edits(EMOJI, [edit]) == "Fix 😀 bug in JSON parser"


def test_resolve_inserts_and_append() -> None:
    before = resolve_edit(EMOJI, "insert_before", "parser", "streaming ")
    after = resolve_edit(EMOJI, "insert_after", "😀", "!")
    append = resolve_edit(EMOJI, "append", "", "Add tests.")
    assert before and after and append
    assert append.start == append.end == utf16_len(EMOJI)
    assert apply_edits(EMOJI, [before, after, append]) == "Fix 😀! bug in 日本語 streaming parser Add tests."
    assert resolve_edit(EMOJI, "replace", "missing", "x") is None
    assert resolve_edit(EMOJI, "replace", "", "x") is None


def test_apply_edits_rejects_split_surrogate() -> None:
    start = EMOJI.index("😀") + 1
    with pytest.raises(ValueError):
        apply_edits(EMOJI, [Edit(start=start, end=start, text="x")])


def _choice(*options: list[Edit], ids: list[str] | None = None) -> MultipleChoiceResponse:
    ids = ids or [f"o{i}" for i in range(len(options))]
    return MultipleChoiceResponse(
        request_id="r",
        prompt_revision=1,
        question="Which format?",
        options=[Option(id=i, label=i, edits=e) for i, e in zip(ids, options, strict=True)],
    )


def test_validate_multiple_choice() -> None:
    end = utf16_len(EMOJI)
    ok = _choice([Edit(start=end, end=end, text=" A")], [Edit(start=end, end=end, text=" B")])
    validate_response(EMOJI, 0, ok, SETTINGS)
    bad_cases = [
        _choice([Edit(start=end, end=end, text=" A")], [Edit(start=end, end=end, text=" B")], ids=["x", "x"]),
        _choice([Edit(start=0, end=end + 1, text="A")], [Edit(start=end, end=end, text=" B")]),
        _choice([Edit(start=0, end=3, text="Fix")], [Edit(start=end, end=end, text=" B")]),  # no change
        _choice([Edit(start=0, end=5, text="a"), Edit(start=3, end=6, text="b")], [Edit(start=0, end=0, text="c")]),
        _choice([Edit(start=0, end=0, text="a"), Edit(start=0, end=0, text="b")], [Edit(start=0, end=0, text="c")]),
        _choice([Edit(start=5, end=5, text="x")], [Edit(start=0, end=0, text="c")]),  # splits 😀
        _choice([Edit(start=end, end=end, text=" A")], [Edit(start=end, end=end, text=" A")]),  # duplicates
    ]
    for case in bad_cases:
        with pytest.raises(InvalidOutput):
            validate_response(EMOJI, 0, case, SETTINGS)
    with pytest.raises(InvalidOutput):
        validate_response(EMOJI, 0, ok, AppSettings(questions_enabled=False))
    many = _choice(*[[Edit(start=end, end=end, text=f" {i}")] for i in range(3)])
    with pytest.raises(InvalidOutput):
        validate_response(EMOJI, 0, many, AppSettings(max_options=2))


def test_validate_autocomplete() -> None:
    end = utf16_len(EMOJI)
    good = AutocompleteResponse(request_id="r", prompt_revision=1, insert_at=end, text=" and add tests")
    validate_response(EMOJI, end, good, SETTINGS)
    for cursor, response, settings in [
        (end - 1, good, SETTINGS),
        (end, good.model_copy(update={"insert_at": end - 1}), SETTINGS),
        (end, good.model_copy(update={"text": "  "}), SETTINGS),
        (end, good, AppSettings(autocomplete_enabled=False)),
    ]:
        with pytest.raises(InvalidOutput):
            validate_response(EMOJI, cursor, response, settings)


def test_to_response_converts_anchors_and_ids() -> None:
    gen = Generation(
        type="multiple_choice",
        autocomplete_text="",
        question="Output format?",
        options=[
            ModelOption(id="Table!", label="Table", edits=[ModelEdit(op="append", anchor="", text="Use a table.")]),
            ModelOption(id="table", label="List", edits=[ModelEdit(op="replace", anchor="日本語", text="CSV")]),
        ],
    )
    response = to_response(gen, EMOJI, "r", 3, 4)
    assert isinstance(response, MultipleChoiceResponse)
    assert [o.id for o in response.options] == ["table", "table-2"]
    assert response.options[0].edits[0].text == " Use a table."
    validate_response(EMOJI, 0, response, SETTINGS)
    gen.options[1].edits[0].anchor = "not there"
    with pytest.raises(InvalidOutput):
        to_response(gen, EMOJI, "r", 3, 4)


def test_allowed_types_and_helpers() -> None:
    assert allowed_types("abc", 3, SETTINGS) == ["autocomplete", "multiple_choice", "none"]
    assert allowed_types("abc", 1, SETTINGS) == ["multiple_choice", "none"]
    assert allowed_types("abc", 3, AppSettings(autocomplete_enabled=False, questions_enabled=False)) == ["none"]
    assert normalize_tag("  Postgres Migrations! ") == "postgres-migrations"
    assert normalize_tag("x" * 80) == "x" * 64
    assert [prompt_bucket(n) for n in (0, 39, 40, 119, 120, 399, 400, 1199, 1200)] == [
        "xs", "xs", "s", "s", "m", "m", "l", "l", "xl",
    ]  # fmt: skip
    body = "Intro text.\n\nUse exponential retry with jitter.\n\n" + "filler " * 400
    assert "retry" in excerpt(body, ["retry"], 200)
    assert len(excerpt(body, ["retry"], 200)) <= 200
