"""HTTP-Client fuer die Worker-Routen der Web-App.

Auf Lovable Cloud gibt es weder einen Service-Role-Schluessel noch eine
Datenbank-Adresse nach aussen. Der Worker redet deshalb ueber HTTP mit der App:
die App hat serverseitig den Admin-Client und erledigt die Datenbankarbeit.

Alle Routen liegen unter /api/worker/*, sind POST mit JSON und tragen den
Header "Authorization: Bearer <WORKER_SECRET>". Der Vertrag:

  1 claim        {workerId}                                  -> {ok, job, source, storage} | {ok, job:null}
  2 progress     {workerId, jobId, progress, phase}           -> {ok}
  3 analysis     {workerId, jobId, analysis}                  -> {ok, skipped?}
  4 upload-url   {workerId, jobId, n, ext}                    -> {ok, path, token, signedUrl}
  5 clip         {workerId, jobId, storage_path, title, ...}  -> {ok, clipId}
  6 finish       {workerId, jobId, status, error?}            -> {ok}
  7 reset-clips  {workerId, jobId}                            -> {ok, deleted}
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from .errors import WorkerError

log = logging.getLogger("karam.api")


class ApiError(WorkerError):
    """Aufruf der Web-App fehlgeschlagen (mit verstaendlicher Meldung)."""


class ApiClient:
    """Duenne Huelle um httpx fuer genau die sieben Worker-Routen."""

    def __init__(
        self,
        base_url: str,
        secret: str,
        worker_id: str,
        *,
        timeout_s: float = 60.0,
        retries: int = 1,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.worker_id = worker_id
        self.retries = max(0, retries)
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout_s, connect=15.0, read=timeout_s, write=120.0),
            follow_redirects=True,
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "KaramsVids-Worker",
            },
        )

    # ---------------------------------------------------------------- intern

    def _post(self, route: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Ein Aufruf mit workerId im Rumpf, klaren Fehlern und einem Wiederholversuch."""
        url = f"/api/worker/{route}"
        body = {"workerId": self.worker_id, **payload}
        last_net: Exception | None = None
        for versuch in range(self.retries + 1):
            try:
                resp = self._client.post(url, json=body)
            except httpx.TransportError as e:  # Netz weg, Server startet gerade neu
                last_net = e
                if versuch < self.retries:
                    time.sleep(1.5)
                    continue
                raise ApiError(
                    f"Die App unter {self.base_url} ist nicht erreichbar ({type(e).__name__}: {e}). "
                    "Stimmt KARAMSVIDS_URL, und ist die App veroeffentlicht?"
                ) from e
            return self._auswerten(route, resp)
        raise ApiError(f"{route}: kein Ergebnis ({last_net})")  # unerreichbar, nur zur Sicherheit

    def _auswerten(self, route: str, resp: httpx.Response) -> dict[str, Any]:
        text = (resp.text or "").strip()
        data: dict[str, Any] = {}
        try:
            geparst = resp.json()
            if isinstance(geparst, dict):
                data = geparst
        except ValueError:
            data = {}
        meldung = str(data.get("error") or "").strip()

        if resp.status_code == 401:
            raise ApiError(
                "Nicht autorisiert (401). WORKER_SECRET stimmt nicht mit dem Secret in Lovable ueberein. "
                "In Lovable unter Secrets nachsehen und denselben Wert in worker/.env eintragen."
            )
        if resp.status_code == 503:
            raise ApiError(
                "Der Server weist ab (503). In Lovable ist noch kein WORKER_SECRET angelegt. "
                "Secret dort anlegen, App neu veroeffentlichen, dann denselben Wert in worker/.env eintragen."
            )
        if resp.status_code == 409:
            raise ApiError(
                f"{route}: Der Auftrag gehoert einem anderen Worker oder existiert nicht mehr (409)."
                + (f" {meldung}" if meldung else "")
            )
        if resp.status_code == 404:
            raise ApiError(
                f"Die Route /api/worker/{route} gibt es unter {self.base_url} nicht (404). "
                "Ist die App mit den Worker-Routen veroeffentlicht?"
            )
        if resp.status_code >= 400:
            raise ApiError(f"{route}: HTTP {resp.status_code} {meldung or text[:300]}")
        if not data:
            raise ApiError(f"{route}: Antwort war kein JSON ({text[:200]})")
        if data.get("ok") is not True:
            raise ApiError(f"{route}: {meldung or 'Die App meldet einen Fehler'}")
        return data

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------- 1 claim

    def claim(self) -> dict[str, Any] | None:
        """Holt den aeltesten freien Auftrag. None, wenn nichts ansteht."""
        data = self._post("claim", {})
        if not data.get("job"):
            return None
        return data

    # ---------------------------------------------------------- 2 progress

    def progress(self, job_id: str, progress: int, phase: str) -> None:
        self._post("progress", {"jobId": job_id, "progress": int(progress), "phase": phase})

    # ---------------------------------------------------------- 3 analysis

    def analysis(self, job_id: str, analysis: dict[str, Any]) -> bool:
        """True = geschrieben, False = die App hatte schon eine Analyse (skipped)."""
        data = self._post("analysis", {"jobId": job_id, "analysis": analysis})
        return not bool(data.get("skipped"))

    # -------------------------------------------------------- 4 upload-url

    def upload_url(self, job_id: str, n: int, ext: str = "mp4") -> dict[str, Any]:
        """Signiertes Upload-Ziel fuer Clip n. Liefert path, token und signedUrl."""
        data = self._post("upload-url", {"jobId": job_id, "n": int(n), "ext": ext})
        for feld in ("path", "token"):
            if not data.get(feld):
                raise ApiError(f"upload-url: Feld '{feld}' fehlt in der Antwort")
        return data

    # -------------------------------------------------------------- 5 clip

    def clip(
        self,
        job_id: str,
        *,
        storage_path: str,
        title: str,
        duration_s: float,
        caption_srt: str | None,
        aspect: str,
        meta: dict[str, Any],
    ) -> str:
        data = self._post(
            "clip",
            {
                "jobId": job_id,
                "storage_path": storage_path,
                "title": title,
                "duration_s": round(float(duration_s), 3),
                "caption_srt": caption_srt,
                "aspect": aspect,
                "meta": meta,
            },
        )
        return str(data.get("clipId") or "")

    # ------------------------------------------------------------ 6 finish

    def finish(self, job_id: str, status: str, error: str | None = None) -> None:
        payload: dict[str, Any] = {"jobId": job_id, "status": status}
        if error:
            payload["error"] = error[:4000]
        self._post("finish", payload)

    # ------------------------------------------------------- 7 reset-clips

    def reset_clips(self, job_id: str) -> int:
        data = self._post("reset-clips", {"jobId": job_id})
        try:
            return int(data.get("deleted") or 0)
        except (TypeError, ValueError):
            return 0
