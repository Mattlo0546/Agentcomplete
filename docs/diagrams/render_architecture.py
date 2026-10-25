"""Generate the README architecture diagram as accessible light/dark SVGs.

No rendering dependencies. Run from any directory: python3 docs/diagrams/render_architecture.py
Visual convention: solid lines are request/response; dashed lines are maintenance.
The semantic index is shown as development work until its runtime change lands on main.
"""

from html import escape
from pathlib import Path

DEST = Path(__file__).resolve().parents[1] / "assets"
THEMES = {
    "light": {
        "bg": "#ffffff",
        "panel": "#ffffff",
        "group": "#fafafa",
        "ink": "#171a1c",
        "muted": "#62686e",
        "edge": "#a5abb0",
        "faint": "#d8dcdf",
        "soft": "#f1f3f4",
        "accent": "#2d5d7b",
    },
    "dark": {
        "bg": "#0d1117",
        "panel": "#161b22",
        "group": "#10151b",
        "ink": "#e6edf3",
        "muted": "#a0a8b2",
        "edge": "#727b86",
        "faint": "#303841",
        "soft": "#212830",
        "accent": "#8cb7d3",
    },
}


def render(t):
    out = [
        f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000" viewBox="0 0 1200 1000" role="img" aria-labelledby="title desc">
<title id="title">Skill Issue — technical architecture</title>
<desc id="desc">The Next.js browser and Codex MCP client call a single FastAPI worker. Its retrieval router uses a lexical snapshot or Gemini tag and pgvector fallback; a local EmbeddingGemma index is in development. Gemini reviews candidates and generates structured output, then Python validates UTF-16 edits and freshness. Tiger Data PostgreSQL stores knowledge, vectors, and telemetry. Snowflake receives explicit offline exports. Solid arrows show requests and responses; dashed arrows show persistence and background refresh.</desc>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="{t["ink"]}" stroke-width="1.4"/></marker>
<marker id="muted-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="{t["edge"]}" stroke-width="1.4"/></marker></defs>
<style>text{{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:{t["ink"]};font-size:16px}}.title{{font-size:20px;font-weight:600}}.meta{{font-size:14px;fill:{t["muted"]}}}.label{{font-size:13px;fill:{t["muted"]};letter-spacing:1.2px}}.small{{font-size:13px;fill:{t["muted"]}}}</style>
<rect width="1200" height="1000" fill="{t["bg"]}"/>
'''
    ]

    def rect(x, y, w, h, fill="panel", stroke="faint", dash=None, r=6):
        extra = f' stroke-dasharray="{dash}"' if dash else ""
        out.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{t[fill]}" stroke="{t[stroke]}" stroke-width="1.2"{extra}/>'
        )

    def text(x, y, s, cls="", anchor=None):
        extra = f' text-anchor="{anchor}"' if anchor else ""
        out.append(f'<text x="{x}" y="{y}" class="{cls}"{extra}>{escape(s)}</text>')

    def line(d, dashed=False, both=False):
        stroke = t["edge"] if dashed else t["ink"]
        marker = "muted-arrow" if dashed else "arrow"
        out.append(
            f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="1.35"{chr(32) + "stroke-dasharray=" + chr(34) + "5 5" + chr(34) if dashed else ""} marker-end="url(#{marker})"{chr(32) + "marker-start=" + chr(34) + f"url(#{marker})" + chr(34) if both else ""}/>'
        )

    def rule(x1, y, x2):
        out.append(
            f'<path d="M{x1} {y} H{x2}" stroke="{t["faint"]}" stroke-width="1"/>'
        )

    def pill(x, y, w, s):
        rect(x, y, w, 26, fill="soft", stroke="soft", r=4)
        text(x + w / 2, y + 18, s, "small", "middle")

    text(42, 31, "CLIENTS", "label")
    text(1148, 31, "SINGLE-USER TOPOLOGY", "label", "end")
    rect(42, 52, 350, 88)
    text(62, 84, "Browser companion", "title")
    text(62, 111, "Next.js 16 / React 19", "meta")
    rect(444, 52, 350, 88)
    text(464, 84, "Codex", "title")
    text(464, 111, "MCP server + skill", "meta")
    text(910, 89, "REQUEST CONTRACT", "label")
    text(910, 115, "prompt · cursor", "meta")
    text(910, 139, "request_id · revision", "meta")
    # Worker boundary contains the actual Python responsibilities, not extra services.
    rect(42, 205, 752, 489, fill="group", stroke="edge", dash="5 5", r=8)
    text(62, 232, "BACKEND PROCESS", "label")
    text(470, 232, "Python / one worker", "meta", "middle")
    line("M217 140 V262")
    line("M619 140 V262")
    pill(141, 166, 152, "HTTP / JSON")
    pill(550, 166, 138, "MCP → HTTP")
    rect(64, 262, 708, 78, stroke="edge")
    text(86, 291, "FastAPI", "title")
    text(749, 291, "POST /v1/enhance", "", "end")
    text(86, 319, "settings cache · request cancellation · previous_request_id", "meta")
    line("M217 340 V385")
    rect(64, 385, 340, 267, stroke="edge")
    text(84, 418, "Retrieval router", "title")
    rule(64, 435, 404)
    text(84, 463, "Lexical shortlist")
    text(84, 487, "metadata overlap · top 3", "meta")
    rule(64, 505, 404)
    text(84, 532, "Tag + vector fallback")
    text(84, 556, "Gemini tags → pgvector · top 5", "meta")
    rule(64, 574, 404)
    text(84, 601, "Local semantic index †")
    text(84, 626, "EmbeddingGemma 2 / ONNX / 768d", "meta")
    # Fresh review belongs to the shared generation call.
    line("M404 463 H450")
    rect(450, 385, 322, 132, stroke="edge")
    text(470, 417, "Review + generate", "title")
    text(470, 446, "One structured Gemini call", "meta")
    text(470, 473, "Every candidate reviewed", "meta")
    text(470, 498, "keep=true AND score ≥ 0.5", "meta")
    line("M611 517 V558")
    rect(450, 558, 322, 94, stroke="edge")
    text(470, 590, "Output validation", "title")
    text(470, 617, "UTF-16 edits · source freshness", "meta")
    text(470, 638, "invalid → retry once → none", "small")
    # Return payload: explicit boundary crossing, without a line through the boxes.
    line("M450 614 H427 V674 H20 V96 H42")
    out.append(
        '<text x="14" y="547" class="small" transform="rotate(-90 14 547)">validated response</text>'
    )
    # Remote inference is outside the worker; retrieval can also invoke it.
    text(848, 232, "EXTERNAL SERVICES", "label")
    rect(848, 262, 310, 390, stroke="edge")
    text(868, 297, "Google Gemini", "title")
    rule(848, 315, 1158)
    text(868, 345, "Review / generation", "")
    text(868, 370, "gemini-3.5-flash-lite", "meta")
    line("M772 407 H848", both=True)
    pill(783, 372, 55, "HTTPS")
    rule(848, 431, 1158)
    text(868, 461, "Fallback tagging")
    text(868, 486, "gemini-3.5-flash-lite", "meta")
    text(868, 528, "Fallback embeddings")
    text(868, 553, "gemini-embedding-001", "meta")
    text(868, 580, "768d / SEMANTIC_SIMILARITY", "small")
    text(868, 624, "Invoked only when needed", "small")
    # The remote fallback route exits the retrieval box below the generation path.
    line("M404 542 H417 V710 H825 V543 H848")
    pill(579, 697, 210, "tags + embed fallback")
    # Shared source of truth; a dedicated telemetry write path is distinct from reads.
    line("M150 652 V779")
    pill(66, 730, 160, "pgvector SQL")
    line("M303 779 V652", dashed=True)
    pill(231, 730, 158, "snapshot refresh")
    text(303, 770, "10s / TTL 15s", "small", "middle")
    line("M611 652 V779", dashed=True)
    pill(620, 739, 166, "metadata + outcomes")
    rect(42, 779, 752, 146, stroke="edge")
    text(62, 813, "Tiger Data / PostgreSQL", "title")
    text(774, 813, "SOURCE OF TRUTH", "label", "end")
    rule(42, 832, 794)
    text(62, 861, "Knowledge + config")
    text(62, 887, "knowledge / app_settings", "small")
    text(62, 909, "handoff / tag", "small")
    out.append(f'<path d="M322 832 V925 M539 832 V925" stroke="{t["faint"]}"/>')
    text(342, 861, "pgvector")
    text(342, 887, "tag embeddings", "small")
    text(342, 909, "vector(768)", "small")
    text(559, 861, "TimescaleDB")
    text(559, 887, "traces / outcomes", "small")
    text(559, 909, "logs: 30-day retention", "small")
    rect(848, 779, 310, 146, stroke="edge")
    text(868, 813, "Snowflake", "title")
    text(868, 850, "ML Classification")
    text(868, 879, "Derived outcome features", "meta")
    text(868, 909, "OFFLINE · EXPLICIT TRAINING", "small")
    line("M794 852 H848", dashed=True)
    text(821, 841, "export", "small", "middle")
    text(
        42,
        958,
        "† Local semantic index: active development; main uses lexical → tag/pgvector.",
        "small",
    )
    line("M42 982 H80")
    text(90, 987, "request / response", "small")
    line("M330 982 H368", dashed=True)
    text(378, 987, "persistence / background refresh", "small")
    text(1158, 987, "2026-10-25", "small", "end")
    out.append("</svg>")
    return "\n".join(out)


if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    for name, theme in THEMES.items():
        path = DEST / f"architecture-technical-{name}.svg"
        path.write_text(render(theme))
        print(path)
