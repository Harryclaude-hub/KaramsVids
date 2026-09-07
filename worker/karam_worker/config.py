"""Konfiguration des Workers aus .env oder Umgebungsvariablen.

Gelesen wird zuerst eine .env im Ordner worker/ (neben dem Paket), danach
eine .env im aktuellen Arbeitsverzeichnis. Bereits gesetzte Umgebungsvariablen
haben Vorrang vor der Datei.
"""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


class ConfigError(RuntimeError):
    """Pflichtangabe fehlt oder ist unbrauchbar."""


def _load_env_files() -> list[Path]:
    """Laedt .env-Dateien und gibt die tatsaechlich gefundenen zurueck."""
    candidates = [
        Path(__file__).resolve().parent.parent / ".env",  # worker/.env
        Path.cwd() / ".env",
    ]
    found: list[Path] = []
    for p in candidates:
        if p.is_file():
            load_dotenv(p, override=False)
            found.append(p)
    return found


def _default_work_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / "KaramsVids" / "work"
    return Path.home() / ".karamsvids" / "work"


def _default_worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"


@dataclass
class Settings:
    """Alle Einstellungen des Workers an einem Ort."""

    supabase_url: str | None
    service_role_key: str | None
    groq_api_key: str | None
    lovable_api_key: str | None
    whisper_model: str
    work_dir: Path
    worker_id: str
    poll_seconds: int
    # Modell hinter dem Lovable-Gateway fuer die Auswahl der Stellen
    lovable_model: str = "google/gemini-2.5-flash"
    # Groq-Modell fuer die Transkription
    groq_model: str = "whisper-large-v3-turbo"
    # Beam-Breite bei faster-whisper (1 = schnell, 5 = genauer)
    whisper_beam: int = 5
    # Optionaler fester Pfad zu ffmpeg (sonst PATH und WinGet-Ordner)
    ffmpeg_path: str | None = None
    # Arbeitsordner nach Erfolg behalten (zum Nachschauen)
    keep_work: bool = False
    # Wo die .env gefunden wurde (nur fuer die Ausgabe)
    env_files: list[Path] = field(default_factory=list)

    @property
    def has_supabase(self) -> bool:
        return bool(self.supabase_url and self.service_role_key)

    def require_supabase(self) -> None:
        """Wirft einen klaren Fehler, wenn die Supabase-Zugangsdaten fehlen."""
        missing = []
        if not self.supabase_url:
            missing.append("SUPABASE_URL")
        if not self.service_role_key:
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
        if missing:
            raise ConfigError(
                "Pflichtangaben fehlen: "
                + ", ".join(missing)
                + ". Trage sie in worker/.env ein (Vorlage: worker/.env.example)."
            )


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as e:
        raise ConfigError(f"{name} muss eine ganze Zahl sein, ist aber '{raw}'") from e


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "ja", "on"}


def load_settings() -> Settings:
    """Liest .env und Umgebung ein und liefert die Einstellungen."""
    env_files = _load_env_files()

    work_dir_raw = os.environ.get("WORK_DIR", "").strip()
    work_dir = Path(work_dir_raw).expanduser() if work_dir_raw else _default_work_dir()

    poll = _int_env("POLL_SECONDS", 10)
    if poll < 2:
        poll = 2

    beam = _int_env("WHISPER_BEAM", 5)
    if beam < 1:
        beam = 1

    return Settings(
        supabase_url=(os.environ.get("SUPABASE_URL") or "").strip().rstrip("/") or None,
        service_role_key=(os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip() or None,
        groq_api_key=(os.environ.get("GROQ_API_KEY") or "").strip() or None,
        lovable_api_key=(os.environ.get("LOVABLE_API_KEY") or "").strip() or None,
        whisper_model=(os.environ.get("WHISPER_MODEL") or "small").strip(),
        work_dir=work_dir,
        worker_id=(os.environ.get("WORKER_ID") or "").strip() or _default_worker_id(),
        poll_seconds=poll,
        lovable_model=(os.environ.get("LOVABLE_MODEL") or "google/gemini-2.5-flash").strip(),
        groq_model=(os.environ.get("GROQ_MODEL") or "whisper-large-v3-turbo").strip(),
        whisper_beam=beam,
        ffmpeg_path=(os.environ.get("FFMPEG_PATH") or "").strip() or None,
        keep_work=_bool_env("KEEP_WORK", False),
        env_files=env_files,
    )
