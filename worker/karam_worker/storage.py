"""Upload der fertigen Clips in den Bucket rendered-clips.

Pfad: {user_id}/{job_id}/{n}.mp4. Der erste Ordner muss die user_id sein,
sonst darf die Web-App die Datei per RLS nicht lesen.

Zwei Wege, passend zu den beiden Modi des Workers:

  Direktmodus  upload_clip_direct: mit dem Service-Role-Schluessel direkt in
               den Bucket (upsert).
  API-Modus    upload_clip_signed: die App hat vorher ueber
               /api/worker/upload-url ein signiertes Ziel erzeugt; der Worker
               laedt mit dem oeffentlichen Schluessel und dem Token dorthin.
               Ein Service-Role-Schluessel liegt auf diesem Rechner nie.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from supabase import create_client

from .errors import WorkerError

log = logging.getLogger("karam.storage")

BUCKET_RENDERED = "rendered-clips"
BUCKET_RAW = "raw-videos"


class StorageError(WorkerError):
    pass


def clip_storage_path(user_id: str, job_id: str, n: int) -> str:
    return f"{user_id}/{job_id}/{n}.mp4"


def _pruefe_datei(local_file: Path) -> int:
    if not local_file.is_file():
        raise StorageError(f"Clip-Datei fehlt: {local_file}")
    size = local_file.stat().st_size
    if size == 0:
        raise StorageError(f"Clip-Datei ist leer: {local_file}")
    return size


# ------------------------------------------------------------- Direktmodus


def upload_clip_direct(db: Any, local_file: Path, storage_path: str) -> str:
    """Laedt eine MP4 hoch (ueberschreibt, falls schon vorhanden) und gibt den Pfad zurueck."""
    size = _pruefe_datei(local_file)
    data = local_file.read_bytes()
    try:
        db.client.storage.from_(BUCKET_RENDERED).upload(
            storage_path,
            data,
            {"content-type": "video/mp4", "upsert": "true"},
        )
    except Exception as e:  # noqa: BLE001 - Fehlertext des Clients weiterreichen
        raise StorageError(f"Upload nach {BUCKET_RENDERED}/{storage_path} fehlgeschlagen: {e}") from e
    log.info("Hochgeladen: %s (%.1f MB)", storage_path, size / 1_048_576)
    return storage_path


# ---------------------------------------------------------------- API-Modus


def upload_clip_signed(
    *,
    supabase_url: str,
    publishable_key: str,
    path: str,
    token: str,
    local_file: Path,
    signed_url: str = "",
    allow_file_urls: bool = False,
) -> str:
    """Laedt eine MP4 an ein signiertes Ziel aus /api/worker/upload-url.

    Der Aufruf ist genau der, den supabase-py 2.31 anbietet:
      client.storage.from_("rendered-clips")
            .upload_to_signed_url(path, token, daten, {"content-type": "video/mp4"})
    """
    size = _pruefe_datei(local_file)

    # Testpfad: ein lokaler Nachbau der API kann statt einer https-Adresse eine
    # file://-Adresse liefern. Nur aktiv, wenn WORKER_ALLOW_FILE_URLS gesetzt ist,
    # im Normalbetrieb also nie.
    if allow_file_urls and signed_url.startswith("file://"):
        ziel = Path(unquote(urlparse(signed_url).path.lstrip("/")))
        ziel.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_file, ziel)
        log.info("Hochgeladen (lokales Testziel): %s (%.1f MB)", ziel, size / 1_048_576)
        return path

    if not supabase_url or not publishable_key:
        raise StorageError(
            "Die App hat keinen Storage-Zugang mitgeschickt (storage.supabaseUrl oder storage.publishableKey "
            "fehlen in der Antwort von /api/worker/claim). Ohne den kann der Clip nicht hochgeladen werden."
        )
    try:
        client = create_client(supabase_url, publishable_key)
        client.storage.from_(BUCKET_RENDERED).upload_to_signed_url(
            path,
            token,
            local_file.read_bytes(),
            {"content-type": "video/mp4"},
        )
    except Exception as e:  # noqa: BLE001 - Fehlertext des Clients weiterreichen
        raise StorageError(
            f"Upload nach {BUCKET_RENDERED}/{path} ueber die signierte Adresse fehlgeschlagen: {e}. "
            "Meist ist das Ziel abgelaufen oder es lag dort schon eine Datei; Auftrag erneut anstossen."
        ) from e
    log.info("Hochgeladen: %s (%.1f MB)", path, size / 1_048_576)
    return path
