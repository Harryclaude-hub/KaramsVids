"""Nachbau der sieben Worker-Routen als kleiner lokaler Server (nur zum Testen).

Damit laesst sich der API-Modus des Workers komplett durchspielen, ohne dass die
Web-App laeuft. Der Server haelt einen Auftrag im Speicher, liefert das
Testvideo unter /quelle.mp4 aus und nimmt die fertigen Clips als Dateien an
(signedUrl mit file://, dafuer braucht der Worker WORKER_ALLOW_FILE_URLS=1).

Start als eigenstaendiger Server:
    .venv\\Scripts\\python tests\\fake_api.py --video C:\\Pfad\\video.mp4 --out C:\\Pfad\\uploads
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

SECRET = "test-geheimnis"


class FakeState:
    """Der Zustand, den sonst die Datenbank haelt."""

    def __init__(self, video: Path, out_dir: Path, *, user_id: str = "u-test", job_id: str = "job-test",
                 source_pfad: str = "/quelle.mp4", upload_modus: str = "file") -> None:
        self.video = video
        # Pfad, den claim als Quelle nennt. Fuer den Fehlerfall auf etwas
        # zeigen lassen, das es nicht gibt.
        self.source_pfad = source_pfad
        # "file" = signedUrl mit file:// (der Worker kopiert die Datei selbst),
        # "http" = Nachbau des Storage-Endpunkts, der Worker laedt wie im Betrieb
        # mit supabase-py an die signierte Adresse.
        self.upload_modus = upload_modus
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.secret: str | None = SECRET
        self.job: dict[str, Any] = {
            "id": job_id,
            "user_id": user_id,
            "mode": "long_to_many",
            "options": {"engine": "worker", "desired_clip_count": 2, "min_len_s": 8, "max_len_s": 20},
            "analysis": None,
            "created_at": "2026-09-07T08:00:00Z",
        }
        self.status = "analyzing"
        self.progress = 0
        self.error: str | None = None
        self.clips: list[dict[str, Any]] = []
        self.calls: list[tuple[float, str, str]] = []  # (Sekunde seit Start, Route, Kurzinfo)
        self.t0 = time.time()
        self.port = 0

    def merke(self, route: str, info: str = "") -> None:
        self.calls.append((time.time() - self.t0, route, info))

    def protokoll(self) -> str:
        zeilen = [f"{t:7.1f}s  {route:<12} {info}" for t, route, info in self.calls]
        return "\n".join(zeilen)


def make_handler(state: FakeState):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        # --------------------------------------------------------- Helfer

        def log_message(self, *args: Any) -> None:  # Konsole ruhig halten
            return

        def _json(self, code: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _autorisiert(self) -> bool:
            kopf = self.headers.get("Authorization") or ""
            return kopf == f"Bearer {state.secret}"

        # ------------------------------------------------------------ GET

        def do_GET(self) -> None:
            if self.path.startswith("/quelle.mp4"):
                state.merke("GET quelle", state.video.name)
                daten = state.video.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(len(daten)))
                self.end_headers()
                self.wfile.write(daten)
                return
            self._json(404, {"ok": False, "error": "unbekannt"})

        # ------------------------------------------------------------ PUT

        def do_PUT(self) -> None:
            """Nachbau des Storage-Endpunkts fuer upload_to_signed_url."""
            marke = "/fake-supabase/storage/v1/object/upload/sign/rendered-clips/"
            if marke not in self.path or "token=" not in self.path:
                self._json(404, {"error": "unbekanntes Upload-Ziel"})
                return
            pfad = self.path.split(marke, 1)[1].split("?", 1)[0]
            typ = self.headers.get("Content-Type") or ""
            koerper = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            daten = koerper
            if "boundary=" in typ:  # multipart auspacken
                grenze = ("--" + typ.split("boundary=", 1)[1].strip()).encode()
                teil = koerper.split(grenze)[1]
                trenner = b"\r\n\r\n"  # Kopfteil und Inhalt des Abschnitts
                daten = teil.split(trenner, 1)[1].rsplit(b"\r\n", 1)[0]
            ziel = state.out_dir / Path(pfad).name
            ziel.parent.mkdir(parents=True, exist_ok=True)
            ziel.write_bytes(daten)
            state.merke("PUT upload", f"{pfad} ({len(daten) / 1_048_576:.2f} MB)")
            self._json(200, {"Id": "fake", "Key": f"rendered-clips/{pfad}"})

        # ----------------------------------------------------------- POST

        def do_POST(self) -> None:
            if not self.path.startswith("/api/worker/"):
                self._json(404, {"ok": False, "error": "unbekannt"})
                return
            route = self.path[len("/api/worker/"):].split("?")[0]

            if state.secret is None:
                # Bewusst geschlossen: ohne Secret auf dem Server geht gar nichts.
                state.merke(route, "503 WORKER_SECRET fehlt")
                self._json(503, {"ok": False, "error": "WORKER_SECRET fehlt"})
                return
            if not self._autorisiert():
                state.merke(route, "401 nicht autorisiert")
                self._json(401, {"ok": False, "error": "Nicht autorisiert"})
                return

            laenge = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(laenge) or b"{}")
            except ValueError:
                self._json(400, {"ok": False, "error": "kein JSON"})
                return

            worker_id = str(body.get("workerId") or "")
            if route != "claim":
                # Alle anderen Routen gehoeren dem Worker, der den Auftrag hat.
                if str(body.get("jobId")) != state.job["id"] or state.job["options"].get("worker_id") != worker_id:
                    state.merke(route, "409 fremder Auftrag")
                    self._json(409, {"ok": False, "error": "Auftrag gehoert einem anderen Worker"})
                    return

            antwort = self._route(route, worker_id, body)
            if antwort is None:
                self._json(404, {"ok": False, "error": f"Route {route} unbekannt"})
                return
            code, payload = antwort
            self._json(code, payload)

        def _route(self, route: str, worker_id: str, body: dict[str, Any]):
            if route == "claim":
                if state.job["options"].get("worker_id"):
                    state.merke("claim", "nichts frei")
                    return 200, {"ok": True, "job": None}
                state.job["options"]["worker_id"] = worker_id
                state.job["options"]["worker_phase"] = "beansprucht"
                state.job["options"]["worker_heartbeat"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
                state.merke("claim", f"an {worker_id}")
                return 200, {
                    "ok": True,
                    "job": dict(state.job),
                    "source": {
                        "kind": "storage",
                        "url": f"http://127.0.0.1:{state.port}{state.source_pfad}",
                        "title": state.video.stem,
                        "duration_s": None,
                    },
                    "storage": {
                        "supabaseUrl": f"http://127.0.0.1:{state.port}/fake-supabase",
                        "publishableKey": "sb_publishable_test",
                    },
                }

            if route == "progress":
                state.progress = int(body.get("progress") or 0)
                phase = str(body.get("phase") or "")
                state.job["options"]["worker_phase"] = phase
                state.job["options"]["worker_heartbeat"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
                state.merke("progress", f"{state.progress:3d}% {phase}")
                return 200, {"ok": True}

            if route == "analysis":
                if state.job.get("analysis"):
                    state.merke("analysis", "schon vorhanden, uebersprungen")
                    return 200, {"ok": True, "skipped": True}
                state.job["analysis"] = body.get("analysis")
                anzahl = len((body.get("analysis") or {}).get("segments") or [])
                state.merke("analysis", f"{anzahl} Segmente")
                return 200, {"ok": True}

            if route == "upload-url":
                n = int(body.get("n") or 0)
                pfad = f"{state.job['user_id']}/{state.job['id']}/{n}.mp4"
                ziel = state.out_dir / f"{n}.mp4"
                if ziel.exists():  # vorhandene Datei entfernen (Neu-Anstossen)
                    ziel.unlink()
                state.merke("upload-url", f"n={n} -> {pfad} ({state.upload_modus})")
                if state.upload_modus == "http":
                    signed = (f"http://127.0.0.1:{state.port}/fake-supabase/storage/v1/object/upload/sign/"
                              f"rendered-clips/{pfad}?token=token-{n}")
                else:
                    signed = "file:///" + str(ziel).replace("\\", "/")
                return 200, {"ok": True, "path": pfad, "token": f"token-{n}", "signedUrl": signed}

            if route == "clip":
                clip = {
                    "id": f"clip-{len(state.clips) + 1}",
                    "storage_path": body.get("storage_path"),
                    "title": body.get("title"),
                    "duration_s": body.get("duration_s"),
                    "aspect": body.get("aspect"),
                    "caption_srt": body.get("caption_srt"),
                    "meta": body.get("meta") or {},
                }
                state.clips.append(clip)
                state.merke("clip", f"{clip['id']} {clip['storage_path']} ({clip['duration_s']}s)")
                return 200, {"ok": True, "clipId": clip["id"]}

            if route == "finish":
                state.status = str(body.get("status") or "")
                state.error = body.get("error")
                if state.status == "done":
                    state.progress = 100
                state.merke("finish", state.status + (f": {state.error}" if state.error else ""))
                return 200, {"ok": True}

            if route == "reset-clips":
                vorher = len(state.clips)
                state.clips = [c for c in state.clips if (c.get("meta") or {}).get("engine") != "worker"]
                geloescht = vorher - len(state.clips)
                state.merke("reset-clips", f"{geloescht} geloescht")
                return 200, {"ok": True, "deleted": geloescht}

            return None

    return Handler


def start_server(state: FakeState) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(state))
    state.port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> int:
    p = argparse.ArgumentParser(description="Nachbau der Worker-Routen zum Testen")
    p.add_argument("--video", required=True)
    p.add_argument("--out", required=True)
    args = p.parse_args()
    state = FakeState(Path(args.video), Path(args.out))
    server = start_server(state)
    print(f"Nachbau laeuft auf http://127.0.0.1:{state.port} (Secret: {SECRET})")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
