"""Zugriff auf Supabase mit dem Service-Role-Schluessel.

Der Worker liest und schreibt nur drei Tabellen:
  edit_jobs        Auftrag, Status, Fortschritt, Analyse, Fehler
  raw_videos       Quelle (Storage-Pfad oder Link)
  generated_clips  fertige Clips

Beanspruchen eines Auftrags: options.worker_id wird gesetzt, aber nur wenn
es vorher leer war (Bedingung im UPDATE). So holen sich zwei Worker nie
denselben Auftrag.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from supabase import Client, create_client

log = logging.getLogger("karam.db")

JobRow = dict[str, Any]


class DbError(RuntimeError):
    """Datenbankzugriff fehlgeschlagen."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    """Duenne Huelle um den Supabase-Client fuer genau die Worker-Zugriffe."""

    def __init__(self, url: str, service_role_key: str) -> None:
        self.client: Client = create_client(url, service_role_key)

    # ------------------------------------------------------------------ Lesen

    def fetch_open_jobs(self, limit: int = 5) -> list[JobRow]:
        """Auftraege, die auf einen Worker warten.

        Bedingungen: status = analyzing, options.engine = worker,
        options.worker_id leer. Aelteste zuerst.
        """
        res = (
            self.client.table("edit_jobs")
            .select("*, raw_videos(*)")
            .eq("status", "analyzing")
            .eq("options->>engine", "worker")
            .is_("options->>worker_id", "null")
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
        return list(res.data or [])

    def fetch_job(self, job_id: str) -> JobRow:
        res = (
            self.client.table("edit_jobs")
            .select("*, raw_videos(*)")
            .eq("id", job_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            raise DbError(f"Auftrag {job_id} nicht gefunden")
        return rows[0]

    # ------------------------------------------------------------ Beanspruchen

    def claim_job(self, job_id: str, worker_id: str, force: bool = False) -> JobRow | None:
        """Setzt options.worker_id, wenn es noch leer ist.

        Rueckgabe: der Auftrag (mit Quelle), oder None, wenn ein anderer
        Worker schneller war. Mit force=True wird ein bestehender worker_id
        ueberschrieben (fuer manuelles Neu-Verarbeiten).
        """
        job = self.fetch_job(job_id)
        options = dict(job.get("options") or {})
        options["worker_id"] = worker_id
        options["worker_phase"] = "claimed"
        options["worker_heartbeat"] = _now_iso()
        options.setdefault("engine", "worker")

        query = self.client.table("edit_jobs").update(
            {"options": options, "status": "analyzing", "progress": 0, "error": None}
        ).eq("id", job_id)
        if not force:
            query = query.is_("options->>worker_id", "null")
        res = query.execute()
        if not res.data:
            return None
        job["options"] = options
        job["status"] = "analyzing"
        job["progress"] = 0
        return job

    # ---------------------------------------------------------- Fortschritt

    def set_progress(self, job_id: str, progress: int, phase: str | None = None) -> None:
        """Schreibt progress (0..100) und merkt sich Phase + Herzschlag in options."""
        patch: dict[str, Any] = {"progress": max(0, min(100, int(progress)))}
        if phase is not None:
            options = self._read_options(job_id)
            options["worker_phase"] = phase
            options["worker_heartbeat"] = _now_iso()
            patch["options"] = options
        self.client.table("edit_jobs").update(patch).eq("id", job_id).execute()

    def write_analysis(self, job_id: str, analysis: dict[str, Any], progress: int) -> None:
        """Legt die Analyse ab. Status bleibt 'analyzing', damit die Oberflaeche
        weiter alle 2 s nachlaedt und die Clips beim Rendern sieht."""
        options = self._read_options(job_id)
        options["worker_phase"] = "analysis_written"
        options["worker_heartbeat"] = _now_iso()
        self.client.table("edit_jobs").update(
            {"analysis": analysis, "progress": progress, "options": options}
        ).eq("id", job_id).execute()

    def finish_job(self, job_id: str, clip_count: int) -> None:
        options = self._read_options(job_id)
        options["worker_phase"] = "done"
        options["worker_heartbeat"] = _now_iso()
        options["worker_clip_count"] = clip_count
        self.client.table("edit_jobs").update(
            {"status": "done", "progress": 100, "error": None, "options": options}
        ).eq("id", job_id).execute()

    def fail_job(self, job_id: str, message: str) -> None:
        """Status failed + Fehlertext. Der worker_id bleibt stehen, damit man
        sieht, welcher Rechner es versucht hat; erneutes Anstossen aus der
        Web-App setzt worker_id wieder auf leer."""
        try:
            options = self._read_options(job_id)
            options["worker_phase"] = "failed"
            options["worker_heartbeat"] = _now_iso()
        except Exception:  # noqa: BLE001 - beim Fehlerfall lieber ohne Optionen als gar nicht
            options = None
        patch: dict[str, Any] = {"status": "failed", "error": message[:4000]}
        if options is not None:
            patch["options"] = options
        self.client.table("edit_jobs").update(patch).eq("id", job_id).execute()

    # ----------------------------------------------------------------- Clips

    def insert_clip(
        self,
        *,
        job_id: str,
        user_id: str,
        brand_id: str | None,
        storage_path: str,
        duration_s: float,
        title: str,
        caption_srt: str | None,
        meta: dict[str, Any],
        aspect: str = "9:16",
    ) -> str:
        """Legt eine Zeile in generated_clips an und gibt die id zurueck."""
        row: dict[str, Any] = {
            "job_id": job_id,
            "user_id": user_id,
            "storage_path": storage_path,
            "aspect": aspect,
            "duration_s": round(float(duration_s), 3),
            "title": title[:200],
            "caption_srt": caption_srt,
            "meta": meta,
        }
        if brand_id:
            row["brand_id"] = brand_id
        res = self.client.table("generated_clips").insert(row).execute()
        if not res.data:
            raise DbError("generated_clips: Einfuegen lieferte keine Zeile zurueck")
        return str(res.data[0]["id"])

    def delete_worker_clips(self, job_id: str) -> int:
        """Entfernt fruehere Worker-Clips eines Auftrags (bei Neu-Verarbeitung)."""
        res = (
            self.client.table("generated_clips")
            .delete()
            .eq("job_id", job_id)
            .eq("meta->>engine", "worker")
            .execute()
        )
        return len(res.data or [])

    # --------------------------------------------------------------- Storage

    def signed_download_url(self, bucket: str, path: str, expires_s: int = 3600) -> str:
        res = self.client.storage.from_(bucket).create_signed_url(path, expires_s)
        url = res.get("signedURL") or res.get("signedUrl") if isinstance(res, dict) else None
        if not url:
            raise DbError(f"Keine signierte URL fuer {bucket}/{path} erhalten: {res!r}")
        return url

    # ---------------------------------------------------------------- intern

    def _read_options(self, job_id: str) -> dict[str, Any]:
        res = self.client.table("edit_jobs").select("options").eq("id", job_id).limit(1).execute()
        rows = res.data or []
        if not rows:
            raise DbError(f"Auftrag {job_id} nicht gefunden")
        return dict(rows[0].get("options") or {})
