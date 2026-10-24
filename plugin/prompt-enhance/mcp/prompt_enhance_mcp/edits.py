"""Apply enhance edits. Positions are UTF-16 code units, ranges half-open [start, end)."""

from typing import Any


def apply_edits(prompt: str, edits: list[dict[str, Any]]) -> str:
    """Apply non-overlapping edits end -> start so earlier offsets stay valid."""
    units = prompt.encode("utf-16-le")
    total = len(units) // 2
    ordered = sorted(edits, key=lambda e: (e["start"], e["end"]), reverse=True)
    prev_start = total
    for e in ordered:
        start, end = e["start"], e["end"]
        if not 0 <= start <= end <= prev_start:
            raise ValueError(f"invalid or overlapping edit [{start}, {end})")
        units = units[: start * 2] + e["text"].encode("utf-16-le", "surrogatepass") + units[end * 2 :]
        prev_start = start
    return units.decode("utf-16-le", "surrogatepass")


def utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le", "surrogatepass")) // 2
