"""Zugriff auf Auftraege, Clips und Storage.

Es gibt zwei Wege, und main.py kennt nur die gemeinsame Schnittstelle JobStore:

  ApiStore     spricht ueber HTTP mit der Web-App (/api/worker/*). Standard auf
               Lovable Cloud, weil es dort keinen Service-Role-Schluessel gibt.
  DirectStore  greift mit dem Service-Role-Schluessel direkt auf Supabase zu
               (fuer Nutzer mit eigenem Supabase-Projekt).

Der Worker liest und schreibt nur drei Tabellen:
  edit_jobs        Auftrag, Status, Fortschritt, Analyse, Fehler
  raw_videos       Quelle (Storage-Pfad oder Link)
  generated_clips  fertige Clips

Beanspruchen eines Auftrags: options.worker_id wird gesetzt, aber nur wenn
es vorher leer war (Bedingung im UPDATE). So holen sich zwei Worker nie
denselben Auftrag.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from supabase import Client, create_client

from .api_client import ApiClient
from .errors import WorkerError

log = logging.getLogger("karam.db")

JobRow = dict[str, Any]


class DbError(WorkerError):
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


# ============================================================== Schnittstelle
#
# Ab hier die gemeinsame Sicht fuer main.py. Die Pipeline weiss nicht, ob
# dahinter die Web-App (ApiStore) oder Supabase (DirectStore) steckt.


@dataclass
class JobSource:
    """Woher das Rohvideo kommt."""

    # "storage" = fertige Download-Adresse (signiert), "url" = Link fuer yt-dlp
    kind: str
    url: str
    title: str = ""
    duration_s: float | None = None
    # stabiler Name im Zwischenspeicher, damit ein zweiter Lauf nicht neu laedt
    cache_key: str = ""
    # gesetzt, wenn die Quelle nicht ermittelt werden konnte (die Pipeline
    # bricht dann sauber ab und der Auftrag wird als failed gemeldet)
    error: str | None = None


@dataclass
class ClaimedJob:
    """Ein beanspruchter Auftrag mit seiner Quelle."""

    row: JobRow
    source: JobSource

    @property
    def id(self) -> str:
        return str(self.row["id"])


def _cache_key(kind: str, url: str, raw_id: str | None, job_id: str) -> str:
    """Kurzer, gleichbleibender Name fuer die Datei im Zwischenspeicher.

    Bei signierten Storage-Adressen bleibt der Abfrageteil (Token, Ablauf)
    aussen vor, sonst waere der Name bei jedem Lauf ein anderer.
    """
    if raw_id:
        return str(raw_id)
    basis = url.split("?", 1)[0] if kind == "storage" else url
    if not basis:
        basis = job_id
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


class JobStore(Protocol):
    """Was die Pipeline von der Aussenwelt braucht."""

    kind: str

    def claim_next(self) -> ClaimedJob | None: ...
    def claim_specific(self, job_id: str) -> ClaimedJob | None: ...
    def set_progress(self, job_id: str, progress: int, phase: str | None = None) -> None: ...
    def write_analysis(self, job_id: str, analysis: dict[str, Any], progress: int) -> None: ...
    def reset_clips(self, job_id: str) -> int: ...
    def upload_clip(self, job_id: str, user_id: str, n: int, local_file: Path) -> str: ...
    def add_clip(
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
        aspect: str,
    ) -> str: ...
    def finish(self, job_id: str, clip_count: int) -> None: ...
    def fail(self, job_id: str, message: str) -> None: ...
    def close(self) -> None: ...


# --------------------------------------------------------------- Direktmodus


class DirectStore:
    """Direkt auf Supabase, mit dem Service-Role-Schluessel."""

    kind = "direkt"

    def __init__(self, url: str, service_role_key: str, worker_id: str, *, source_expires_s: int = 3 * 3600) -> None:
        self.db = Database(url, service_role_key)
        self.worker_id = worker_id
        self.url = url
        self.source_expires_s = source_expires_s

    # ------------------------------------------------------- beanspruchen

    def claim_next(self) -> ClaimedJob | None:
        for row in self.db.fetch_open_jobs():
            job_id = str(row["id"])
            try:
                claimed = self.db.claim_job(job_id, self.worker_id)
            except Exception as e:  # noqa: BLE001 - beim naechsten Durchlauf erneut versuchen
                log.warning("Auftrag %s konnte nicht beansprucht werden: %s", job_id, e)
                continue
            if claimed is None:
                log.info("Auftrag %s hat sich ein anderer Worker geholt", job_id)
                continue
            return ClaimedJob(row=claimed, source=self._source(claimed))
        return None

    def claim_specific(self, job_id: str) -> ClaimedJob | None:
        claimed = self.db.claim_job(job_id, self.worker_id, force=True)
        if claimed is None:
            return None
        return ClaimedJob(row=claimed, source=self._source(claimed))

    def _source(self, row: JobRow) -> JobSource:
        """Quelle aus raw_videos: Storage-Pfad wird zur signierten Adresse (3 h)."""
        raw = row.get("raw_videos") or {}
        if isinstance(raw, list):
            raw = raw[0] if raw else {}
        titel = str(raw.get("title") or "")
        dauer_roh = raw.get("duration_s")
        try:
            dauer = float(dauer_roh) if dauer_roh is not None else None
        except (TypeError, ValueError):
            dauer = None
        raw_id = str(raw.get("id")) if raw.get("id") else None
        pfad = raw.get("storage_path") or None
        link = raw.get("source_url") or None
        job_id = str(row["id"])

        if pfad:
            try:
                url = self.db.signed_download_url("raw-videos", str(pfad), self.source_expires_s)
            except Exception as e:  # noqa: BLE001 - Fehler erst in der Pipeline melden, damit der Auftrag failed wird
                return JobSource(
                    kind="storage", url="", title=titel, duration_s=dauer,
                    error=f"Signierte Adresse fuer raw-videos/{pfad} nicht erhalten: {e}",
                )
            return JobSource(
                kind="storage", url=url, title=titel, duration_s=dauer,
                cache_key=_cache_key("storage", url, raw_id, job_id),
            )
        if link:
            return JobSource(
                kind="url", url=str(link), title=titel, duration_s=dauer,
                cache_key=_cache_key("url", str(link), raw_id, job_id),
            )
        return JobSource(
            kind="", url="", title=titel, duration_s=dauer,
            error="Das Rohvideo hat weder storage_path noch source_url",
        )

    # -------------------------------------------------- Fortschritt und Ende

    def set_progress(self, job_id: str, progress: int, phase: str | None = None) -> None:
        self.db.set_progress(job_id, progress, phase)

    def write_analysis(self, job_id: str, analysis: dict[str, Any], progress: int) -> None:
        self.db.write_analysis(job_id, analysis, progress)

    def reset_clips(self, job_id: str) -> int:
        return self.db.delete_worker_clips(job_id)

    def upload_clip(self, job_id: str, user_id: str, n: int, local_file: Path) -> str:
        from .storage import clip_storage_path, upload_clip_direct

        pfad = clip_storage_path(user_id, job_id, n)
        upload_clip_direct(self.db, local_file, pfad)
        return pfad

    def add_clip(
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
        aspect: str,
    ) -> str:
        return self.db.insert_clip(
            job_id=job_id,
            user_id=user_id,
            brand_id=brand_id,
            storage_path=storage_path,
            duration_s=duration_s,
            title=title,
            caption_srt=caption_srt,
            meta=meta,
            aspect=aspect,
        )

    def finish(self, job_id: str, clip_count: int) -> None:
        self.db.finish_job(job_id, clip_count)

    def fail(self, job_id: str, message: str) -> None:
        self.db.fail_job(job_id, message)

    def close(self) -> None:
        return None


# ----------------------------------------------------------------- API-Modus


class ApiStore:
    """Ueber die Web-App. Auf diesem Rechner liegt nur das WORKER_SECRET."""

    kind = "api"

    def __init__(self, base_url: str, secret: str, worker_id: str, *, allow_file_urls: bool = False) -> None:
        self.api = ApiClient(base_url, secret, worker_id)
        self.worker_id = worker_id
        self.url = base_url
        self.allow_file_urls = allow_file_urls
        # Storage-Zugang je Auftrag aus der claim-Antwort (supabaseUrl, publishableKey)
        self._storage: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------- beanspruchen

    def claim_next(self) -> ClaimedJob | None:
        data = self.api.claim()
        if data is None:
            return None
        row = dict(data.get("job") or {})
        if not row.get("id"):
            raise DbError("claim: die Antwort enthaelt keinen Auftrag mit id")
        job_id = str(row["id"])
        self._storage[job_id] = dict(data.get("storage") or {})
        quelle = dict(data.get("source") or {})
        art = str(quelle.get("kind") or "")
        url = str(quelle.get("url") or "")
        titel = str(quelle.get("title") or "")
        dauer_roh = quelle.get("duration_s")
        try:
            dauer = float(dauer_roh) if dauer_roh is not None else None
        except (TypeError, ValueError):
            dauer = None
        if art not in ("storage", "url") or not url:
            return ClaimedJob(
                row=row,
                source=JobSource(
                    kind=art, url=url, title=titel, duration_s=dauer,
                    error="Die App hat zu diesem Auftrag keine brauchbare Quelle geliefert "
                          f"(kind={art or 'leer'}, url={'gesetzt' if url else 'leer'})",
                ),
            )
        return ClaimedJob(
            row=row,
            source=JobSource(
                kind=art, url=url, title=titel, duration_s=dauer,
                cache_key=_cache_key(art, url, None, job_id),
            ),
        )

    def claim_specific(self, job_id: str) -> ClaimedJob | None:
        raise DbError(
            "--job gibt es nur im Direktmodus. Im API-Modus stoesst du den Auftrag in der Web-App "
            "erneut an, der Worker holt ihn dann von selbst."
        )

    # -------------------------------------------------- Fortschritt und Ende

    def set_progress(self, job_id: str, progress: int, phase: str | None = None) -> None:
        self.api.progress(job_id, progress, phase or "")

    def write_analysis(self, job_id: str, analysis: dict[str, Any], progress: int) -> None:
        if not self.api.analysis(job_id, analysis):
            log.info("Analyse lag schon vor, die App hat die vorhandene behalten")
        # Der Fortschritt geht getrennt raus, die Analyse-Route kennt ihn nicht.
        self.api.progress(job_id, progress, "Analyse geschrieben")

    def reset_clips(self, job_id: str) -> int:
        return self.api.reset_clips(job_id)

    def upload_clip(self, job_id: str, user_id: str, n: int, local_file: Path) -> str:
        from .storage import upload_clip_signed

        ziel = self.api.upload_url(job_id, n, "mp4")
        zugang = self._storage.get(job_id) or {}
        return upload_clip_signed(
            supabase_url=str(zugang.get("supabaseUrl") or ""),
            publishable_key=str(zugang.get("publishableKey") or ""),
            path=str(ziel["path"]),
            token=str(ziel["token"]),
            signed_url=str(ziel.get("signedUrl") or ""),
            local_file=local_file,
            allow_file_urls=self.allow_file_urls,
        )

    def add_clip(
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
        aspect: str,
    ) -> str:
        # user_id und brand_id setzt die App selbst aus dem Auftrag, die Route nimmt sie nicht an.
        return self.api.clip(
            job_id,
            storage_path=storage_path,
            title=title,
            duration_s=duration_s,
            caption_srt=caption_srt,
            aspect=aspect,
            meta=meta,
        )

    def finish(self, job_id: str, clip_count: int) -> None:
        self.api.finish(job_id, "done")
        self._storage.pop(job_id, None)

    def fail(self, job_id: str, message: str) -> None:
        self.api.finish(job_id, "failed", message)
        self._storage.pop(job_id, None)

    def close(self) -> None:
        self.api.close()


def create_store(settings: Any) -> JobStore:
    """Baut den passenden Store: API-Modus hat Vorrang, sonst Direktmodus."""
    if settings.has_api:
        return ApiStore(
            settings.karamsvids_url or "",
            settings.worker_secret or "",
            settings.worker_id,
            allow_file_urls=bool(getattr(settings, "allow_file_urls", False)),
        )
    settings.require_supabase()
    return DirectStore(settings.supabase_url or "", settings.service_role_key or "", settings.worker_id)
