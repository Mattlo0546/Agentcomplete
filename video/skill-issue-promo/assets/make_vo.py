"""Generate one ElevenLabs voice line per caption in index.html.

Reads ELEVENLABS_API_KEY from the environment. Writes assets/vo/NN.mp3 and
prints each line's spoken length next to its caption slot.
Usage: python3 make_vo.py <project_dir> [model]
"""
import html
import json
import os
import re
import subprocess
import sys
import urllib.request

VOICE = "pFZP5JQG7iQjIQuC4Bku"  # Lily — velvety, confident
proj = sys.argv[1]
model = sys.argv[2] if len(sys.argv) > 2 else "eleven_v3"
key = os.environ["ELEVENLABS_API_KEY"]

src = open(os.path.join(proj, "index.html")).read()
caps = re.findall(r'class="cap clip" data-start="([\d.]+)" data-duration="([\d.]+)"[^>]*><div[^>]*class="cap-pill">(.*?)</div></div>', src)
out_dir = os.path.join(proj, "assets", "vo")
os.makedirs(out_dir, exist_ok=True)

# delivery cue per line for v3 (ignored by text for v2)
CUE = "[warm, seductive, charming]"

for i, (start, dur, raw) in enumerate(caps):
    text = html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()
    spoken = f"{CUE} {text}" if model == "eleven_v3" else text
    body = {
        "text": spoken,
        "model_id": model,
        "voice_settings": {
            "stability": 0.5 if model == "eleven_v3" else 0.3,
            "similarity_boost": 0.85,
            "style": 0.65,
            "use_speaker_boost": True,
        },
    }
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128",
        data=json.dumps(body).encode(),
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    path = os.path.join(out_dir, f"{i:02d}.mp3")
    try:
        with urllib.request.urlopen(req) as r:
            open(path, "wb").write(r.read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read()[:300].decode(errors="ignore"))
        sys.exit(2)
    length = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))
    flag = "  OVER" if length > float(dur) else ""
    print(f"{i:02d} start={start:>6} slot={dur:>5} vo={length:5.2f}{flag}  {text}")
