"""Generate the README architecture diagram as accessible light/dark SVGs.

No rendering dependencies. Run from any directory: python3 docs/diagrams/render_architecture.py
Visual convention: solid lines are request/response; dashed lines are maintenance.
Route ordering and bounds describe the current source defaults.
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
        f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1280" viewBox="0 0 1200 1280" role="img" aria-labelledby="title desc">
<title id="title">Skill Issue — technical architecture</title>
<desc id="desc">The browser and Codex MCP client call one FastAPI worker. The first usable retrieval route wins: complete catalog review (16 items, 80,000 serialized characters), eligible lexical shortlist, then Gemini tags and pgvector. One Gemini call reviews candidates and generates output; Python validates reviews, suffixes, edits, and source freshness. Knowledge ingestion, handoff, and telemetry use Tiger PostgreSQL. Explicit outcome export and classifier training use Snowflake outside suggestion requests. Solid arrows show requests or synchronous data access; dashed arrows show refresh or background persistence.</desc>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="{t["ink"]}" stroke-width="1.4"/></marker>
<marker id="muted-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="{t["edge"]}" stroke-width="1.4"/></marker></defs>
<style>text{{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:{t["ink"]};font-size:16px}}.title{{font-size:20px;font-weight:600}}.meta{{font-size:14px;fill:{t["muted"]}}}.label{{font-size:13px;fill:{t["muted"]};letter-spacing:1.2px}}.small{{font-size:13px;fill:{t["muted"]}}}</style>
<rect width="1200" height="1280" fill="{t["bg"]}"/>
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
    text(1158, 31, "SINGLE USER / SINGLE API WORKER", "label", "end")
    rect(42, 52, 350, 88)
    text(62, 84, "Browser companion", "title")
    text(62, 111, "Next.js 16 / React 19", "meta")
    rect(444, 52, 350, 88)
    text(464, 84, "Codex", "title")
    text(464, 111, "MCP server + skill", "meta")
    text(848, 77, "REQUEST CONTRACT", "label")
    text(848, 105, "draft · UTF-16 cursor", "meta")
    text(848, 131, "request_id · revision", "meta")

    rect(42, 205, 1116, 630, fill="group", stroke="edge", dash="5 5", r=8)
    text(64, 232, "BACKEND PROCESS", "label")
    text(1136, 232, "Python / in-process routing, caches and validation", "meta", "end")
    line("M217 140 V262")
    line("M619 140 V262")
    pill(141, 166, 152, "HTTP / JSON")
    pill(550, 166, 138, "MCP → HTTP")
    rect(64, 262, 1072, 78, stroke="edge")
    text(86, 291, "FastAPI", "title")
    text(
        1114,
        291,
        "/v1/enhance · /knowledge · /handoff · /outcomes · /analytics",
        "meta",
        "end",
    )
    text(
        86,
        319,
        "settings cache · input bounds · disconnect cancellation · previous draft context",
        "meta",
    )
    line("M249 340 V385")

    rect(64, 385, 370, 405, stroke="edge")
    text(84, 417, "Context selection", "title")
    text(84, 443, "FIRST USABLE ROUTE WINS", "label")
    rule(64, 460, 434)
    text(84, 488, "1  Complete catalog", "title")
    text(84, 514, "≤16 items / ≤80,000 serialized chars", "meta")
    text(84, 537, "All bodies · no tag / embedding call", "meta")
    rule(64, 554, 434)
    text(84, 583, "2  Lexical shortlist")
    text(84, 608, "Eligible end-cursor input · top 3", "meta")
    rule(64, 625, 434)
    text(84, 654, "3  Tags + pgvector")
    text(84, 679, "Gemini tag vectors · ≥0.88 · top 5", "meta")
    text(84, 702, "Safe reuse or fresh tag retrieval", "small")
    rule(64, 719, 434)
    text(84, 748, "Fresh review on every route")
    text(84, 774, "No candidates → draft alone", "meta")

    line("M434 488 H478")
    rect(478, 385, 300, 155, stroke="edge")
    text(498, 417, "Review + generate", "title")
    text(498, 447, "One structured Gemini call", "meta")
    text(498, 474, "Every candidate reviewed", "meta")
    text(498, 501, "keep=true AND score ≥ 0.5", "meta")
    text(498, 524, "No kept items → draft alone", "small")
    line("M778 462 H822")
    rect(822, 385, 314, 155, stroke="edge")
    text(842, 417, "Validate + return", "title")
    text(842, 447, "Reviews · suffix · UTF-16 edits", "meta")
    text(842, 474, "Invalid → retry once → none", "meta")
    text(842, 501, "Wait for trace capacity", "meta")
    text(842, 524, "Stale source → discard", "small")
    line("M1136 462 H1180 V16 H217 V52")
    out.append(
        '<text x="1194" y="450" class="small" transform="rotate(-90 1194 450)">validated response to client</text>'
    )

    text(498, 590, "SUPPORTING API PIPELINES", "label")
    rect(478, 610, 300, 180, stroke="edge")
    text(498, 644, "Knowledge lifecycle", "title")
    text(498, 674, "Gemini summary + tags", "meta")
    text(498, 700, "Run concurrently; embed tags", "meta")
    text(498, 726, "Atomic knowledge / tag save", "meta")
    text(498, 752, "Commit → invalidate caches", "meta")
    text(498, 775, "SSE progress; PATCH / DELETE", "small")
    rect(822, 610, 314, 180, stroke="edge")
    text(842, 644, "Handoff + telemetry", "title")
    text(842, 674, "Store / fetch latest prompt", "meta")
    text(842, 700, "Trace + use counts: async", "meta")
    text(842, 726, "Outcomes: separate API writes", "meta")
    text(842, 752, "Metadata logs; bounded queue", "meta")
    text(842, 775, "MCP reads handoff via API", "small")

    # Provider calls and source maintenance cross the worker boundary.
    line("M227 790 V915")
    line("M628 540 V565 H456 V851 H227 V915")
    pill(80, 866, 294, "Gemini calls: review / fallback")
    line("M540 915 V889 H446 V766 H434", dashed=True)
    text(468, 883, "snapshot refresh", "small")
    line("M414 790 V902 H500 V915")
    text(382, 815, "SQL", "small")
    line("M688 790 V915", both=True)
    pill(620, 843, 135, "Tiger access")
    line("M979 790 V865 H808 V915", dashed=True)
    text(852, 853, "handoff / telemetry", "small")

    text(42, 909, "EXTERNAL SERVICES", "label")
    rect(42, 935, 370, 270, stroke="edge")
    # Extend the two provider paths to the external service box.
    line("M227 915 V935")
    text(62, 970, "Google Gemini", "title")
    rule(42, 990, 412)
    text(62, 1021, "gemini-3.5-flash-lite")
    text(62, 1047, "Review + generation / tag inference", "meta")
    text(62, 1073, "Knowledge summary + tag generation", "meta")
    rule(42, 1092, 412)
    text(62, 1122, "gemini-embedding-001")
    text(62, 1148, "Tag embeddings / 768 dimensions", "meta")
    text(62, 1174, "Tags matched through Tiger pgvector", "meta")
    text(62, 1195, "GENERATION REMAINS REMOTE", "small")

    rect(478, 915, 420, 290, stroke="edge")
    text(498, 950, "Tiger Data / PostgreSQL", "title")
    text(498, 977, "SOURCE OF TRUTH", "label")
    rule(478, 995, 898)
    text(498, 1025, "knowledge · tag · knowledge_tag")
    text(498, 1052, "app_settings · handoff · analytics_state", "small")
    text(498, 1090, "pgvector: tag vectors / 768d")
    text(498, 1128, "TimescaleDB: traces / outcomes / logs", "meta")
    text(498, 1156, "Snapshot: refresh 10s / expire 15s", "meta")
    text(498, 1184, "Logs + traces: 30-day retention", "meta")

    rect(948, 915, 210, 290, stroke="edge")
    text(968, 950, "Snowflake", "title")
    text(968, 977, "OFFLINE ANALYTICS", "label")
    rule(948, 995, 1158)
    text(968, 1025, "Derived features", "meta")
    text(968, 1052, "Explicit export", "meta")
    text(968, 1090, "ML Classification", "meta")
    text(968, 1117, "Explicit training", "meta")
    text(968, 1156, "≥20 labeled requests", "small")
    text(968, 1184, "Both outcome classes", "small")
    line("M898 1045 H948", dashed=True)
    text(923, 1033, "export", "small", "middle")

    text(
        42,
        1234,
        "Defaults shown. Complete catalog, then lexical shortlist, then tags / pgvector.",
        "small",
    )
    line("M42 1261 H80")
    text(90, 1266, "request / data access", "small")
    line("M350 1261 H388", dashed=True)
    text(398, 1266, "refresh / persistence / export", "small")
    text(1158, 1266, "source defaults · 2026-10-25", "small", "end")
    out.append("</svg>")
    return "\n".join(out)


if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    for name, theme in THEMES.items():
        path = DEST / f"architecture-technical-{name}.svg"
        path.write_text(render(theme))
        print(path)
