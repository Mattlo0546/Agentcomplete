"""Original 128 BPM anthemic electro track for the Skill Issue promo.

Structure (bars of 4 beats): 0-1 intro build, 2-5 groove, 6-7 breakdown + riser,
8-20 full drop, 21-23 outro groove, 24 final hit, 25 tail. 26 bars = 48.75s.
"""
import sys
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

SR = 44100
BPM = 128
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 30
N = int(BARS * BAR * SR)
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)


def t_of(n):
    return np.arange(n) / SR


def place(buf, sig, start_s, gain=1.0):
    i = int(start_s * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def both(sig, start, gain=1.0, pan=0.0):
    place(L, sig, start, gain * (1 - max(0, pan)))
    place(R, sig, start, gain * (1 + min(0, pan)))


def filt(x, kind, f, order=2):
    sos = butter(order, f, btype=kind, fs=SR, output="sos")
    return sosfilt(sos, x)


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


# --- drums ---
def kick():
    t = t_of(int(0.4 * SR))
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 7)
    s += 0.3 * np.exp(-t * 300) * rng.standard_normal(len(t))
    return np.tanh(s * 2.2) * 0.9


def clap():
    t = t_of(int(0.25 * SR))
    n = rng.standard_normal(len(t))
    env = np.exp(-t * 22) + 0.6 * np.exp(-((t - 0.012) % 0.011) * 400) * (t < 0.035)
    return filt(n * env, "bandpass", [900, 6000]) * 0.7


def hat(open_=False):
    t = t_of(int((0.18 if open_ else 0.05) * SR))
    n = filt(rng.standard_normal(len(t)), "highpass", 7500)
    return n * np.exp(-t * (18 if open_ else 90)) * 0.35


def crash():
    t = t_of(int(2.2 * SR))
    n = filt(rng.standard_normal(len(t)), "highpass", 4000)
    return n * np.exp(-t * 1.8) * 0.35


def boom():
    t = t_of(int(1.6 * SR))
    f = 30 + 70 * np.exp(-t * 6)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2) * 0.9


K, C, H, HO = kick(), clap(), hat(), hat(True)

# chord progression (A major anthem: A - E - F#m - D), MIDI roots
PROG = [
    [57, 61, 64, 69],  # A
    [52, 59, 64, 68],  # E
    [54, 61, 66, 69],  # F#m
    [50, 57, 62, 66],  # D
]
BASS = [33, 28, 30, 26]


def supersaw(freq, dur, voices=7, detune=0.18):
    t = t_of(int(dur * SR))
    out = np.zeros(len(t))
    for v in range(voices):
        d = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
        f = freq * 2 ** (d / 12)
        ph = rng.random()
        out += 2 * ((t * f + ph) % 1) - 1
    return out / voices


def section(bar):
    if bar < 2:
        return "intro"
    if bar < 6:
        return "groove"
    if bar < 8:
        return "break"
    if bar < 25:
        return "drop"
    if bar < 28:
        return "outro"
    if bar == 28:
        return "hit"
    return "tail"


# sidechain envelope (duck on every kick in groove/drop)
duck = np.ones(N)
for bar in range(BARS):
    sec = section(bar)
    for b in range(4):
        start = bar * BAR + b * BEAT
        kick_on = sec in ("intro", "groove", "drop", "outro") or (sec == "hit" and b == 0)
        if kick_on:
            both(K, start, 1.0)
            n = int(BEAT * SR)
            tt = t_of(n)
            env = 1 - 0.75 * np.exp(-tt * 9)
            i = int(start * SR)
            j = min(N, i + n)
            duck[i:j] = np.minimum(duck[i:j], env[: j - i])
        if sec in ("groove", "drop", "outro") and b in (1, 3):
            both(C, start, 0.9)
        if sec in ("groove", "drop", "outro", "intro"):
            both(HO if sec == "drop" else H, start + BEAT / 2, 0.8, pan=0.2)
        if sec == "drop":
            both(H, start + BEAT / 4, 0.35, pan=-0.3)
            both(H, start + 3 * BEAT / 4, 0.35, pan=-0.3)

# breakdown snare roll accelerating across bar 7
roll_start = 7 * BAR
for k, frac in enumerate(np.concatenate([np.arange(0, 0.5, 1 / 8), np.arange(0.5, 0.75, 1 / 16), np.arange(0.75, 1.0, 1 / 32)])):
    both(C, roll_start + frac * BAR, 0.25 + 0.6 * frac)

# riser noise over bars 6-7
rs = int(6 * BAR * SR)
rn = int(2 * BAR * SR)
tt = t_of(rn)
noise = rng.standard_normal(rn)
# crude sweep: crossfade from lowpassed to highpassed
lo = filt(noise, "lowpass", 1200)
hi = filt(noise, "highpass", 3000)
mix = (tt / tt[-1])
riser = (lo * (1 - mix) + hi * mix) * (mix ** 2) * 0.35
L[rs : rs + rn] += riser
R[rs : rs + rn] += riser

# impacts on section downbeats
for bar in (0, 8, 15, 25, 28):
    both(crash(), bar * BAR, 0.9 if bar else 0.5)
    both(boom(), bar * BAR, 0.8)

# pads / stabs / bass / lead
pad = np.zeros(N)
lead = np.zeros(N)
bass = np.zeros(N)
for bar in range(BARS):
    sec = section(bar)
    ch = PROG[bar % 4]
    start = bar * BAR
    if sec == "tail":
        continue
    if sec == "hit":
        s = sum(supersaw(hz(m + 12), BAR * 2) for m in ch) / 4
        tt = t_of(len(s))
        place(pad, s * np.exp(-tt * 1.2), start, 1.2)
        continue
    # sustained supersaw pad
    s = sum(supersaw(hz(m + 12), BAR) for m in ch) / 4
    g = {"intro": 0.5, "groove": 0.55, "break": 0.7, "drop": 0.9, "outro": 0.7}[sec]
    place(pad, s, start, g)
    # offbeat bass
    if sec in ("groove", "drop", "outro"):
        for b in range(4):
            n = int(BEAT / 2 * SR)
            t = t_of(n)
            f = hz(BASS[bar % 4] + 12)
            saw = 2 * ((t * f) % 1) - 1
            sub = np.sin(2 * np.pi * f / 2 * t)
            place(bass, (saw * 0.5 + sub) * np.exp(-t * 6), start + b * BEAT + BEAT / 2, 0.8)
    # 16th arp lead in the drop
    if sec == "drop":
        notes = [ch[0] + 24, ch[1] + 24, ch[2] + 24, ch[3] + 24, ch[2] + 24, ch[1] + 24, ch[3] + 24, ch[0] + 36]
        for k in range(16):
            n = int(BEAT / 4 * SR)
            t = t_of(n)
            f = hz(notes[k % 8])
            sq = np.sign(np.sin(2 * np.pi * f * t)) * 0.5 + (2 * ((t * f * 1.005) % 1) - 1) * 0.5
            place(lead, sq * np.exp(-t * 14), start + k * BEAT / 4, 0.3)

pad = filt(pad, "lowpass", 5500) * duck
bass = filt(bass, "lowpass", 900) * duck
lead = filt(lead, "lowpass", 7000)
# filter the intro pad darker for build
intro_n = int(2 * BAR * SR)
pad[:intro_n] = filt(pad[:intro_n], "lowpass", 1400)

L += pad * 0.55 + bass * 0.6 + lead * 0.9
R += pad * 0.55 + bass * 0.6
# stereo delay on lead (ping)
d = int(BEAT * 0.75 * SR)
R[d:] += lead[:-d] * 0.55
L[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))

out = np.stack([L, R], axis=1)
out = np.tanh(out * 1.1)
out /= np.max(np.abs(out)) / 0.95
# final fade over last 1.5s
fn = int(1.5 * SR)
out[-fn:] *= np.linspace(1, 0, fn)[:, None]
wavfile.write(sys.argv[1], SR, (out * 32767).astype(np.int16))
print("wrote", sys.argv[1], round(N / SR, 2), "s")
