"""Kompletter Durchlauf im API-Modus gegen den Nachbau aus fake_api.py.

    .venv\\Scripts\\python tests\\test_api_mode.py [--video C:\\Pfad\\video.mp4]

Der Test startet den Nachbau, laesst "python -m karam_worker --once" laufen und
prueft danach: Reihenfolge der Aufrufe, Status done, hochgeladene MP4-Dateien.
Zusaetzlich werden die beiden Fehlerfaelle geprueft (falsches Secret -> 401,
kein Secret auf dem Server -> 503).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HIER = Path(__file__).resolve().parent
WORKER_DIR = HIER.parent
sys.path.insert(0, str(HIER))
sys.path.insert(0, str(WORKER_DIR))

from fake_api import SECRET, FakeState, start_server  # noqa: E402

from karam_worker.api_client import ApiClient, ApiError  # noqa: E402


def _ffprobe(datei: Path) -> str:
    """Kurze Beschreibung einer fertigen Datei, damit man sieht, dass sie spielbar ist."""
    from karam_worker.media import probe

    try:
        info = probe(datei)
    except Exception as e:  # noqa: BLE001 - im Test reicht der Text
        return f"nicht lesbar: {e}"
    return f"{info.width}x{info.height}, {info.duration_s:.1f} s, Ton: {'ja' if info.has_audio else 'nein'}"


def standard_video() -> Path:
    kandidat = Path(os.environ.get("TEMP", "C:/Temp")) / "kv-worker-test" / "rede.mp4"
    return kandidat


def pruefe_fehlerfaelle(state: FakeState) -> None:
    """401 und 503 muessen verstaendliche Meldungen liefern."""
    basis = f"http://127.0.0.1:{state.port}"
    falsch = ApiClient(basis, "falsches-geheimnis", "test-worker")
    try:
        falsch.claim()
        raise AssertionError("Falsches Secret haette 401 liefern muessen")
    except ApiError as e:
        assert "stimmt nicht" in str(e), str(e)
        print("  401 ok:", str(e).split(".")[1].strip())
    finally:
        falsch.close()

    state.secret = None
    ohne = ApiClient(basis, SECRET, "test-worker")
    try:
        ohne.claim()
        raise AssertionError("Fehlendes Server-Secret haette 503 liefern muessen")
    except ApiError as e:
        assert "noch kein WORKER_SECRET" in str(e), str(e)
        print("  503 ok:", str(e).split(".")[1].strip())
    finally:
        ohne.close()
        state.secret = SECRET


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--video", default=str(standard_video()))
    p.add_argument("--whisper-model", default="tiny")
    p.add_argument("--work-dir", default=str(Path(os.environ.get("TEMP", "C:/Temp")) / "kv-worker-test" / "work-api"))
    args = p.parse_args()

    video = Path(args.video)
    if not video.is_file():
        print(f"Testvideo fehlt: {video}")
        return 2

    # Sauber starten: kein alter Zwischenspeicher, keine alten Uploads, damit die
    # gemessenen Zeiten den echten Ablauf zeigen (Whisper laeuft wirklich).
    shutil.rmtree(Path(args.work_dir), ignore_errors=True)

    uploads = Path(args.work_dir) / "uploads"
    state = FakeState(video, uploads)
    server = start_server(state)
    print(f"Nachbau auf http://127.0.0.1:{state.port}, Uploads nach {uploads}")

    print("Fehlerfaelle:")
    pruefe_fehlerfaelle(state)

    umgebung = dict(os.environ)
    umgebung.update(
        {
            "KARAMSVIDS_URL": f"http://127.0.0.1:{state.port}",
            "WORKER_SECRET": SECRET,
            "WORKER_ALLOW_FILE_URLS": "1",
            "WORKER_ID": "test-worker",
            "WHISPER_MODEL": args.whisper_model,
            "WHISPER_BEAM": "1",
            "WORK_DIR": args.work_dir,
            "KEEP_WORK": "1",
            "POLL_SECONDS": "2",
            # Direktmodus bewusst leer, damit sicher der API-Modus greift
            "SUPABASE_URL": "",
            "SUPABASE_SERVICE_ROLE_KEY": "",
            "GROQ_API_KEY": "",
            "LOVABLE_API_KEY": "",
        }
    )

    # Die Aufrufe der Fehlerfaelle nicht mitzaehlen
    state.calls.clear()
    state.t0 = time.time()

    print("\nWorker laeuft ...")
    t0 = time.time()
    proc = subprocess.run(
        [sys.executable, "-m", "karam_worker", "--once"],
        cwd=str(WORKER_DIR),
        env=umgebung,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    dauer = time.time() - t0

    # Zweiter Lauf: der Auftrag ist vergeben, claim muss job:null liefern und der
    # Worker sich mit --once sauber beenden.
    aufrufe_vorher = len(state.calls)
    leerlauf = subprocess.run(
        [sys.executable, "-m", "karam_worker", "--once"],
        cwd=str(WORKER_DIR),
        env=umgebung,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    leerlauf_ok = leerlauf.returncode == 0 and state.calls[aufrufe_vorher:][0][1] == "claim"
    server.shutdown()

    print("\n--- Aufrufe in der Reihenfolge ---")
    print(state.protokoll())
    print(f"\nRueckgabewert: {proc.returncode}, Gesamtdauer {dauer:.1f} s")
    print(f"Status: {state.status}, Fortschritt {state.progress}, Fehler: {state.error}")
    print(f"Clips in der Datenbank: {len(state.clips)}")
    for c in state.clips:
        print(f"  {c['id']}  {c['storage_path']}  {c['duration_s']} s  '{c['title']}'  Untertitel: {'ja' if c['caption_srt'] else 'nein'}")
    dateien = sorted(uploads.glob("*.mp4"))
    for d in dateien:
        print(f"  Datei {d.name}: {d.stat().st_size / 1_048_576:.2f} MB, {_ffprobe(d)}")
    print(f"Zweiter Lauf ohne offenen Auftrag: {'ok' if leerlauf_ok else 'FEHLER'} (Rueckgabewert {leerlauf.returncode})")

    fehler = []
    if not leerlauf_ok:
        fehler.append("zweiter Lauf (kein offener Auftrag) lief nicht sauber")
    if proc.returncode != 0:
        fehler.append(f"Rueckgabewert {proc.returncode}")
    if state.status != "done":
        fehler.append(f"Status {state.status} statt done")
    if not state.clips:
        fehler.append("keine Clips gemeldet")
    if len(dateien) != len(state.clips):
        fehler.append(f"{len(dateien)} Dateien, aber {len(state.clips)} Clips")
    if any(d.stat().st_size < 10_000 for d in dateien):
        fehler.append("mindestens eine Datei ist zu klein")
    # Reihenfolge nur des ersten Laufs pruefen (danach kommt der Leerlauf-claim)
    reihenfolge = [r for _, r, _ in state.calls[:aufrufe_vorher] if r != "progress"]
    if reihenfolge[:2] != ["claim", "GET quelle"]:
        fehler.append(f"Reihenfolge beginnt mit {reihenfolge[:2]}")
    if reihenfolge[-1] != "finish":
        fehler.append(f"letzter Aufruf ist {reihenfolge[-1]}")
    erwartet = ["claim", "GET quelle", "analysis", "reset-clips", "upload-url", "clip", "upload-url", "clip", "finish"]
    if reihenfolge != erwartet:
        fehler.append(f"Reihenfolge {reihenfolge} statt {erwartet}")

    fehler += upload_durchlauf(video, Path(args.work_dir), umgebung, args.whisper_model)
    fehler += fehlerfall_durchlauf(video, Path(args.work_dir), umgebung)

    if fehler:
        print("\nFEHLGESCHLAGEN: " + "; ".join(fehler))
        return 1
    print("\nBESTANDEN")
    return 0


def upload_durchlauf(video: Path, work_dir: Path, umgebung: dict[str, str], whisper_model: str) -> list[str]:
    """Der echte Upload-Weg: supabase-py laedt an eine signierte Adresse (kein file://)."""
    print("\nUpload ueber upload_to_signed_url (wie im Betrieb) ...")
    state = FakeState(video, work_dir / "uploads-http", job_id="job-http", upload_modus="http")
    server = start_server(state)
    umgebung = dict(umgebung)
    umgebung["KARAMSVIDS_URL"] = f"http://127.0.0.1:{state.port}"
    umgebung["WORKER_ALLOW_FILE_URLS"] = "0"  # der Testpfad ist hier bewusst aus
    umgebung["WHISPER_MODEL"] = whisper_model
    t0 = time.time()
    proc = subprocess.run(
        [sys.executable, "-m", "karam_worker", "--once"],
        cwd=str(WORKER_DIR),
        env=umgebung,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    dauer = time.time() - t0
    server.shutdown()
    print("\n".join(f"{t:7.1f}s  {r:<12} {i}" for t, r, i in state.calls if r != "progress"))
    dateien = sorted((work_dir / "uploads-http").glob("*.mp4"))
    for d in dateien:
        print(f"  Datei {d.name}: {d.stat().st_size / 1_048_576:.2f} MB, {_ffprobe(d)}")
    print(f"Status: {state.status}, Dauer {dauer:.1f} s")
    fehler = []
    if state.status != "done":
        fehler.append(f"Upload-Durchlauf: Status {state.status} statt done ({state.error})")
    if len([1 for _, r, _ in state.calls if r == "PUT upload"]) != len(state.clips):
        fehler.append("Upload-Durchlauf: Anzahl der PUT-Aufrufe passt nicht zu den Clips")
    if not dateien or any(d.stat().st_size < 10_000 for d in dateien):
        fehler.append("Upload-Durchlauf: Datei fehlt oder ist zu klein")
    if proc.returncode != 0:
        fehler.append(f"Upload-Durchlauf: Rueckgabewert {proc.returncode}")
        print(proc.stdout[-2000:])
    return fehler


def fehlerfall_durchlauf(video: Path, work_dir: Path, umgebung: dict[str, str]) -> list[str]:
    """Quelle nicht abrufbar: der Auftrag muss als failed mit Text zurueckgemeldet werden."""
    print("\nFehlerfall: Quelle liefert 404 ...")
    state = FakeState(video, work_dir / "uploads-kaputt", job_id="job-kaputt", source_pfad="/gibtsnicht.mp4")
    server = start_server(state)
    umgebung = dict(umgebung)
    umgebung["KARAMSVIDS_URL"] = f"http://127.0.0.1:{state.port}"
    proc = subprocess.run(
        [sys.executable, "-m", "karam_worker", "--once"],
        cwd=str(WORKER_DIR),
        env=umgebung,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    server.shutdown()
    print(state.protokoll())
    print(f"Status: {state.status}, Fehler: {state.error}")
    fehler = []
    if state.status != "failed":
        fehler.append(f"Fehlerfall: Status {state.status} statt failed")
    if not state.error or "404" not in str(state.error):
        fehler.append(f"Fehlerfall: Text ohne 404 ({state.error})")
    if proc.returncode != 0:
        fehler.append(f"Fehlerfall: Rueckgabewert {proc.returncode}")
    return fehler


if __name__ == "__main__":
    raise SystemExit(main())
