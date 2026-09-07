"""Schleife und Pipeline des Workers.

  python -m karam_worker                       Endlosschleife, holt Auftraege ab
  python -m karam_worker --once                einen Auftrag verarbeiten, dann Ende
  python -m karam_worker --job <id>            einen bestimmten Auftrag neu verarbeiten (nur Direktmodus)
  python -m karam_worker --local pfad.mp4 --clips 3 [--transcript t.json]   ohne Server, Ergebnis in WORK_DIR

Woher die Auftraege kommen, entscheidet die Konfiguration: ueber die Web-App
(KARAMSVIDS_URL + WORKER_SECRET) oder direkt aus Supabase (SUPABASE_URL +
SUPABASE_SERVICE_ROLE_KEY). Die Pipeline sieht davon nichts, sie kennt nur den
JobStore aus db.py.

Fortschritt in edit_jobs.progress: 5 Quelle laden, 20 Audio und Transkription,
50 Transkript fertig, 70 Auswahl und Analyse geschrieben, 70 bis 90 Rendern,
90 bis 95 Hochladen, 100 fertig (status done).
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import re
import shutil
import sys
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from rich.console import Console
from rich.logging import RichHandler

from . import __version__
from .config import ConfigError, Settings, load_settings
from .errors import WorkerError
from .media import MediaError, MediaInfo, download_from_storage, download_with_ytdlp, extract_audio, ffmpeg_exe, probe
from .render import detect_encoder, ensure_fontconfig, render_clip
from .select import SelectError, SelectionOptions, analysis_payload, select_clips
from .subtitles import build_srt, group_words, style_for, write_ass
from .transcribe import (
    Transcript,
    TranscribeError,
    load_transcript_file,
    save_transcript_file,
    transcribe_groq,
    transcribe_local,
)

log = logging.getLogger("karam")
console = Console()


# ---------------------------------------------------------- Fortschritt


class Reporter(Protocol):
    def progress(self, pct: int, phase: str, detail: str | None = None) -> None: ...


class ConsoleReporter:
    """Fortschritt nur in der Konsole (lokaler Modus)."""

    def progress(self, pct: int, phase: str, detail: str | None = None) -> None:
        log.info("[%3d%%] %s%s", pct, phase, f": {detail}" if detail else "")


class StoreReporter:
    """Fortschritt in edit_jobs (progress, options.worker_phase, Herzschlag).

    Feine Zwischenwerte (z. B. Download-Prozent) werden hoechstens alle 3 s
    gemeldet, damit weder die Datenbank noch die App geflutet werden.
    """

    def __init__(self, store: Any, job_id: str) -> None:
        self.store = store
        self.job_id = job_id
        self._last_write = 0.0
        self._last_pct = -1

    def progress(self, pct: int, phase: str, detail: str | None = None) -> None:
        log.info("[%3d%%] %s%s", pct, phase, f": {detail}" if detail else "")
        now = time.time()
        if pct == self._last_pct and now - self._last_write < 3.0:
            return
        self._last_write, self._last_pct = now, pct
        try:
            self.store.set_progress(self.job_id, pct, phase)
        except Exception as e:  # noqa: BLE001 - Fortschritt ist nicht kritisch
            log.warning("Fortschritt konnte nicht geschrieben werden: %s", e)


# ------------------------------------------------------------- Auftrag


@dataclass
class JobSpec:
    """Alles, was die Pipeline ueber einen Auftrag wissen muss, ohne Datenbank."""

    job_id: str
    user_id: str
    brand_id: str | None
    mode: str
    options: dict[str, Any]
    desired_count: int | None
    title: str
    # Quelle: "storage" (fertige Download-Adresse), "url" (Link fuer yt-dlp) oder "local"
    source_kind: str = "local"
    source_url: str | None = None
    # gesetzt, wenn schon beim Beanspruchen klar war, dass die Quelle fehlt
    source_error: str | None = None
    # gleichbleibender Name im Zwischenspeicher
    cache_key: str | None = None
    local_source: Path | None = None
    transcript_file: Path | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def aspect(self) -> str:
        a = str(self.options.get("aspect") or "9:16")
        return a if a in ("9:16", "1:1", "16:9") else "9:16"

    @property
    def fill_mode(self) -> str:
        if self.options.get("fill_mode") == "blur_pad" or self.options.get("blur_pad") is True:
            return "blur_pad"
        return "crop"

    @property
    def captions_enabled(self) -> bool:
        return self.options.get("captions", True) is not False

    def selection_options(self) -> SelectionOptions:
        def num(key: str, default: float) -> float:
            try:
                v = float(self.options.get(key))
                return v if v > 0 else default
            except (TypeError, ValueError):
                return default

        count = self.desired_count
        if count is None and self.options.get("desired_clip_count"):
            try:
                count = int(self.options["desired_clip_count"])
            except (TypeError, ValueError):
                count = None
        if self.mode == "auto_cut":
            return SelectionOptions(min_len_s=num("min_len_s", 30.0), max_len_s=num("max_len_s", 180.0), count=1, mode=self.mode, title_hint=self.title)
        return SelectionOptions(min_len_s=num("min_len_s", 20.0), max_len_s=num("max_len_s", 60.0), count=count, mode=self.mode, title_hint=self.title)


def job_from_claim(job: Any) -> JobSpec:
    """Baut die Pipeline-Sicht aus einem beanspruchten Auftrag (db.ClaimedJob).

    Der API-Modus liefert weniger Felder als der Direktmodus (kein brand_id,
    kein desired_clip_count als Spalte); beides ist optional, die Anzahl steht
    dann in options.desired_clip_count.
    """
    row = job.row
    options = dict(row.get("options") or {})
    anzahl = row.get("desired_clip_count")
    try:
        anzahl = int(anzahl) if anzahl else None
    except (TypeError, ValueError):
        anzahl = None
    return JobSpec(
        job_id=str(row["id"]),
        user_id=str(row.get("user_id") or ""),
        brand_id=str(row["brand_id"]) if row.get("brand_id") else None,
        mode=str(row.get("mode") or "long_to_many"),
        options=options,
        desired_count=anzahl,
        title=job.source.title or "",
        source_kind=job.source.kind or "",
        source_url=job.source.url or None,
        source_error=job.source.error,
        cache_key=job.source.cache_key or None,
    )


# ------------------------------------------------------------ Pipeline


@dataclass
class ClipOutput:
    index: int
    path: Path
    start_s: float
    end_s: float
    title: str
    hook: str
    why: str
    srt: str
    encoder: str


@dataclass
class PipelineResult:
    analysis: dict[str, Any]
    clips: list[ClipOutput]
    transcript: Transcript
    info: MediaInfo
    job_dir: Path


def _safe_name(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", text)[:60] or "video"


def _source_cache_path(spec: JobSpec, settings: Settings) -> Path:
    base = settings.work_dir / "sources"
    if spec.cache_key:
        return base / f"{_safe_name(spec.cache_key)}.mp4"
    key = hashlib.sha1((spec.source_url or spec.job_id).encode("utf-8")).hexdigest()[:16]
    return base / f"{key}.mp4"


def obtain_source(spec: JobSpec, settings: Settings, report: Reporter) -> Path:
    """Quelle bereitstellen: lokale Datei, signierte Adresse oder yt-dlp."""
    if spec.local_source:
        if not spec.local_source.is_file():
            raise MediaError(f"Datei nicht gefunden: {spec.local_source}")
        return spec.local_source
    if spec.source_error:
        raise MediaError(spec.source_error)
    dest = _source_cache_path(spec, settings)
    if dest.is_file() and dest.stat().st_size > 10_000:
        log.info("Quelle aus dem Zwischenspeicher: %s", dest)
        return dest

    def on_progress(frac: float, text: str) -> None:
        report.progress(5 + int(frac * 12), "Quelle laden", text)

    if spec.source_kind == "storage" and spec.source_url:
        return download_from_storage(spec.source_url, dest, on_progress, allow_file_urls=settings.allow_file_urls)
    if spec.source_kind == "url" and spec.source_url:
        return download_with_ytdlp(spec.source_url, dest, on_progress, settings.ffmpeg_path)
    raise MediaError("Der Auftrag hat keine Quelle: weder Datei im Bucket raw-videos noch Link")


def get_transcript(spec: JobSpec, source: Path, info: MediaInfo, settings: Settings, report: Reporter, job_dir: Path) -> Transcript:
    """Transkript beschaffen, in dieser Reihenfolge:
      1. Datei aus --transcript (Test, ueberspringt Whisper komplett)
      2. transcript.json aus einem frueheren Lauf desselben Auftrags
      3. Audio als 16 kHz WAV ziehen und Whisper (Groq oder lokal) laufen lassen
    """
    cached = job_dir / "transcript.json"
    if spec.transcript_file:
        t = load_transcript_file(spec.transcript_file)
        log.info("Transkript aus Datei: %d Woerter, %d Saetze, Sprache %s", len(t.words), len(t.sentences), t.language)
        return t
    if cached.is_file():
        try:
            t = load_transcript_file(cached)
            log.info("Transkript aus fruehem Lauf uebernommen (%s)", cached)
            return t
        except TranscribeError:
            pass

    if not info.has_audio:
        raise MediaError("Das Video hat keine Tonspur, ohne Sprache gibt es nichts zu transkribieren")
    report.progress(20, "Audio extrahieren")
    wav = extract_audio(source, job_dir / "audio16k.wav", settings.ffmpeg_path)

    def on_progress(frac: float, text: str) -> None:
        report.progress(20 + int(frac * 30), "Transkription", text)

    report.progress(20, "Transkription", "Groq" if settings.groq_api_key else f"Whisper {settings.whisper_model} startet")
    if settings.groq_api_key:
        t = transcribe_groq(wav, settings.groq_api_key, settings.groq_model, on_progress, settings.ffmpeg_path)
    else:
        t = transcribe_local(wav, settings.whisper_model, settings.whisper_beam, on_progress)
    save_transcript_file(t, cached)
    return t


def run_pipeline(spec: JobSpec, settings: Settings, report: Reporter, on_analysis: Callable[[dict[str, Any]], None] | None = None) -> PipelineResult:
    """Die komplette Verarbeitung eines Auftrags. Wirft bei jedem Fehler."""
    job_dir = settings.work_dir / "jobs" / _safe_name(spec.job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg_exe(settings.ffmpeg_path)  # frueh pruefen, klarer Fehler statt spaeter Ueberraschung

    # 1) Quelle
    report.progress(5, "Quelle laden", spec.title or spec.source_url or spec.source_kind)
    source = obtain_source(spec, settings, report)
    info = probe(source, settings.ffmpeg_path)
    log.info("Quelle: %dx%d, %.1f fps, %.1f s, Ton: %s", info.width, info.height, info.fps, info.duration_s, "ja" if info.has_audio else "nein")

    # 2) + 3) Audio und Transkript (Audio wird nur gezogen, wenn Whisper wirklich laeuft)
    transcript = get_transcript(spec, source, info, settings, report, job_dir)
    report.progress(50, "Transkription fertig", f"{len(transcript.words)} Woerter, Sprache {transcript.language}")

    # 4) Auswahl
    sel_opts = spec.selection_options()
    result = select_clips(transcript, info.duration_s, sel_opts, settings.lovable_api_key, settings.lovable_model)
    log.info("Auswahl (%s): %d Clips", result.method, len(result.clips))
    for k, c in enumerate(result.clips, start=1):
        log.info("  %2d. %7.1f - %7.1f s (%4.1f s)  %s  [%s]", k, c.start_s, c.end_s, c.duration, c.title, c.why)

    # Encoder jetzt bestimmen, damit er in der Analyse steht. Spaeter wird analysis nicht mehr
    # angefasst: die Web-App schreibt analysis.segments beim Bearbeiten selbst zurueck, und ein
    # spaeteres Ueberschreiben durch den Worker wuerde diese Aenderungen verlieren.
    encoder = detect_encoder(settings.ffmpeg_path, spec.options.get("encoder"))

    # Untertitel vorbereiten (SRT kommt auch in die Analyse, damit der Editor sie zeigt)
    style = style_for(spec.options.get("caption_preset"), spec.aspect, spec.options.get("caption_color"))
    prepared = []
    for k, c in enumerate(result.clips, start=1):
        groups = group_words(transcript.words_between(c.start_s, c.end_s), c.start_s, c.end_s, style)
        srt = build_srt(groups, style.uppercase)
        prepared.append((k, c, groups, srt))
    analysis = analysis_payload(
        result,
        transcript,
        {
            "worker": {
                "id": settings.worker_id,
                "version": __version__,
                "source_duration_s": round(info.duration_s, 2),
                "source_size": f"{info.width}x{info.height}",
                "aspect": spec.aspect,
                "fill_mode": spec.fill_mode,
                "captions": spec.captions_enabled,
                "encoder": encoder,
            }
        },
    )
    for (k, c, groups, srt), seg in zip(prepared, analysis["segments"]):
        seg["captions"] = srt
        seg["fill_mode"] = spec.fill_mode
    report.progress(70, "Auswahl fertig", f"{len(result.clips)} Stellen ({result.method})")
    if on_analysis:
        on_analysis(analysis)

    # 5) Rendern (Fortschritt 70 bis 90, das Hochladen belegt danach 90 bis 95)
    env = ensure_fontconfig(settings.work_dir)
    outputs: list[ClipOutput] = []
    total = len(prepared)
    for k, c, groups, srt in prepared:
        report.progress(70 + int(20 * (k - 1) / max(total, 1)), "Rendern", f"Clip {k}/{total}: {c.title}")
        ass_path = None
        if spec.captions_enabled and groups:
            ass_path = write_ass(groups, style, job_dir / f"clip_{k}.ass")
        out = job_dir / f"clip_{k}.mp4"
        rr = render_clip(
            source, c.start_s, c.end_s, out,
            info=info, aspect=spec.aspect, fill_mode=spec.fill_mode, ass_file=ass_path,
            encoder=encoder, env=env, ffmpeg_path=settings.ffmpeg_path,
        )
        outputs.append(ClipOutput(index=k, path=rr.path, start_s=c.start_s, end_s=c.end_s, title=c.title, hook=c.hook, why=c.why, srt=srt, encoder=rr.encoder))
    report.progress(90, "Gerendert", f"{total} Clips")
    return PipelineResult(analysis=analysis, clips=outputs, transcript=transcript, info=info, job_dir=job_dir)


# --------------------------------------------------------- Auftragslauf


def process_job(store: Any, job: Any, settings: Settings) -> int:
    """Verarbeitet einen beanspruchten Auftrag von Anfang bis Ende. Gibt die Clipanzahl zurueck."""
    spec = job_from_claim(job)
    report = StoreReporter(store, spec.job_id)
    log.info("Auftrag %s: Modus %s, %s Clips gewuenscht, Quelle %s", spec.job_id, spec.mode, spec.desired_count or "auto", spec.source_kind or "?")
    t0 = time.time()

    def write_analysis(analysis: dict[str, Any]) -> None:
        store.write_analysis(spec.job_id, analysis, 70)

    result = run_pipeline(spec, settings, report, on_analysis=write_analysis)

    removed = store.reset_clips(spec.job_id)
    if removed:
        log.info("%d alte Worker-Clips dieses Auftrags entfernt", removed)

    total = len(result.clips)
    for out in result.clips:
        report.progress(90 + int(5 * (out.index - 1) / max(total, 1)), "Hochladen", f"Clip {out.index}/{total}")
        path = store.upload_clip(spec.job_id, spec.user_id, out.index, out.path)
        store.add_clip(
            job_id=spec.job_id,
            user_id=spec.user_id,
            brand_id=spec.brand_id,
            storage_path=path,
            duration_s=out.end_s - out.start_s,
            title=out.title,
            caption_srt=out.srt or None,
            aspect=spec.aspect,
            meta={
                "engine": "worker",
                "renderer": "worker",
                "worker_id": settings.worker_id,
                "start_s": round(out.start_s, 3),
                "end_s": round(out.end_s, 3),
                "hook": out.hook,
                "why": out.why,
                "encoder": out.encoder,
                "fill_mode": spec.fill_mode,
                "language": result.transcript.language,
            },
        )
    report.progress(95, "Hochgeladen", f"{total} Clips")
    store.finish(spec.job_id, total)
    log.info("Auftrag %s fertig: %d Clips in %.0f s", spec.job_id, total, time.time() - t0)
    if not settings.keep_work:
        shutil.rmtree(result.job_dir, ignore_errors=True)
    return total


def run_loop(settings: Settings, once: bool, job_id: str | None) -> int:
    from .db import DbError, create_store

    transport = settings.require_transport()
    store = create_store(settings)
    if transport == "api":
        log.info("Worker %s spricht mit der App unter %s", settings.worker_id, settings.karamsvids_url)
    else:
        log.info("Worker %s verbunden mit %s (Direktmodus)", settings.worker_id, settings.supabase_url)
    log.info("Transkription: %s | Auswahl: %s | Arbeitsordner: %s",
             f"Groq {settings.groq_model}" if settings.groq_api_key else f"faster-whisper {settings.whisper_model} (lokal)",
             "Lovable AI" if settings.lovable_api_key else "Heuristik (kein LOVABLE_API_KEY)",
             settings.work_dir)

    try:
        if job_id:
            job = store.claim_specific(job_id)
            if job is None:
                raise DbError(f"Auftrag {job_id} konnte nicht beansprucht werden")
            return _process_guarded(store, job, settings)

        idle_logged = False
        while True:
            try:
                job = store.claim_next()
            except Exception as e:  # noqa: BLE001 - Netzfehler nicht toedlich
                log.warning("Abfrage der Auftraege fehlgeschlagen: %s", e)
                if once:
                    return 1  # bei --once ist ein Fehlversuch das Ergebnis
                job = None
            if job is not None:
                _process_guarded(store, job, settings)
                idle_logged = False
                if once:
                    return 0
                continue
            if once:
                log.info("Kein offener Auftrag, --once beendet sich.")
                return 0
            if not idle_logged:
                log.info("Kein offener Auftrag, warte (alle %d s) ...", settings.poll_seconds)
                idle_logged = True
            time.sleep(settings.poll_seconds)
    finally:
        store.close()


def _process_guarded(store: Any, job: Any, settings: Settings) -> int:
    job_id = str(job.row["id"])
    try:
        process_job(store, job, settings)
        return 0
    except KeyboardInterrupt:
        log.warning("Abbruch durch Nutzer, Auftrag %s wird als fehlgeschlagen markiert", job_id)
        store.fail(job_id, "Worker wurde waehrend der Verarbeitung beendet. Bitte erneut anstossen.")
        raise
    except Exception as e:  # noqa: BLE001 - jeder Fehler landet im Auftrag
        msg = f"{type(e).__name__}: {e}"
        log.error("Auftrag %s fehlgeschlagen: %s", job_id, msg)
        log.debug("%s", traceback.format_exc())
        try:
            store.fail(job_id, msg)
        except Exception as e2:  # noqa: BLE001
            log.error("Fehler konnte nicht gemeldet werden: %s", e2)
        return 1


# --------------------------------------------------------- Lokal-Modus


def run_local(settings: Settings, source: Path, clips: int | None, transcript: Path | None, args: argparse.Namespace) -> int:
    """Ohne Server: Ergebnis landet im Arbeitsordner unter jobs/local-<name>/."""
    source = source.resolve()
    name = _safe_name(source.stem)
    options: dict[str, Any] = {"captions": not args.no_captions, "aspect": args.aspect}
    if args.blur_pad:
        options["fill_mode"] = "blur_pad"
    if args.min_len:
        options["min_len_s"] = args.min_len
    if args.max_len:
        options["max_len_s"] = args.max_len
    if args.encoder:
        options["encoder"] = args.encoder
    if args.caption_preset:
        options["caption_preset"] = args.caption_preset
    spec = JobSpec(
        job_id=f"local-{name}", user_id="local", brand_id=None, mode=args.mode, options=options,
        desired_count=clips, title=source.stem, local_source=source, transcript_file=transcript,
    )
    settings.keep_work = True
    t0 = time.time()
    result = run_pipeline(spec, settings, ConsoleReporter())
    out_dir = result.job_dir
    import json

    (out_dir / "analysis.json").write_text(json.dumps(result.analysis, ensure_ascii=False, indent=1), encoding="utf-8")
    for c in result.clips:
        (out_dir / f"clip_{c.index}.srt").write_text(c.srt, encoding="utf-8")
    log.info("Fertig in %.1f s. Ergebnis: %s", time.time() - t0, out_dir)
    for c in result.clips:
        log.info("  %s  %.1f-%.1f s  %s", c.path.name, c.start_s, c.end_s, c.title)
    return 0


# ---------------------------------------------------------------- CLI


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(message)s",
        datefmt="%H:%M:%S",
        handlers=[RichHandler(console=console, show_path=False, rich_tracebacks=False, markup=False)],
    )
    for noisy in ("httpx", "httpcore", "hpack", "urllib3", "faster_whisper", "supabase", "postgrest", "storage3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="karam_worker", description="KaramsVids Worker: Auftraege der Web-App abarbeiten.")
    p.add_argument("--once", action="store_true", help="einen Auftrag verarbeiten, dann beenden")
    p.add_argument("--job", metavar="ID", help="einen bestimmten Auftrag (neu) verarbeiten, auch wenn er schon beansprucht ist (nur Direktmodus)")
    p.add_argument("--local", metavar="VIDEO", help="lokale Datei ohne Server verarbeiten (Test)")
    p.add_argument("--clips", type=int, default=None, help="gewuenschte Clipanzahl im lokalen Modus")
    p.add_argument("--transcript", metavar="JSON", help="Transkript aus Datei statt Whisper (ueberspringt die Transkription)")
    p.add_argument("--mode", default="long_to_many", choices=["auto_cut", "ugc_shorts", "long_to_many", "manual"], help="Schnittmodus im lokalen Modus")
    p.add_argument("--min-len", type=float, default=None, help="Mindestlaenge je Clip in s (lokal)")
    p.add_argument("--max-len", type=float, default=None, help="Hoechstlaenge je Clip in s (lokal)")
    p.add_argument("--aspect", default="9:16", choices=["9:16", "1:1", "16:9"], help="Zielformat (lokal)")
    p.add_argument("--blur-pad", action="store_true", help="unscharfer Hintergrund statt mittigem Ausschnitt (lokal)")
    p.add_argument("--no-captions", action="store_true", help="keine Untertitel einbrennen (lokal)")
    p.add_argument("--caption-preset", default=None, choices=["clean", "hormozi", "bold", "neon", "subtle"], help="Untertitel-Stil (lokal)")
    p.add_argument("--encoder", default=None, choices=["libx264", "h264_qsv"], help="Encoder erzwingen (lokal)")
    p.add_argument("--whisper-model", default=None, help="Whisper-Modell fuer diesen Lauf (tiny, base, small, medium)")
    p.add_argument("--verbose", action="store_true", help="ausfuehrliche Ausgabe")
    p.add_argument("--version", action="version", version=f"karam_worker {__version__}")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _setup_logging(args.verbose)
    log.info("KaramsVids Worker %s", __version__)
    try:
        settings = load_settings()
        if args.whisper_model:
            settings.whisper_model = args.whisper_model
        settings.work_dir.mkdir(parents=True, exist_ok=True)
        if settings.env_files:
            log.info("Konfiguration aus: %s", ", ".join(str(p) for p in settings.env_files))
        if args.local:
            return run_local(settings, Path(args.local), args.clips, Path(args.transcript) if args.transcript else None, args)
        return run_loop(settings, args.once, args.job)
    except KeyboardInterrupt:
        log.info("Beendet.")
        return 130
    except (ConfigError, MediaError, TranscribeError, SelectError, WorkerError) as e:
        log.error("%s", e)
        return 2
    except Exception as e:  # noqa: BLE001 - letzter Fang mit Traceback
        log.error("Unerwarteter Fehler: %s: %s", type(e).__name__, e)
        log.error("%s", traceback.format_exc())
        return 1


if __name__ == "__main__":
    sys.exit(main())
