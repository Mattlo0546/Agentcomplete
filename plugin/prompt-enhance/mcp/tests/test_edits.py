import pytest

from prompt_enhance_mcp.edits import apply_edits, utf16_len


def test_end_to_start_ordering():
    out = apply_edits("hello world", [{"start": 0, "end": 5, "text": "HI"}, {"start": 6, "end": 11, "text": "there!"}])
    assert out == "HI there!"


def test_insert_and_delete():
    assert apply_edits("abc", [{"start": 3, "end": 3, "text": "d"}, {"start": 0, "end": 1, "text": ""}]) == "bcd"


def test_utf16_units_with_astral_chars():
    prompt = "a😀b"  # emoji = 2 units; b at 3
    assert utf16_len(prompt) == 4
    assert apply_edits(prompt, [{"start": 3, "end": 4, "text": "B"}, {"start": 1, "end": 3, "text": "-"}]) == "a-B"
    assert apply_edits(prompt, [{"start": 4, "end": 4, "text": "😀"}]) == "a😀b😀"


def test_overlap_and_bounds_rejected():
    with pytest.raises(ValueError):
        apply_edits("abcdef", [{"start": 0, "end": 4, "text": "x"}, {"start": 3, "end": 5, "text": "y"}])
    with pytest.raises(ValueError):
        apply_edits("abc", [{"start": 2, "end": 9, "text": "x"}])
