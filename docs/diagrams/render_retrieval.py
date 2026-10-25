"""Render the retrieval-router detail in the overview diagram's light/dark themes.

Run from any directory: python3 docs/diagrams/render_retrieval.py
Source defaults and route ordering: backend/app/pipeline/run.py.
"""

from html import escape

from render_architecture import DEST, THEMES


def render(theme):
    out = [
        f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1320" viewBox="0 0 1200 1320" role="img" aria-labelledby="title desc">
<title id="title">Skill Issue — retrieval router in detail</title>
<desc id="desc">After nonempty input and enabled-mode checks, the router tries a complete catalog, eligible lexical matching, then Gemini tags and pgvector. An unavailable route falls through; any usable Retrieval, including an empty result, goes to fresh review and generation. A shared Tiger snapshot supplies the first two routes. Final validation checks source age and mutation generation after trace backpressure; expired or changed sources return none. This diagram describes one FastAPI worker, not separately deployed retrieval services.</desc>
<defs>
<marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="{theme["ink"]}" stroke-width="1.4"/></marker>
<marker id="selected-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="{theme["accent"]}" stroke-width="1.4"/></marker>
</defs>
<style>text{{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:{theme["ink"]};font-size:15px}}.title{{font-size:20px;font-weight:600}}.meta{{font-size:14px;fill:{theme["muted"]}}}.small{{font-size:13px;fill:{theme["muted"]}}}.label{{font-size:13px;fill:{theme["muted"]};letter-spacing:1px}}.selected{{font-size:12px;fill:{theme["accent"]}}}</style>
<rect width="1200" height="1320" fill="{theme["bg"]}"/>
'''
    ]

    def text(x, y, value, cls="", anchor="start"):
        out.append(
            f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}">{escape(value)}</text>'
        )

    def rect(x, y, width, height, *, fill="panel", dashed=False):
        dash = ' stroke-dasharray="5 5"' if dashed else ""
        out.append(
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="6" '
            f'fill="{theme[fill]}" stroke="{theme["edge"]}" stroke-width="1.2"{dash}/>'
        )

    def line(path, *, selected=False):
        color = theme["accent"] if selected else theme["ink"]
        marker = "selected-arrow" if selected else "arrow"
        out.append(
            f'<path d="{path}" fill="none" stroke="{color}" stroke-width="1.4" marker-end="url(#{marker})"/>'
        )

    def card(x, y, width, height, title, lines):
        out.append(
            f'<g data-card="{escape(title)}" data-bounds="{x},{y},{width},{height}">'
        )
        rect(x, y, width, height)
        text(x + 20, y + 32, title, "title")
        for offset, label, cls in lines:
            text(x + 20, y + offset, label, cls)
        out.append("</g>")

    text(42, 38, "RETRIEVAL ROUTER", "title")
    text(1158, 38, "INSIDE ONE FASTAPI WORKER", "label", "end")
    text(
        42,
        65,
        "Choose context once; review its relevance against the current draft.",
        "meta",
    )
    card(
        42,
        88,
        1116,
        88,
        "Input: draft + UTF-16 cursor + settings + previous_request_id",
        [
            (
                63,
                "Empty draft or disabled response modes → none before retrieval. Otherwise, enter the router below.",
                "meta",
            ),
        ],
    )

    rect(42, 211, 730, 690, fill="group", dashed=True)
    text(64, 238, "DEFAULT ORDER / FIRST USABLE RESULT WINS", "label")
    line("M406 176 V211")
    line("M406 244 V262")
    card(
        64,
        262,
        684,
        156,
        "1  Complete catalog",
        [
            (60, "CATALOG_REVIEW_ENABLED · fresh complete snapshot", "meta"),
            (88, "≤16 documents AND ≤80,000 serialized context characters", ""),
            (116, "Pass every full body; no query-tag or embedding call", "meta"),
            (
                139,
                "Whole catalog exceeds bounds → fall through without truncating bodies",
                "small",
            ),
        ],
    )
    line("M406 418 V473")
    text(421, 451, "disabled / unavailable / too large", "small")
    card(
        64,
        473,
        684,
        164,
        "2  Lexical shortlist",
        [
            (60, "FAST_AUTOCOMPLETE_ENABLED · autocomplete on · cursor at end", "meta"),
            (
                88,
                "Title / summary / tag overlap gates matching; body terms rank",
                "meta",
            ),
            (116, "Weighted lexical score → up to 3 candidates", ""),
            (
                143,
                "Ineligible / no match / ambiguous shared-topic match → next route",
                "small",
            ),
        ],
    )
    line("M406 637 V692")
    text(421, 670, "no usable lexical result", "small")
    card(
        64,
        692,
        684,
        178,
        "3  Tags + pgvector",
        [
            (
                60,
                "Extract tags; compare previous draft / reuse candidates if safe",
                "meta",
            ),
            (88, "Otherwise: embed missing tags → Tiger pgvector tag search", "meta"),
            (116, "8 neighbors per tag → similarity ≥0.88 → up to 5 documents", ""),
            (
                144,
                "No query tags / stored tags → empty candidates; continue to generation",
                "small",
            ),
            (
                164,
                "Caches and previous-context reuse preserve the original source age.",
                "small",
            ),
        ],
    )

    # Every successful route feeds the same result bus and reviewer.
    for y in (340, 555, 781):
        line(f"M748 {y} H808", selected=True)
        text(778, y - 12, "usable", "selected", "middle")
    line("M808 340 V1038 H307 V1070", selected=True)
    text(832, 1044, "Retrieval → fresh review", "selected")

    card(
        852,
        262,
        306,
        220,
        "Source snapshot",
        [
            (63, "Tiger → process memory", "meta"),
            (91, "Used by routes 1 / 2", "meta"),
            (127, "≤256 docs / ≤2M chars", ""),
            (155, "Refresh 10s / expiry 15s", "meta"),
            (183, "Committed writes invalidate", "small"),
        ],
    )
    card(
        852,
        517,
        306,
        212,
        "Shared result",
        [
            (63, "candidates + tag_similarity", "small"),
            (91, "fetched_at + generation", "meta"),
            (119, "complete_catalog flag", "meta"),
            (155, "Candidate: body / tags", "meta"),
            (183, "Empty ≠ unavailable", ""),
        ],
    )
    card(
        852,
        764,
        306,
        258,
        "When routing stops",
        [
            (63, "Usable result → review", "meta"),
            (91, "Empty result → draft alone", "small"),
            (127, "All candidates rejected?", "meta"),
            (155, "No second retrieval pass.", "small"),
            (191, "Database / provider errors", "small"),
            (219, "can fail the request.", "small"),
            (242, "Fallback is not a retry loop.", "small"),
        ],
    )

    card(
        42,
        1070,
        530,
        172,
        "Fresh review + generation",
        [
            (63, "One Gemini call reviews every selected candidate", "meta"),
            (91, "Use only keep=true AND relevance score ≥0.5", ""),
            (119, "Full catalog bodies OR bounded shortlist excerpts", "meta"),
            (147, "No kept candidates → generate from the draft alone", "meta"),
        ],
    )
    line("M572 1156 H628")
    card(
        628,
        1070,
        530,
        172,
        "Validate + final freshness check",
        [
            (63, "Invalid output → retry once → none if invalid again", "meta"),
            (91, "Wait for trace capacity; then check source age/version", "small"),
            (119, "Expired / changed → discard suggestion, return none", "meta"),
            (147, "Current → return validated response; queue trace", "meta"),
        ],
    )
    text(
        42,
        1277,
        "Complete catalog → lexical shortlist → tags / pgvector. Every route receives fresh review.",
        "small",
    )
    text(
        42,
        1305,
        "Arrows down: try next route. Blue arrows: accept a usable result.",
        "small",
    )
    text(1158, 1305, "source defaults · 2026-10-25", "small", "end")
    out.append("</svg>")
    return "\n".join(out)


if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    for name, theme in THEMES.items():
        path = DEST / f"retrieval-router-{name}.svg"
        path.write_text(render(theme))
        print(path)
