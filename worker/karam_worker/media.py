"""Quelle beschaffen und vorbereiten.

  * ffmpeg/ffprobe finden (PATH, FFMPEG_PATH, WinGet-Ordner)
  * Datei aus dem Bucket raw-videos laden (signierte URL, gestreamt)
  * sonst per yt-dlp laden (bestes MP4 bis 1080p)
  * ffprobe: Dauer, Aufloesung, Bildrate, Tonspur vorhanden
  * Audio als 16 kHz mono WAV fuer Whisper
"""

from __future__ import annotations

import glob
import json
import logging
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlparse

import httpx

log = logging.getLogger("karam.media")

ProgressFn = Callable[[float, str], None]  # (Anteil 0..1, Text)


class MediaError(RuntimeError):
    pass


# ----------------------------------------------------------------- ffmpeg

_FFMPEG_CACHE: dict[str, str] = {}


def _find_tool(name: str, explicit: str | None = None) -> str:
    """Sucht ffmpeg/ffprobe: expliziter Pfad, PATH, dann der WinGet-Ordner von Gyan."""
    if name in _FFMPEG_CACHE:
        return _FFMPEG_CACHE[name]

    candidates: list[str] = []
    if explicit:
        p = Path(explicit)
        if p.is_dir():
            candidates.append(str(p / f"{name}.exe"))
            candidates.append(str(p / "bin" / f"{name}.exe"))
        else:
            # FFMPEG_PATH zeigt auf ffmpeg.exe; ffprobe liegt daneben
            candidates.append(str(p.parent / f"{name}.exe"))
            candidates.append(str(p.parent / name))

    found = shutil.which(name)
    if found:
        candidates.append(found)

    local = os.environ.get("LOCALAPPDATA")
    if local:
        pattern = os.path.join(local, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg*", "*", "bin", f"{name}.exe")
        candidates.extend(sorted(glob.glob(pattern), reverse=True))
    for c in ("C:/ffmpeg/bin", "C:/Program Files/ffmpeg/bin"):
        candidates.append(os.path.join(c, f"{name}.exe"))

    for c in candidates:
        if c and os.path.isfile(c):
            _FFMPEG_CACHE[name] = c
            return c
    raise MediaError(
        f"{name} nicht gefunden. ffmpeg installieren (winget install Gyan.FFmpeg), "
        "Shell neu starten oder FFMPEG_PATH in der .env setzen."
    )


def ffmpeg_exe(explicit: str | None = None) -> str:
    return _find_tool("ffmpeg", explicit)


def ffprobe_exe(explicit: str | None = None) -> str:
    return _find_tool("ffprobe", explicit)


def run_ffmpeg(args: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None, what: str = "ffmpeg") -> str:
    """Fuehrt ffmpeg aus, wirft bei Fehler einen Fehler mit den letzten Zeilen der Ausgabe."""
    proc = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        tail = "\n".join((proc.stdout or "").strip().splitlines()[-12:])
        raise MediaError(f"{what} fehlgeschlagen (Code {proc.returncode}):\n{tail}")
    return proc.stdout or ""


# ------------------------------------------------------------------ probe


@dataclass
class MediaInfo:
    duration_s: float
    width: int
    height: int
    fps: float
    has_audio: bool
    video_codec: str

    @property
    def is_landscape(self) -> bool:
        return self.width > self.height


def probe(path: Path, ffmpeg_path: str | None = None) -> MediaInfo:
    """Dauer, Aufloesung, Bildrate und Tonspur per ffprobe."""
    if not path.is_file():
        raise MediaError(f"Datei fehlt: {path}")
    out = subprocess.run(
        [
            ffprobe_exe(ffmpeg_path),
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if out.returncode != 0:
        raise MediaError(f"ffprobe fehlgeschlagen: {out.stderr.strip()[-500:]}")
    data: dict[str, Any] = json.loads(out.stdout or "{}")
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not video:
        raise MediaError(f"Keine Videospur in {path.name}")

    duration = float((data.get("format") or {}).get("duration") or video.get("duration") or 0)
    if duration <= 0:
        raise MediaError(f"Dauer von {path.name} nicht lesbar")

    fps = 30.0
    rate = video.get("avg_frame_rate") or video.get("r_frame_rate") or "30/1"
    try:
        num, den = rate.split("/")
        if float(den) > 0:
            fps = float(num) / float(den)
    except (ValueError, ZeroDivisionError):
        pass
    if fps <= 0 or fps > 240:
        fps = 30.0

    # Drehung aus den Metadaten beruecksichtigen (Handyvideos)
    width = int(video.get("width") or 0)
    height = int(video.get("height") or 0)
    rotation = 0
    for sd in video.get("side_data_list") or []:
        if "rotation" in sd:
            try:
                rotation = int(abs(float(sd["rotation"])))
            except (TypeError, ValueError):
                rotation = 0
    tags = video.get("tags") or {}
    if "rotate" in tags:
        try:
            rotation = int(abs(float(tags["rotate"])))
        except (TypeError, ValueError):
            pass
    if rotation in (90, 270):
        width, height = height, width

    return MediaInfo(
        duration_s=duration,
        width=width,
        height=height,
        fps=fps,
        has_audio=audio is not None,
        video_codec=str(video.get("codec_name") or "?"),
    )


# ---------------------------------------------------------------- Quelle


def download_from_storage(
    url: str,
    dest: Path,
    progress: ProgressFn | None = None,
    allow_file_urls: bool = False,
) -> Path:
    """Laedt eine Datei ueber eine (signierte) URL gestreamt auf die Platte.

    Die Adresse kommt im Direktmodus von Supabase und im API-Modus aus der
    claim-Antwort der Web-App. Mit allow_file_urls wird zusaetzlich eine
    file://-Adresse angenommen; das braucht nur der lokale Testaufbau
    (Schalter WORKER_ALLOW_FILE_URLS, im Normalbetrieb aus).
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    started = time.time()

    if url.startswith("file://"):
        if not allow_file_urls:
            raise MediaError("file://-Adressen sind als Quelle nicht erlaubt (WORKER_ALLOW_FILE_URLS ist aus)")
        quelle = Path(unquote(urlparse(url).path.lstrip("/")))
        if not quelle.is_file():
            raise MediaError(f"Quelle nicht gefunden: {quelle}")
        shutil.copyfile(quelle, dest)
        log.info("Quelle kopiert: %s (%.1f MB)", dest.name, dest.stat().st_size / 1_048_576)
        return dest

    with httpx.Client(timeout=httpx.Timeout(60.0, read=300.0), follow_redirects=True) as client:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise MediaError(f"Download aus dem Storage: HTTP {resp.status_code}")
            total = int(resp.headers.get("content-length") or 0)
            done = 0
            last = 0.0
            with tmp.open("wb") as f:
                for chunk in resp.iter_bytes(1024 * 512):
                    f.write(chunk)
                    done += len(chunk)
                    if progress and total and time.time() - last > 1.0:
                        last = time.time()
                        progress(done / total, f"Download {done / 1_048_576:.0f}/{total / 1_048_576:.0f} MB")
    if tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        raise MediaError("Download aus dem Storage lieferte 0 Byte")
    tmp.replace(dest)
    log.info("Quelle geladen: %s (%.1f MB in %.0f s)", dest.name, dest.stat().st_size / 1_048_576, time.time() - started)
    return dest


def download_with_ytdlp(url: str, dest: Path, progress: ProgressFn | None = None, ffmpeg_path: str | None = None) -> Path:
    """Laedt einen Link per yt-dlp als MP4 (bis 1080p) nach dest."""
    try:
        import yt_dlp  # type: ignore
    except ImportError as e:
        raise MediaError("yt-dlp ist nicht installiert (pip install yt-dlp)") from e

    dest.parent.mkdir(parents=True, exist_ok=True)
    out_tmpl = str(dest.with_suffix(""))  # yt-dlp haengt .mp4 an

    def hook(d: dict[str, Any]) -> None:
        if not progress:
            return
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            frac = (done / total) if total else 0.0
            progress(frac, f"yt-dlp {done / 1_048_576:.0f}/{total / 1_048_576:.0f} MB")
        elif d.get("status") == "finished":
            progress(1.0, "yt-dlp: Download fertig, fuege Spuren zusammen")

    opts: dict[str, Any] = {
        "format": "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best[height<=1080]/best",
        "merge_output_format": "mp4",
        "outtmpl": out_tmpl + ".%(ext)s",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
        "retries": 3,
        "ffmpeg_location": str(Path(ffmpeg_exe(ffmpeg_path)).parent),
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as e:  # noqa: BLE001 - yt-dlp wirft viele Typen
        raise MediaError(f"yt-dlp konnte den Link nicht laden: {e}") from e

    if dest.is_file():
        return dest
    # yt-dlp kann eine andere Endung gewaehlt haben (z. B. .mkv, .webm)
    for cand in dest.parent.glob(dest.stem + ".*"):
        if cand.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov", ".m4v"} and not cand.name.endswith(".part"):
            if cand.suffix.lower() != ".mp4":
                # In MP4 umpacken (ohne Neukodierung, wenn moeglich)
                run_ffmpeg(
                    [ffmpeg_exe(ffmpeg_path), "-y", "-hide_banner", "-loglevel", "error", "-i", str(cand), "-c", "copy", "-movflags", "+faststart", str(dest)],
                    what="Umpacken nach MP4",
                )
                cand.unlink(missing_ok=True)
                return dest
            return cand
    raise MediaError("yt-dlp lief durch, aber keine Videodatei gefunden")


# ----------------------------------------------------------------- Audio


def extract_audio(source: Path, wav: Path, ffmpeg_path: str | None = None) -> Path:
    """Tonspur als 16 kHz mono PCM-WAV (das Format, das Whisper erwartet)."""
    wav.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        [
            ffmpeg_exe(ffmpeg_path),
            "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(source),
            "-vn", "-sn", "-dn",
            "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le",
            str(wav),
        ],
        what="Audio-Extraktion",
    )
    if not wav.is_file() or wav.stat().st_size < 1000:
        raise MediaError("Audio-Extraktion lieferte keine brauchbare WAV-Datei (hat das Video eine Tonspur?)")
    return wav


def detect_silences(wav: Path, ffmpeg_path: str | None = None, noise_db: float = -32.0, min_len: float = 0.4) -> list[tuple[float, float]]:
    """Stille-Abschnitte (start, ende) per silencedetect. Dient als natuerliche Schnittgrenzen."""
    out = subprocess.run(
        [
            ffmpeg_exe(ffmpeg_path),
            "-hide_banner", "-nostats",
            "-i", str(wav),
            "-af", f"silencedetect=noise={noise_db}dB:d={min_len}",
            "-f", "null", "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    silences: list[tuple[float, float]] = []
    start: float | None = None
    for line in (out.stdout or "").splitlines():
        if "silence_start:" in line:
            try:
                start = float(line.split("silence_start:")[1].split()[0])
            except (ValueError, IndexError):
                start = None
        elif "silence_end:" in line and start is not None:
            try:
                end = float(line.split("silence_end:")[1].split()[0])
                silences.append((start, end))
            except (ValueError, IndexError):
                pass
            start = None
    return silences
