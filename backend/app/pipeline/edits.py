"""UTF-16 offset helpers. Python str indices are code points; the wire uses UTF-16 code units."""

from typing import Literal

from app.schemas.enhance import Edit, utf16_len

EditOp = Literal["replace", "insert_before", "insert_after", "append"]


def u16_offset(text: str, cp_index: int) -> int:
    """UTF-16 offset of the code-point index `cp_index` in `text`."""
    return utf16_len(text[:cp_index])


def cp_index(text: str, u16: int) -> int | None:
    """Code-point index for a UTF-16 offset, or None if out of bounds or inside a surrogate pair."""
    if u16 < 0:
        return None
    units = 0
    for i, ch in enumerate(text):
        if units == u16:
            return i
        units += 2 if ord(ch) > 0xFFFF else 1
        if units > u16:
            return None
    return len(text) if units == u16 else None


def apply_edits(text: str, edits: list[Edit]) -> str:
    """Apply non-overlapping edits (relative to one snapshot) end → start, as the client does."""
    spans: list[tuple[int, int, str]] = []
    for edit in edits:
        start, end = cp_index(text, edit.start), cp_index(text, edit.end)
        if start is None or end is None or start > end:
            raise ValueError("edit bounds invalid")
        spans.append((start, end, edit.text))
    for start, end, replacement in sorted(spans, key=lambda s: (s[0], s[1]), reverse=True):
        text = text[:start] + replacement + text[end:]
    return text


def resolve_edit(prompt: str, op: EditOp, anchor: str, text: str) -> Edit | None:
    """Turn a text-anchored model edit into a UTF-16 positioned Edit; None when the anchor is not in the prompt."""
    if op == "append":
        end = utf16_len(prompt)
        if prompt and not prompt[-1].isspace() and text[:1].isalnum():
            text = " " + text
        return Edit(start=end, end=end, text=text)
    if not anchor:
        return None
    found = prompt.find(anchor)
    if found < 0:
        return None
    start, end = u16_offset(prompt, found), u16_offset(prompt, found + len(anchor))
    if op == "replace":
        return Edit(start=start, end=end, text=text)
    point = start if op == "insert_before" else end
    return Edit(start=point, end=point, text=text)
