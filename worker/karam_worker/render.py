"""ffmpeg-Aufrufe: Schnitt, Hochformat, Untertitel einbrennen, Kodierung.

  * Schnitt an den Grenzen, Neukodierung nur des Clips (Eingabe-Seek mit -ss,
    dadurch schnell und trotzdem bildgenau, weil neu kodiert wird)
  * 9:16 = 1080x1920: Standard mittiger Ausschnitt (crop), Option blur_pad =
    Quelle eingepasst auf unscharfem, abgedunkeltem Hintergrund
  * Untertitel ueber den ass-Filter; dafuer legt der Worker eine fonts.conf an
    und setzt FONTCONFIG_FILE, sonst findet libass unter Windows keine Schrift
  * Encoder: h264_qsv (Intel QuickSync), wenn ein Probelauf klappt, sonst
    libx264 veryfast crf 23; Audio aac 128k; faststart
"""

from __future__ import annotations

import logging
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from .media import MediaInfo, MediaError, ffmpeg_exe, run_ffmpeg

log = logging.getLogger("karam.render")

ASPECTS: dict[str, tuple[int, int]] = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}

_ENCODER_CACHE: dict[str, str] = {}


# ------------------------------------------------------------- Encoder


def detect_encoder(ffmpeg_path: str | None = None, prefer: str | None = None) -> str:
    """Prueft h264_qsv mit einem kurzen Probelauf; sonst libx264.

    prefer="libx264" erzwingt den Software-Encoder (z. B. zum Vergleich)."""
    key = prefer or "auto"
    if key in _ENCODER_CACHE:
        return _ENCODER_CACHE[key]
    if prefer == "libx264":
        _ENCODER_CACHE[key] = "libx264"
        return "libx264"

    exe = ffmpeg_exe(ffmpeg_path)
    listed = subprocess.run([exe, "-hide_banner", "-encoders"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace")
    choice = "libx264"
    if "h264_qsv" in (listed.stdout or ""):
        test = subprocess.run(
            [exe, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-t", "0.5",
             "-c:v", "h264_qsv", "-global_quality", "23", "-f", "null", "-"],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
        )
        if test.returncode == 0:
            choice = "h264_qsv"
        else:
            log.warning("h264_qsv ist gelistet, der Probelauf schlug aber fehl; nehme libx264. (%s)", (test.stderr or "").strip()[-200:])
    _ENCODER_CACHE[key] = choice
    log.info("Video-Encoder: %s", choice)
    return choice


def _encoder_args(encoder: str) -> list[str]:
    if encoder == "h264_qsv":
        # ICQ-Modus (global_quality ohne Bitrate), Qualitaet vergleichbar mit crf 23
        return ["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", "23", "-profile:v", "high"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-profile:v", "high", "-level", "4.1"]


# ---------------------------------------------------------- fontconfig


def ensure_fontconfig(work_dir: Path) -> dict[str, str]:
    """Legt eine kleine fonts.conf an und liefert die Umgebung mit FONTCONFIG_FILE.

    Windows bringt keine fontconfig-Konfiguration mit. Ohne diese Datei findet
    libass (hinter dem ass/subtitles-Filter) keine Schrift und rendert nichts
    oder bricht ab.
    """
    conf_dir = work_dir / "fontconfig"
    conf_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = conf_dir / "cache"
    cache_dir.mkdir(exist_ok=True)
    conf = conf_dir / "fonts.conf"
    windir = os.environ.get("WINDIR") or os.environ.get("SystemRoot") or "C:/Windows"
    fonts_dir = Path(windir) / "Fonts"
    user_fonts = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "Windows" / "Fonts"
    dirs = [fonts_dir] + ([user_fonts] if user_fonts.is_dir() else [])
    content = (
        '<?xml version="1.0"?>\n'
        '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n'
        "<fontconfig>\n"
        + "".join(f"  <dir>{d.as_posix()}</dir>\n" for d in dirs)
        + f"  <cachedir>{cache_dir.as_posix()}</cachedir>\n"
        "  <alias><family>sans-serif</family><prefer><family>Arial</family></prefer></alias>\n"
        "</fontconfig>\n"
    )
    if not conf.is_file() or conf.read_text(encoding="utf-8") != content:
        conf.write_text(content, encoding="utf-8")
    env = dict(os.environ)
    env["FONTCONFIG_FILE"] = str(conf)
    env["FONTCONFIG_PATH"] = str(conf_dir)
    return env


# -------------------------------------------------------------- Render


@dataclass
class RenderResult:
    path: Path
    encoder: str
    seconds: float
    size_bytes: int


def _video_chain(info: MediaInfo, aspect: str, fill_mode: str, ass_name: str | None, pix_fmt: str) -> str:
    w, h = ASPECTS.get(aspect, ASPECTS["9:16"])
    subs = f",ass={ass_name}" if ass_name else ""
    if fill_mode == "blur_pad":
        # Der Hintergrund wird in einem Viertel der Aufloesung weichgezeichnet und dann
        # hochskaliert: sieht identisch aus (es ist ohnehin unscharf), kostet aber auf der
        # CPU nur einen Bruchteil. Gemessen: 1,2x Echtzeit in voller Aufloesung gegenueber
        # deutlich schneller mit dem Viertel-Hintergrund.
        bw, bh = max(2, w // 4) // 2 * 2, max(2, h // 4) // 2 * 2
        return (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={bw}:{bh}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop={bw}:{bh},"
            f"boxblur=luma_radius=8:luma_power=2:chroma_radius=4:chroma_power=2,eq=brightness=-0.08:saturation=0.9,"
            f"scale={w}:{h}:flags=bicubic[bgb];"
            f"[fg]scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos[fgs];"
            f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2{subs},format={pix_fmt}[v]"
        )
    # Standard: mittiger Ausschnitt
    return f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h}{subs},format={pix_fmt}[v]"


def render_clip(
    source: Path,
    start_s: float,
    end_s: float,
    out: Path,
    *,
    info: MediaInfo,
    aspect: str = "9:16",
    fill_mode: str = "crop",
    ass_file: Path | None = None,
    encoder: str | None = None,
    env: dict[str, str] | None = None,
    ffmpeg_path: str | None = None,
) -> RenderResult:
    """Schneidet [start_s, end_s) aus der Quelle und rendert den Clip.

    ass_file muss im selben Ordner wie out liegen; ffmpeg laeuft mit diesem
    Ordner als Arbeitsverzeichnis, damit im Filter kein Windows-Pfad mit
    Doppelpunkt und Backslash maskiert werden muss.
    """
    if end_s <= start_s:
        raise MediaError(f"Clipgrenzen unbrauchbar: {start_s} bis {end_s}")
    if ass_file is not None and ass_file.parent.resolve() != out.parent.resolve():
        raise MediaError("Untertiteldatei muss im selben Ordner wie der Ausgabeclip liegen")
    out.parent.mkdir(parents=True, exist_ok=True)
    enc = encoder or detect_encoder(ffmpeg_path)
    duration = end_s - start_s

    def build(enc_name: str) -> list[str]:
        pix = "nv12" if enc_name == "h264_qsv" else "yuv420p"
        chain = _video_chain(info, aspect, fill_mode, ass_file.name if ass_file else None, pix)
        args = [
            ffmpeg_exe(ffmpeg_path), "-y", "-hide_banner", "-loglevel", "error", "-nostats",
            "-ss", f"{start_s:.3f}", "-i", str(source), "-t", f"{duration:.3f}",
            "-filter_complex", chain, "-map", "[v]",
        ]
        if info.has_audio:
            args += ["-map", "0:a:0", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"]
        else:
            args += ["-an"]
        args += _encoder_args(enc_name)
        if info.fps > 60:
            args += ["-r", "60"]
        args += ["-movflags", "+faststart", "-avoid_negative_ts", "make_zero", out.name]
        return args

    t0 = time.time()
    try:
        run_ffmpeg(build(enc), cwd=out.parent, env=env, what=f"Render ({enc})")
    except MediaError as e:
        if enc != "libx264":
            log.warning("%s; versuche libx264", str(e).splitlines()[0])
            enc = "libx264"
            run_ffmpeg(build(enc), cwd=out.parent, env=env, what="Render (libx264)")
        else:
            raise
    seconds = time.time() - t0
    if not out.is_file() or out.stat().st_size < 10_000:
        raise MediaError(f"Render lieferte keine brauchbare Datei: {out}")
    size = out.stat().st_size
    log.info("Gerendert %s: %.1f s Clip in %.1f s (%.1fx Echtzeit, %s, %.1f MB)", out.name, duration, seconds, duration / max(seconds, 0.01), enc, size / 1_048_576)
    return RenderResult(path=out, encoder=enc, seconds=seconds, size_bytes=size)
