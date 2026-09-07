"""Upload der fertigen Clips in den Bucket rendered-clips.

Pfad: {user_id}/{job_id}/{n}.mp4. Der erste Ordner muss die user_id sein,
sonst darf die Web-App die Datei per RLS nicht lesen.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .db import Database

log = logging.getLogger("karam.storage")

BUCKET_RENDERED = "rendered-clips"
BUCKET_RAW = "raw-videos"


class StorageError(RuntimeError):
    pass


def clip_storage_path(user_id: str, job_id: str, n: int) -> str:
    return f"{user_id}/{job_id}/{n}.mp4"


def upload_clip(db: Database, local_file: Path, storage_path: str) -> str:
    """Laedt eine MP4 hoch (ueberschreibt, falls schon vorhanden) und gibt den Pfad zurueck."""
    if not local_file.is_file():
        raise StorageError(f"Clip-Datei fehlt: {local_file}")
    size = local_file.stat().st_size
    if size == 0:
        raise StorageError(f"Clip-Datei ist leer: {local_file}")

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
