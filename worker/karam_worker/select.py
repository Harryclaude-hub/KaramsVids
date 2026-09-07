"""Auswahl der tragenden Stellen aus dem Transkript.

Zwei Wege, gleiches Ergebnis:
  * Sprachmodell ueber das Lovable-Gateway (wenn LOVABLE_API_KEY gesetzt ist):
    bekommt das Transkript als nummerierte Saetze mit Zeitmarken und antwortet
    mit striktem JSON (start_s, end_s, title, hook, why).
  * Heuristik ohne Schluessel: Hook-Woerter, Fragen, Zahlen, Sprechtempo und
    Pausen als natuerliche Grenzen.

In beiden Faellen werden die Schnittpunkte auf Satzgrenzen aus dem Transkript
gezogen, nie mitten ins Wort, und die Laenge auf min_len_s..max_len_s gebracht.
"""

from __future__ import annotations

import json
import logging
import math
import re
import statistics
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from .transcribe import Sentence, Transcript

log = logging.getLogger("karam.select")


class SelectError(RuntimeError):
    pass


# --------------------------------------------------------------- Modelle


@dataclass
class SelectionOptions:
    """Rahmen fuer die Auswahl: Laenge, Anzahl, Modus."""

    min_len_s: float = 20.0
    max_len_s: float = 60.0
    count: int | None = None  # None = Anzahl passend zur Laenge
    mode: str = "long_to_many"
    title_hint: str = ""

    def normalized(self, duration: float) -> "SelectionOptions":
        """Bringt die Grenzen in eine brauchbare Ordnung und passt sie an die Videolaenge an."""
        lo = max(3.0, float(self.min_len_s or 20.0))
        hi = max(lo + 2.0, float(self.max_len_s or 60.0))
        if duration < lo:
            lo = max(1.0, duration * 0.5)
        if duration < hi:
            hi = duration
        count = self.count
        if count is not None:
            count = max(1, min(200, int(count)))
        return SelectionOptions(min_len_s=lo, max_len_s=hi, count=count, mode=self.mode, title_hint=self.title_hint)


@dataclass
class ClipPlan:
    start_s: float
    end_s: float
    title: str
    hook: str
    why: str = ""
    score: float = 0.0
    sentence_start: int = 0
    sentence_end: int = 0  # inklusiv
    tags: list[str] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.end_s - self.start_s


@dataclass
class SelectionResult:
    clips: list[ClipPlan]
    summary: str
    method: str  # "lovable" | "heuristic" | "lovable+heuristic"


# ------------------------------------------------------- Hilfsfunktionen

_HOOK_WORDS = [
    # Deutsch
    "warum", "wieso", "weshalb", "geheimnis", "niemand", "keiner", "fehler", "tipp", "trick", "wichtig",
    "wichtigste", "achtung", "vorsicht", "krass", "unglaublich", "ehrlich", "wahrheit", "luege", "stell dir vor",
    "du musst", "musst du", "nie wieder", "sofort", "kostenlos", "gratis", "beste", "schlimmste", "groesste",
    "größte", "einfachste", "schnellste", "hack", "regel", "schritt", "grund", "problem", "loesung", "lösung",
    "verlier", "gewinn", "spar", "verdien", "geld", "zuerst", "zum schluss", "das wichtigste", "merk dir",
    # Englisch
    "why", "secret", "nobody", "no one", "mistake", "tip", "trick", "important", "warning", "insane", "crazy",
    "truth", "lie", "imagine", "you need", "you have to", "never", "always", "free", "best", "worst", "biggest",
    "easiest", "fastest", "hack", "rule", "step", "reason", "problem", "solution", "lose", "win", "save", "earn",
    "money", "first", "finally", "remember", "here's why", "here is why", "the thing is",
]
_NUMBER_WORDS = [
    "null", "eins", "zwei", "drei", "vier", "fuenf", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "zwanzig",
    "dreissig", "dreißig", "vierzig", "fuenfzig", "fünfzig", "hundert", "tausend", "million", "prozent",
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "twenty", "thirty", "hundred",
    "thousand", "million", "percent",
]
_DIGIT = re.compile(r"\d")
_WORD = re.compile(r"[\wäöüÄÖÜß']+")
# Hook-Woerter nur an Wortgrenzen, sonst trifft "lie" in "verlieren"
_HOOK_PATTERNS = [(h, re.compile(r"(?<!\w)" + re.escape(h) + r"(?!\w)")) for h in _HOOK_WORDS]
_NUMBER_PATTERN = re.compile(r"(?<!\w)(" + "|".join(re.escape(n) for n in _NUMBER_WORDS) + r")(?!\w)")


def _tidy_title(text: str, max_words: int = 7, max_chars: int = 60) -> str:
    words = _WORD.findall(text)
    if not words:
        return "Clip"
    title = " ".join(words[:max_words])
    if len(title) > max_chars:
        title = title[: max_chars - 1].rstrip() + "…"
    return title[0].upper() + title[1:]


def _shorten(text: str, max_chars: int = 140) -> str:
    text = " ".join(text.split())
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _sentence_scores(t: Transcript) -> list[tuple[float, list[str]]]:
    """Punktzahl je Satz plus Begruendungs-Etiketten."""
    sents = t.sentences
    if not sents:
        return []
    rates = []
    for s in sents:
        if s.duration > 0.3:
            rates.append(s.word_count / s.duration)
    median_rate = statistics.median(rates) if rates else 2.5

    out: list[tuple[float, list[str]]] = []
    for i, s in enumerate(sents):
        text_l = s.text.lower()
        score = 0.0
        tags: list[str] = []

        hits = []
        for word, pattern in _HOOK_PATTERNS:
            if pattern.search(text_l) and not any(word in h for h in hits):
                hits.append(word)
        if hits:
            score += min(3.0, 1.2 * len(hits))
            tags.append("Hook-Wort: " + ", ".join(hits[:3]))
        if "?" in s.text:
            score += 1.6
            tags.append("Frage")
        if _DIGIT.search(s.text) or _NUMBER_PATTERN.search(text_l):
            score += 1.0
            tags.append("Zahl")
        gap_before = s.start - sents[i - 1].end if i > 0 else 2.0
        if gap_before >= 0.6:
            score += 0.8
            tags.append("Pause davor")
        if s.duration > 0.3 and median_rate > 0:
            rel = s.word_count / s.duration / median_rate - 1.0
            if rel > 0.15:
                score += min(1.0, rel * 1.5)
                tags.append("hohes Tempo")
        if s.word_count < 3:
            score -= 0.6
        if i == 0:
            score += 0.4
        out.append((score, tags))
    return out


def _snap(t: Transcript, start_s: float, end_s: float, opts: SelectionOptions, duration: float) -> tuple[int, int] | None:
    """Zieht einen Zeitbereich auf Satzgrenzen und bringt ihn in die Laengengrenzen.

    Rueckgabe: (erster Satzindex, letzter Satzindex inklusiv) oder None, wenn
    nichts Sinnvolles herauskommt.
    """
    sents = t.sentences
    if not sents:
        return None
    # Satz, dessen Anfang am naechsten an start_s liegt
    i = min(range(len(sents)), key=lambda k: abs(sents[k].start - start_s))
    # Satz, dessen Ende am naechsten an end_s liegt, aber nicht vor i
    j = min(range(i, len(sents)), key=lambda k: abs(sents[k].end - end_s))
    return _fit_length(t, i, j, opts, duration)


def _span(sents: list[Sentence], i: int, j: int) -> float:
    return sents[j].end - sents[i].start


def _fit_length(t: Transcript, i: int, j: int, opts: SelectionOptions, duration: float) -> tuple[int, int] | None:
    sents = t.sentences
    n = len(sents)
    i = max(0, min(i, n - 1))
    j = max(i, min(j, n - 1))
    # zu kurz: hinten anhaengen, sonst vorne
    guard = 0
    while _span(sents, i, j) < opts.min_len_s and guard < n:
        guard += 1
        if j + 1 < n and (_span(sents, i, j + 1) <= opts.max_len_s or _span(sents, i, j) < opts.min_len_s * 0.5):
            j += 1
        elif i - 1 >= 0:
            i -= 1
        else:
            break
    # zu lang: hinten kuerzen, solange es nicht unter das Minimum faellt, sonst vorne
    guard = 0
    while _span(sents, i, j) > opts.max_len_s and j > i and guard < n:
        guard += 1
        if _span(sents, i, j - 1) >= opts.min_len_s * 0.8:
            j -= 1
        elif _span(sents, i + 1, j) >= opts.min_len_s * 0.8 and i + 1 <= j:
            i += 1
        else:
            j -= 1
    if _span(sents, i, j) < 2.0:
        return None
    return i, j


def _bounds_with_air(t: Transcript, i: int, j: int, duration: float) -> tuple[float, float]:
    """Kleine Luft vor dem ersten und nach dem letzten Wort, ohne in Nachbarsaetze zu laufen."""
    sents = t.sentences
    start = sents[i].start - 0.2
    if i > 0:
        # hoechstens bis zur Mitte der Luecke zum Vorsatz, so beruehren sich Nachbarclips nie
        start = max(start, (sents[i - 1].end + sents[i].start) / 2)
    start = max(0.0, start)
    end = sents[j].end + 0.35
    if j + 1 < len(sents):
        end = min(end, (sents[j].end + sents[j + 1].start) / 2)
    end = min(duration, max(end, sents[j].end))
    return round(start, 3), round(end, 3)


def _overlap(a: ClipPlan, b: ClipPlan) -> float:
    inter = max(0.0, min(a.end_s, b.end_s) - max(a.start_s, b.start_s))
    shorter = max(0.1, min(a.duration, b.duration))
    return inter / shorter


def _auto_count(duration: float, opts: SelectionOptions) -> int:
    """Anzahl passend zur Laenge: etwa ein Clip je 2 Minuten, 1..12."""
    if opts.mode == "auto_cut":
        return 1
    if opts.mode == "manual":
        return 3
    return max(1, min(12, round(duration / 120.0)))


# ------------------------------------------------------------ Heuristik

_WINDOW_BONUS = 6.0  # jedes zusaetzliche Fenster ist erwuenscht, wenn der Nutzer die Anzahl vorgibt


def _best_disjoint(candidates: list[ClipPlan], want: int) -> list[ClipPlan]:
    """Waehlt hoechstens `want` Fenster ohne Ueberlappung mit maximaler Gesamtpunktzahl.

    Klassische gewichtete Intervallauswahl mit Obergrenze: Fenster nach Endsatz
    sortieren, fuer jedes Fenster das letzte davor liegende disjunkte Fenster
    per Binaersuche bestimmen, dann dp[k][m] = beste Summe mit hoechstens k
    Fenstern unter den ersten m Kandidaten. Zwei Fenster gelten als disjunkt,
    wenn der letzte Satz des einen vor dem ersten Satz des anderen liegt.
    """
    if not candidates or want <= 0:
        return []
    cands = sorted(candidates, key=lambda c: (c.sentence_end, c.sentence_start))
    m_total = len(cands)
    ends = [c.sentence_end for c in cands]

    import bisect

    # prev[m]: Anzahl der Kandidaten (Praefixlaenge), deren Endsatz vor dem Startsatz von cands[m] liegt
    prev = [bisect.bisect_left(ends, c.sentence_start) for c in cands]

    k_max = min(want, m_total)
    # dp[k] ist eine Liste ueber Praefixlaengen 0..m_total
    dp = [[0.0] * (m_total + 1) for _ in range(k_max + 1)]
    take = [[False] * (m_total + 1) for _ in range(k_max + 1)]
    for k in range(1, k_max + 1):
        row, row_prev, take_row = dp[k], dp[k - 1], take[k]
        for m in range(1, m_total + 1):
            skip = row[m - 1]
            c = cands[m - 1]
            with_c = row_prev[prev[m - 1]] + c.score + _WINDOW_BONUS
            if with_c > skip:
                row[m] = with_c
                take_row[m] = True
            else:
                row[m] = skip

    picked: list[ClipPlan] = []
    k, m = k_max, m_total
    while k > 0 and m > 0:
        if take[k][m]:
            picked.append(cands[m - 1])
            m = prev[m - 1]
            k -= 1
        else:
            m -= 1
    picked.sort(key=lambda c: c.sentence_start)
    return picked


def select_heuristic(t: Transcript, duration: float, opts: SelectionOptions, avoid: list[ClipPlan] | None = None) -> list[ClipPlan]:
    """Fenster aus Saetzen bilden, bewerten, die besten ohne Ueberlappung nehmen."""
    sents = t.sentences
    if not sents:
        return []
    scores = _sentence_scores(t)
    n = len(sents)
    want = opts.count or _auto_count(duration, opts)

    # Kandidatenfenster: jeder Satz als Anfang, jedes Ende innerhalb der Grenzen.
    # Alle Laengen bleiben Kandidaten, damit die Auswahl ohne Ueberlappung auch
    # kuerzere Fenster in Luecken legen kann.
    candidates: list[ClipPlan] = []
    for i in range(n):
        j = i
        while j < n and _span(sents, i, j) <= opts.max_len_s + 0.5:
            span = _span(sents, i, j)
            if span >= opts.min_len_s or (j == n - 1 and span >= opts.min_len_s * 0.5):
                cnt = j - i + 1
                total = sum(scores[k][0] for k in range(i, j + 1))
                score = total / math.sqrt(cnt) + 1.5 * scores[i][0]
                gap_after = (sents[j + 1].start - sents[j].end) if j + 1 < n else 1.0
                if gap_after >= 0.5:
                    score += 0.5
                if re.search(r"[.!?]$", sents[j].text):
                    score += 0.4
                if span < opts.min_len_s:
                    score -= 1.0
                candidates.append(
                    ClipPlan(
                        start_s=sents[i].start, end_s=sents[j].end, title="", hook="", score=score,
                        sentence_start=i, sentence_end=j, tags=list(scores[i][1]),
                    )
                )
            j += 1
    if not candidates:
        return []

    # Fenster, die schon gewaehlte Clips (z. B. vom Sprachmodell) beruehren, fallen weg
    if avoid:
        candidates = [c for c in candidates if all(_overlap(c, o) <= 0.0 for o in avoid)]
        if not candidates:
            return []

    # Runde 1: die beste Kombination aus hoechstens `want` Fenstern OHNE Ueberlappung
    # (dynamische Optimierung ueber die nach Endsatz sortierten Fenster).
    picked = _best_disjoint(candidates, want)

    # Runde 2 und 3: nur wenn der Nutzer mehr Clips will, als nebeneinander passen,
    # duerfen sich Fenster bis 40 % und zuletzt fast beliebig ueberlappen.
    if len(picked) < want:
        chosen: list[ClipPlan] = list(avoid or []) + list(picked)
        ranked = sorted(candidates, key=lambda c: c.score, reverse=True)
        for max_ov in (0.4, 0.95):
            for c in ranked:
                if len(picked) >= want:
                    break
                if any(p.sentence_start == c.sentence_start for p in picked):
                    continue
                if all(_overlap(c, o) <= max_ov for o in chosen):
                    picked.append(c)
                    chosen.append(c)
            if len(picked) >= want:
                break

    for c in picked:
        fit = _fit_length(t, c.sentence_start, c.sentence_end, opts, duration)
        if fit:
            c.sentence_start, c.sentence_end = fit
        c.start_s, c.end_s = _bounds_with_air(t, c.sentence_start, c.sentence_end, duration)
        head = sents[c.sentence_start].text
        c.title = _tidy_title(head)
        c.hook = _shorten(head)
        c.why = _explain(scores, c.sentence_start, c.sentence_end)
    picked.sort(key=lambda c: c.start_s)
    return picked


def _explain(scores: list[tuple[float, list[str]]], i: int, j: int) -> str:
    """Begruendung fuer den Clip [i..j], passend zu den Grenzen NACH dem Laengenausgleich.

    Zuerst die Merkmale des Einstiegssatzes; traegt ein spaeterer Satz im Clip
    die staerksten Merkmale (z. B. weil der Clip nach vorn verlaengert wurde),
    wird er mit Satznummer dazugenannt."""
    head_tags = list(scores[i][1]) if i < len(scores) else []
    best_k, best_score = i, scores[i][0] if i < len(scores) else 0.0
    for k in range(i + 1, min(j, len(scores) - 1) + 1):
        if scores[k][0] > best_score + 0.5:
            best_k, best_score = k, scores[k][0]
    parts: list[str] = []
    if head_tags:
        parts.append("Einstieg: " + ", ".join(head_tags))
    if best_k != i and scores[best_k][1]:
        parts.append(f"Satz {best_k - i + 1} im Clip: " + ", ".join(scores[best_k][1]))
    return "; ".join(parts) if parts else "ruhiger Abschnitt mit ganzem Satzbogen"


def heuristic_summary(t: Transcript, max_chars: int = 320) -> str:
    text = " ".join(s.text for s in t.sentences[:4])
    return _shorten(text, max_chars) if text else "Kein Sprachanteil erkannt."


# --------------------------------------------------------- Sprachmodell

_LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions"


class _LlmClip(BaseModel):
    start_s: float
    end_s: float
    title: str = ""
    hook: str = ""
    why: str = Field(default="", alias="warum")

    model_config = {"populate_by_name": True}


class _LlmAnswer(BaseModel):
    summary: str = ""
    clips: list[_LlmClip] = Field(default_factory=list)


def _transcript_listing(t: Transcript, max_chars: int = 180_000) -> str:
    lines = []
    total = 0
    for s in t.sentences:
        line = f"[{s.index}] {s.start:.1f}-{s.end:.1f}: {s.text}"
        total += len(line) + 1
        if total > max_chars:
            lines.append("[...] (Transkript gekuerzt)")
            break
        lines.append(line)
    return "\n".join(lines)


def _build_prompt(t: Transcript, duration: float, opts: SelectionOptions, want: int) -> str:
    mode_rules = {
        "ugc_shorts": "Kurze, energische Shorts mit starkem Einstieg (Hook) in den ersten zwei Sekunden.",
        "long_to_many": "Jeder Clip behandelt ein eigenes, in sich abgeschlossenes Thema und braucht keinen Kontext.",
        "auto_cut": "Ein einziger, durchgehender Clip mit dem staerksten Abschnitt.",
        "manual": "Drei bis fuenf brauchbare Vorschlaege, aus denen der Mensch waehlt.",
    }.get(opts.mode, "Kurze, eigenstaendige Clips mit starkem Einstieg.")
    hint = f'Titel des Videos: "{opts.title_hint}"\n' if opts.title_hint else ""
    return f"""Du bist ein erfahrener Cutter fuer Kurzvideos (TikTok, Reels, Shorts).
Unten steht das Transkript eines Videos ({duration:.0f} Sekunden, Sprache {t.language}) als nummerierte Saetze mit Zeitmarken in Sekunden.
{hint}
Aufgabe: Waehle GENAU {want} Stellen, die als eigenstaendige Clips funktionieren.
Regeln:
- Jeder Clip ist {opts.min_len_s:.0f} bis {opts.max_len_s:.0f} Sekunden lang.
- start_s ist der Anfang eines Satzes, end_s das Ende eines Satzes. Nie mitten im Satz schneiden.
- Clips ueberlappen sich nicht. Beste Stellen zuerst nach Wirkung, dann nach Zeit sortiert.
- Der erste Satz eines Clips muss neugierig machen (Frage, Zahl, ueberraschende Aussage, klare Ansage).
- Modus: {mode_rules}
- title: 3 bis 7 Woerter, ohne Anfuehrungszeichen. hook: der Einstiegssatz, hoechstens 140 Zeichen. warum: ein kurzer Grund.
- summary: 2 bis 3 Saetze, worum es im Video geht.

Antworte NUR mit JSON in dieser Form:
{{"summary": "...", "clips": [{{"start_s": 12.3, "end_s": 48.9, "title": "...", "hook": "...", "warum": "..."}}]}}

TRANSKRIPT:
{_transcript_listing(t)}
"""


def _call_lovable(api_key: str, model: str, prompt: str, timeout_s: float = 180.0) -> str:
    """Ruft das Lovable-Gateway auf, liefert den Antworttext. Ein Wiederholungsversuch bei 429/5xx."""
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
    }
    last_err = ""
    with httpx.Client(timeout=httpx.Timeout(30.0, read=timeout_s)) as client:
        for attempt in range(2):
            resp = client.post(_LOVABLE_URL, headers={"Content-Type": "application/json", "Lovable-API-Key": api_key}, json=body)
            if resp.status_code == 200:
                payload = resp.json()
                content = ((payload.get("choices") or [{}])[0].get("message") or {}).get("content")
                if not content:
                    raise SelectError("Lovable AI: leere Antwort")
                return str(content)
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
            if resp.status_code == 402:
                raise SelectError("Lovable AI: Credits aufgebraucht (402)")
            if resp.status_code in (429, 500, 502, 503, 504) and attempt == 0:
                time.sleep(6)
                continue
            break
    raise SelectError(f"Lovable AI fehlgeschlagen: {last_err}")


def _parse_llm_answer(text: str) -> _LlmAnswer:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S)
    try:
        data = json.loads(raw)
    except ValueError:
        # letzte Rettung: das erste {...} herausschneiden
        m = re.search(r"\{.*\}", raw, flags=re.S)
        if not m:
            raise SelectError("Lovable AI: Antwort war kein JSON")
        data = json.loads(m.group(0))
    if isinstance(data, dict) and "clips" not in data and "segments" in data:
        data["clips"] = data.pop("segments")
    try:
        return _LlmAnswer.model_validate(data)
    except ValidationError as e:
        raise SelectError(f"Lovable AI: JSON hat nicht die erwartete Form: {e.errors()[:2]}") from e


def select_with_lovable(t: Transcript, duration: float, opts: SelectionOptions, api_key: str, model: str) -> tuple[list[ClipPlan], str]:
    want = opts.count or _auto_count(duration, opts)
    prompt = _build_prompt(t, duration, opts, want)
    t0 = time.time()
    answer = _parse_llm_answer(_call_lovable(api_key, model, prompt))
    log.info("Lovable AI (%s) antwortete in %.1f s mit %d Clips", model, time.time() - t0, len(answer.clips))

    clips: list[ClipPlan] = []
    for c in answer.clips:
        if not (math.isfinite(c.start_s) and math.isfinite(c.end_s)) or c.end_s <= c.start_s:
            continue
        fit = _snap(t, c.start_s, c.end_s, opts, duration)
        if not fit:
            continue
        i, j = fit
        start, end = _bounds_with_air(t, i, j, duration)
        head = t.sentences[i].text
        plan = ClipPlan(
            start_s=start, end_s=end,
            title=_tidy_title(c.title) if c.title.strip() else _tidy_title(head),
            hook=_shorten(c.hook) if c.hook.strip() else _shorten(head),
            why=_shorten(c.why, 200) if c.why else "vom Sprachmodell gewaehlt",
            score=10.0, sentence_start=i, sentence_end=j, tags=["Sprachmodell"],
        )
        if all(_overlap(plan, o) < 0.6 for o in clips):
            clips.append(plan)
    clips.sort(key=lambda c: c.start_s)
    return clips[:want], answer.summary.strip()


# ------------------------------------------------------------- Einstieg


def select_clips(
    t: Transcript,
    duration: float,
    opts: SelectionOptions,
    lovable_api_key: str | None = None,
    lovable_model: str = "google/gemini-2.5-flash",
) -> SelectionResult:
    """Waehlt die Stellen aus. Mit Schluessel ueber das Sprachmodell, sonst Heuristik.
    Liefert das Sprachmodell zu wenige Clips, fuellt die Heuristik auf."""
    if not t.sentences:
        raise SelectError("Transkript ohne Saetze, keine Auswahl moeglich")
    opts = opts.normalized(duration)
    want = opts.count or _auto_count(duration, opts)

    clips: list[ClipPlan] = []
    summary = ""
    method = "heuristic"
    if lovable_api_key:
        try:
            clips, summary = select_with_lovable(t, duration, opts, lovable_api_key, lovable_model)
            method = "lovable"
        except (SelectError, httpx.HTTPError) as e:
            log.warning("Sprachmodell nicht nutzbar, weiche auf Heuristik aus: %s", e)
            clips, summary, method = [], "", "heuristic"

    if len(clips) < want:
        missing_opts = SelectionOptions(opts.min_len_s, opts.max_len_s, want - len(clips), opts.mode, opts.title_hint)
        extra = select_heuristic(t, duration, missing_opts, avoid=clips)
        if extra and method == "lovable":
            method = "lovable+heuristic"
        clips = sorted(clips + extra, key=lambda c: c.start_s)

    if not clips:
        raise SelectError("Keine Stelle gefunden, die in die Laengengrenzen passt")
    if not summary:
        summary = heuristic_summary(t)
    return SelectionResult(clips=clips[:want], summary=summary, method=method)


def analysis_payload(result: SelectionResult, t: Transcript, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Baut das JSON fuer edit_jobs.analysis im Format, das die Web-App liest."""
    segments = []
    for c in result.clips:
        segments.append(
            {
                "start_s": round(c.start_s, 3),
                "end_s": round(c.end_s, 3),
                "title": c.title,
                "hook": c.hook,
                "why": c.why,
            }
        )
    payload: dict[str, Any] = {
        "transcript_summary": result.summary,
        "language": t.language,
        "segments": segments,
        "engine": "worker",
        "selection_method": result.method,
        "transcript_engine": t.engine,
        "word_count": len(t.words),
    }
    if extra:
        payload.update(extra)
    return payload
