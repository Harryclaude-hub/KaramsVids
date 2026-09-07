"""Transkription mit Wort-Zeitmarken.

Zwei Wege:
  * lokal mit faster-whisper (CPU, int8), Modell aus WHISPER_MODEL
  * Groq whisper-large-v3-turbo, wenn GROQ_API_KEY gesetzt ist

Ergebnis ist in beiden Faellen dasselbe Transcript-Objekt: Woerter mit
start/end, daraus gebildete Saetze, erkannte Sprache und Volltext.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

import httpx
from pydantic import BaseModel, Field

from .media import ffmpeg_exe, run_ffmpeg, detect_silences

log = logging.getLogger("karam.transcribe")

ProgressFn = Callable[[float, str], None]


class TranscribeError(RuntimeError):
    pass


# --------------------------------------------------------------- Modelle


class Word(BaseModel):
    start: float
    end: float
    text: str
    prob: float = 1.0


class Sentence(BaseModel):
    index: int
    start: float
    end: float
    text: str
    word_start: int  # Index des ersten Wortes in transcript.words
    word_end: int  # Index nach dem letzten Wort (exklusiv)

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    @property
    def word_count(self) -> int:
        return self.word_end - self.word_start


class Transcript(BaseModel):
    language: str = "unknown"
    words: list[Word] = Field(default_factory=list)
    sentences: list[Sentence] = Field(default_factory=list)
    engine: str = "unknown"

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words).strip()

    @property
    def duration(self) -> float:
        return self.words[-1].end if self.words else 0.0

    def words_between(self, start: float, end: float) -> list[Word]:
        """Woerter, deren Mitte im Bereich [start, end) liegt."""
        out: list[Word] = []
        for w in self.words:
            mid = (w.start + w.end) / 2
            if start <= mid < end:
                out.append(w)
        return out


# --------------------------------------------------------- Satzbildung

_SENTENCE_END = re.compile(r"[.!?…]+[\"'”»)]*$")
_MAX_WORDS_PER_SENTENCE = 28
_PAUSE_BREAK_S = 0.9


def build_sentences(words: list[Word]) -> list[Sentence]:
    """Bildet Saetze aus Woertern: an Satzzeichen, an Pausen > 0.9 s,
    spaetestens nach 28 Woertern. Schnittpunkte liegen spaeter nur auf
    diesen Grenzen, nie mitten im Wort."""
    sentences: list[Sentence] = []
    if not words:
        return sentences
    cur_start = 0
    for i, w in enumerate(words):
        is_last = i == len(words) - 1
        next_gap = (words[i + 1].start - w.end) if not is_last else 0.0
        count = i - cur_start + 1
        ends = (
            is_last
            or bool(_SENTENCE_END.search(w.text.strip()))
            or next_gap >= _PAUSE_BREAK_S
            or count >= _MAX_WORDS_PER_SENTENCE
        )
        if ends:
            chunk = words[cur_start : i + 1]
            sentences.append(
                Sentence(
                    index=len(sentences),
                    start=chunk[0].start,
                    end=chunk[-1].end,
                    text=" ".join(x.text.strip() for x in chunk).strip(),
                    word_start=cur_start,
                    word_end=i + 1,
                )
            )
            cur_start = i + 1
    return sentences


def _clean_words(raw: list[Word]) -> list[Word]:
    """Sortiert, entfernt Leerwoerter und erzwingt monotone, nicht-negative Zeiten."""
    out: list[Word] = []
    last_end = 0.0
    for w in sorted(raw, key=lambda x: (x.start, x.end)):
        text = w.text.strip()
        if not text:
            continue
        start = max(w.start, last_end, 0.0)
        end = max(w.end, start + 0.02)
        out.append(Word(start=start, end=end, text=text, prob=w.prob))
        last_end = end
    return out


def transcript_from_words(words: list[Word], language: str, engine: str) -> Transcript:
    cleaned = _clean_words(words)
    return Transcript(language=language or "unknown", words=cleaned, sentences=build_sentences(cleaned), engine=engine)


# ------------------------------------------------------ faster-whisper


def transcribe_local(
    wav: Path,
    model_name: str = "small",
    beam_size: int = 5,
    progress: ProgressFn | None = None,
    cpu_threads: int | None = None,
) -> Transcript:
    """Transkribiert lokal mit faster-whisper (CPU, int8, Wort-Zeitmarken)."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as e:
        raise TranscribeError("faster-whisper ist nicht installiert (pip install faster-whisper)") from e

    threads = cpu_threads or max(1, os.cpu_count() or 4)
    t0 = time.time()
    log.info("Lade Whisper-Modell '%s' (CPU, int8, %d Threads) ...", model_name, threads)
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=threads)
    except Exception as e:  # noqa: BLE001
        raise TranscribeError(f"Whisper-Modell '{model_name}' konnte nicht geladen werden: {e}") from e
    log.info("Modell geladen in %.1f s", time.time() - t0)

    t1 = time.time()
    segments, info = model.transcribe(
        str(wav),
        beam_size=beam_size,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        condition_on_previous_text=False,
    )
    total = float(getattr(info, "duration", 0.0) or 0.0)
    words: list[Word] = []
    last_report = 0.0
    for seg in segments:  # Generator: hier passiert die eigentliche Arbeit
        for w in seg.words or []:
            words.append(Word(start=float(w.start), end=float(w.end), text=str(w.word), prob=float(getattr(w, "probability", 1.0) or 1.0)))
        if progress and total > 0 and time.time() - last_report > 2.0:
            last_report = time.time()
            progress(min(1.0, float(seg.end) / total), f"Transkription {seg.end:.0f}/{total:.0f} s")
    elapsed = time.time() - t1
    speed = (total / elapsed) if elapsed > 0 and total > 0 else 0.0
    log.info(
        "Transkription fertig: %d Woerter, Sprache %s (%.0f%%), %.1f s fuer %.0f s Audio (%.2fx Echtzeit)",
        len(words), info.language, 100 * float(getattr(info, "language_probability", 0.0) or 0.0), elapsed, total, speed,
    )
    if not words:
        raise TranscribeError("Whisper hat keine Woerter erkannt (kein Sprachanteil im Video?)")
    return transcript_from_words(words, str(info.language), f"faster-whisper:{model_name}")


# ---------------------------------------------------------------- Groq

_GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
_GROQ_CHUNK_S = 600.0  # 10 Minuten je Haeppchen (bleibt unter der 25-MB-Grenze als FLAC)


def _chunk_bounds(duration: float, wav: Path, ffmpeg_path: str | None) -> list[tuple[float, float]]:
    """Teilt lange Aufnahmen in ~10-Minuten-Stuecke, geschnitten in einer Stille."""
    if duration <= _GROQ_CHUNK_S:
        return [(0.0, duration)]
    silences = detect_silences(wav, ffmpeg_path)
    bounds: list[tuple[float, float]] = []
    start = 0.0
    while duration - start > _GROQ_CHUNK_S:
        target = start + _GROQ_CHUNK_S
        # beste Stille im Fenster [target-90, target]
        cut = target
        for s0, s1 in silences:
            mid = (s0 + s1) / 2
            if target - 90 <= mid <= target:
                cut = mid
        bounds.append((start, cut))
        start = cut
    bounds.append((start, duration))
    return bounds


def transcribe_groq(
    wav: Path,
    api_key: str,
    model: str = "whisper-large-v3-turbo",
    progress: ProgressFn | None = None,
    ffmpeg_path: str | None = None,
    language_hint: str | None = None,
) -> Transcript:
    """Transkription ueber Groq mit Wort-Zeitmarken (verbose_json)."""
    from .media import probe

    info = probe(wav, ffmpeg_path)
    bounds = _chunk_bounds(info.duration_s, wav, ffmpeg_path)
    words: list[Word] = []
    language = language_hint or "unknown"
    t0 = time.time()

    with httpx.Client(timeout=httpx.Timeout(60.0, read=600.0)) as client:
        for n, (a, b) in enumerate(bounds):
            if progress:
                progress(n / len(bounds), f"Groq-Transkription Teil {n + 1}/{len(bounds)}")
            chunk = wav.with_name(f"{wav.stem}.groq{n}.flac")
            run_ffmpeg(
                [
                    ffmpeg_exe(ffmpeg_path), "-y", "-hide_banner", "-loglevel", "error",
                    "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(wav),
                    "-ac", "1", "-ar", "16000", "-c:a", "flac", str(chunk),
                ],
                what="Audio-Haeppchen fuer Groq",
            )
            size_mb = chunk.stat().st_size / 1_048_576
            if size_mb > 25:
                raise TranscribeError(f"Groq: Haeppchen {n + 1} ist {size_mb:.0f} MB, Grenze sind 25 MB")
            data: dict[str, Any] = {
                "model": model,
                "response_format": "verbose_json",
                "timestamp_granularities[]": ["word", "segment"],
            }
            if language_hint:
                data["language"] = language_hint
            files = {"file": (chunk.name, chunk.read_bytes(), "audio/flac")}
            resp: httpx.Response | None = None
            for attempt in range(3):
                resp = client.post(_GROQ_URL, headers={"Authorization": f"Bearer {api_key}"}, data=data, files=files)
                if resp.status_code == 429 and attempt < 2:
                    wait = 5 * (attempt + 1)
                    log.warning("Groq: Rate-Limit, warte %d s", wait)
                    time.sleep(wait)
                    continue
                break
            chunk.unlink(missing_ok=True)
            if resp is None or resp.status_code != 200:
                body = resp.text[:400] if resp is not None else "keine Antwort"
                raise TranscribeError(f"Groq-Transkription fehlgeschlagen (HTTP {resp.status_code if resp else '?'}): {body}")
            payload = resp.json()
            if payload.get("language"):
                language = str(payload["language"])
            raw_words = payload.get("words") or []
            if not raw_words:
                # Notnagel: Segmente ohne Woerter gleichmaessig auf Woerter verteilen
                for seg in payload.get("segments") or []:
                    toks = str(seg.get("text", "")).split()
                    if not toks:
                        continue
                    s0, s1 = float(seg.get("start", 0)), float(seg.get("end", 0))
                    step = (s1 - s0) / len(toks) if s1 > s0 else 0.3
                    for i, tok in enumerate(toks):
                        raw_words.append({"word": tok, "start": s0 + i * step, "end": s0 + (i + 1) * step})
            for w in raw_words:
                words.append(Word(start=a + float(w["start"]), end=a + float(w["end"]), text=str(w.get("word", "")).strip()))

    log.info("Groq-Transkription: %d Woerter, Sprache %s, %.1f s", len(words), language, time.time() - t0)
    if not words:
        raise TranscribeError("Groq hat keine Woerter geliefert (kein Sprachanteil im Video?)")
    return transcript_from_words(words, language, f"groq:{model}")


# -------------------------------------------------------------- Dateien


def load_transcript_file(path: Path) -> Transcript:
    """Liest ein Transkript aus JSON (fuer Tests und Wiederholungen).

    Erwartet {"language": "de", "words": [{"start": 0.0, "end": 0.4, "text": "Hallo"}, ...]}
    oder das Ausgabeformat von save_transcript_file.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise TranscribeError(f"Transkript {path} nicht lesbar: {e}") from e
    raw_words = data.get("words")
    if not isinstance(raw_words, list) or not raw_words:
        raise TranscribeError(f"Transkript {path}: Feld 'words' fehlt oder ist leer")
    words: list[Word] = []
    for w in raw_words:
        text = str(w.get("text") or w.get("word") or "").strip()
        if not text:
            continue
        words.append(Word(start=float(w["start"]), end=float(w["end"]), text=text, prob=float(w.get("prob", 1.0))))
    return transcript_from_words(words, str(data.get("language") or "unknown"), str(data.get("engine") or f"datei:{path.name}"))


def save_transcript_file(t: Transcript, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "language": t.language,
                "engine": t.engine,
                "words": [w.model_dump() for w in t.words],
                "sentences": [{"index": s.index, "start": s.start, "end": s.end, "text": s.text} for s in t.sentences],
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
