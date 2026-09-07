"""Untertitel je Clip: ASS zum Einbrennen, SRT als Text fuer die Datenbank.

Aus den Wort-Zeitmarken werden Zeilen mit 2 bis 4 Woertern gebildet. Das
gerade gesprochene Wort wird farblich hervorgehoben (je Wort ein eigenes
Dialogue-Ereignis, das ist robuster als Karaoke-Tags). Hochformat 1080x1920,
Sicherheitsbereich unten 420 px, Arial fett mit Umriss und leichtem Schatten.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .transcribe import Word


@dataclass
class CaptionStyle:
    font: str = "Arial"
    size: int = 68
    text_color: str = "FFFFFF"  # RGB als Hex
    highlight_color: str = "FFE600"  # RGB als Hex (gelb)
    outline_px: float = 4.0
    shadow_px: float = 1.5
    margin_v: int = 420  # Abstand vom unteren Rand (Hochformat-Sicherheitsbereich)
    uppercase: bool = False
    max_words: int = 4
    min_words: int = 2
    max_chars: int = 22
    play_w: int = 1080
    play_h: int = 1920


# Vorlagen, angelehnt an CAPTION_PRESETS der Web-App
CAPTION_PRESETS: dict[str, CaptionStyle] = {
    "clean": CaptionStyle(size=60, highlight_color="FFE600"),
    "hormozi": CaptionStyle(size=76, text_color="FFE600", highlight_color="FFFFFF", uppercase=True),
    "bold": CaptionStyle(size=72),
    "neon": CaptionStyle(size=66, text_color="00F0C0", highlight_color="FFFFFF"),
    "subtle": CaptionStyle(size=48, outline_px=3.0),
}


def style_for(preset: str | None, aspect: str = "9:16", highlight: str | None = None) -> CaptionStyle:
    base = CAPTION_PRESETS.get((preset or "bold").lower(), CAPTION_PRESETS["bold"])
    style = CaptionStyle(**base.__dict__)
    if aspect == "1:1":
        style.play_w, style.play_h, style.margin_v = 1080, 1080, 140
    elif aspect == "16:9":
        style.play_w, style.play_h, style.margin_v = 1920, 1080, 110
        style.size = int(style.size * 0.8)
    if highlight:
        style.highlight_color = _hex_rgb(highlight) or style.highlight_color
    return style


def _hex_rgb(value: str) -> str | None:
    v = value.strip().lstrip("#")
    return v.upper() if re.fullmatch(r"[0-9a-fA-F]{6}", v) else None


def _ass_color(rgb_hex: str, alpha: str = "00") -> str:
    """ASS erwartet &HAABBGGRR&."""
    r, g, b = rgb_hex[0:2], rgb_hex[2:4], rgb_hex[4:6]
    return f"&H{alpha}{b}{g}{r}&"


# ----------------------------------------------------------- Gruppieren


@dataclass
class CaptionGroup:
    start: float
    end: float
    words: list[Word]  # Zeiten relativ zum Clipanfang

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


_END_PUNCT = re.compile(r"[.!?…]$")


def group_words(words: list[Word], clip_start: float, clip_end: float, style: CaptionStyle) -> list[CaptionGroup]:
    """Teilt die Woerter eines Clips in Zeilen mit 2 bis 4 Woertern.

    Neue Zeile bei: Wortzahl erreicht, Zeile zu lang, Pause > 0,7 s, Satzende.
    Zeiten werden relativ zum Clipanfang gesetzt und auf den Clip begrenzt.
    """
    rel: list[Word] = []
    for w in words:
        s = max(0.0, w.start - clip_start)
        e = min(clip_end - clip_start, w.end - clip_start)
        if e <= 0 or s >= clip_end - clip_start:
            continue
        rel.append(Word(start=round(s, 3), end=round(max(e, s + 0.05), 3), text=w.text.strip(), prob=w.prob))
    groups: list[CaptionGroup] = []
    cur: list[Word] = []
    chars = 0
    for idx, w in enumerate(rel):
        gap = (w.start - cur[-1].end) if cur else 0.0
        prev_end_sentence = bool(cur) and bool(_END_PUNCT.search(cur[-1].text))
        too_long = cur and (chars + 1 + len(w.text) > style.max_chars) and len(cur) >= style.min_words
        if cur and (len(cur) >= style.max_words or too_long or gap > 0.7 or prev_end_sentence):
            groups.append(CaptionGroup(start=cur[0].start, end=cur[-1].end, words=cur))
            cur, chars = [], 0
        cur.append(w)
        chars += len(w.text) + (1 if chars else 0)
    if cur:
        groups.append(CaptionGroup(start=cur[0].start, end=cur[-1].end, words=cur))

    # kurzes Nachhalten, damit Zeilen nicht flackern, aber nie in die naechste Zeile hinein
    for k, g in enumerate(groups):
        hold = g.end + 0.25
        if k + 1 < len(groups):
            hold = min(hold, groups[k + 1].start - 0.01)
        g.end = max(g.end, hold)
    return groups


# ----------------------------------------------------------------- ASS


def _ass_time(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _ass_escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def build_ass(groups: list[CaptionGroup], style: CaptionStyle) -> str:
    primary = _ass_color(style.text_color)
    highlight = _ass_color(style.highlight_color)
    outline = _ass_color("000000")
    back = _ass_color("000000", "80")
    header = f"""[Script Info]
; Erzeugt vom KaramsVids Worker
ScriptType: v4.00+
PlayResX: {style.play_w}
PlayResY: {style.play_h}
ScaledBorderAndShadow: yes
WrapStyle: 2
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{style.font},{style.size},{primary},{primary},{outline},{back},-1,0,0,0,100,100,1,0,1,{style.outline_px:.1f},{style.shadow_px:.1f},2,60,60,{style.margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines: list[str] = []
    for g in groups:
        n = len(g.words)
        for k, w in enumerate(g.words):
            t0 = w.start if k > 0 else g.start
            t1 = g.words[k + 1].start if k + 1 < n else g.end
            if t1 <= t0:
                t1 = t0 + 0.05
            parts = []
            for m, x in enumerate(g.words):
                txt = _ass_escape(x.text.upper() if style.uppercase else x.text)
                if m == k:
                    parts.append(f"{{\\1c{highlight}}}{txt}{{\\1c{primary}}}")
                else:
                    parts.append(txt)
            lines.append(f"Dialogue: 0,{_ass_time(t0)},{_ass_time(t1)},Cap,,0,0,0,,{' '.join(parts)}")
    return header + "\n".join(lines) + "\n"


def write_ass(groups: list[CaptionGroup], style: CaptionStyle, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_ass(groups, style), encoding="utf-8-sig")
    return path


# ----------------------------------------------------------------- SRT


def _srt_time(t: float) -> str:
    t = max(0.0, t)
    ms = int(round((t - int(t)) * 1000))
    if ms == 1000:
        t, ms = int(t) + 1, 0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(groups: list[CaptionGroup], uppercase: bool = False) -> str:
    out: list[str] = []
    for n, g in enumerate(groups, start=1):
        text = g.text.upper() if uppercase else g.text
        out.append(f"{n}\n{_srt_time(g.start)} --> {_srt_time(g.end)}\n{text}\n")
    return "\n".join(out)
