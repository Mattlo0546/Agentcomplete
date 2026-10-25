"""Lay the trimmed voice lines on the timeline, duck the music under them, and
write the caption markup that matches each line.

Usage: python3 build_audio.py <project_dir>
Writes assets/mix.mp3 and prints the caption <div>s for index.html.
"""
import os
import subprocess
import sys

proj = sys.argv[1]
A = os.path.join(proj, "assets")
END = 60.0

# (voice file, start seconds, caption html)
LINES = [
    ("00", 0.15, "This is <em>Skill Issue.</em>"),
    ("01", 3.75, "Your next thought, with the <em>right context.</em>"),
    ("02", 7.6, "Great ideas. <em>Missing context.</em>"),
    ("03", 10.3, "Your <em>skills</em> get buried."),
    ("04", 12.1, "Your <em>stack</em> gets retyped."),
    ("05", 14.55, "And the <em>details</em> slip away."),
    ("06", 16.95, "<em>Not anymore.</em>"),
    ("07", 18.45, "The <em>right context,</em> right as you type."),
    ("08", 21.7, "Your <em>skills, stack and knowledge.</em> Pulled in instantly."),
    ("09", 25.55, "It finishes the thought <em>for you.</em>"),
    ("10", 27.6, "Hit <em>Tab.</em> Done."),
    ("11", 30.1, "Here it is. <em>Live.</em>"),
    ("12", 32.8, "Type the <em>big idea.</em>"),
    ("13", 34.55, "Send it with <em>full context.</em>"),
    ("14", 37.6, "Tag. <em>Retrieve.</em> <em>Judge.</em> Write."),
    ("15", 41.1, "Powered by <em>Gemini, Tiger Data</em> and <em>Snowflake.</em>"),
    ("16", 45.4, "Hand it to <em>Claude, Codex,</em> or any <em>MCP</em> tool."),
    ("18", 50.7, "Stop fighting your tools."),
    ("19", 53.0, "Go build <em>something massive.</em>"),
    ("20", 55.9, "Skill Issue. <em>Context clicks.</em>"),
]


def length(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))


paths = [os.path.join(A, "vo", "trim", f"{f}.mp3") for f, _, _ in LINES]
lens = [length(p) for p in paths]

# voice bus: every line delayed to its start, summed
inputs = sum((["-i", p] for p in paths), [])
delays = ";".join(f"[{i}]adelay={int(s * 1000)}:all=1,apad=whole_dur={END}[v{i}]" for i, (_, s, _) in enumerate(LINES))
mix_in = "".join(f"[v{i}]" for i in range(len(LINES)))
vo = os.path.join(A, "vo_track.wav")
subprocess.run(
    ["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", f"{delays};{mix_in}amix=inputs={len(LINES)}:normalize=0,atrim=0:{END}[out]", "-map", "[out]", "-ac", "2", "-ar", "44100", vo],
    check=True,
)

# music ducked under the voice (sidechain), then voice on top
subprocess.run(
    [
        "ffmpeg", "-loglevel", "error", "-y", "-i", os.path.join(A, "bgm.mp3"), "-i", vo, "-filter_complex",
        "[1]asplit=2[sc][voice];"
        "[0]volume=0.55[m];"
        "[m][sc]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350:makeup=1[duck];"
        "[voice]volume=1.6,acompressor=threshold=0.1:ratio=3:attack=5:release=80[vv];"
        "[duck][vv]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]",
        "-map", "[out]", "-t", str(END), "-b:a", "192k", os.path.join(A, "mix.mp3"),
    ],
    check=True,
)
os.remove(vo)

for i, ((f, s, cap), n) in enumerate(zip(LINES, lens)):
    nxt = LINES[i + 1][1] if i + 1 < len(LINES) else END
    end = min(nxt - 0.08, s + n + 0.5)
    print(f'      <div class="cap clip" data-start="{s}" data-duration="{end - s:.2f}" data-track-index="1"><div class="cap-pill">{cap}</div></div>')
