# Worker: das Schneiden läuft auf deinem Rechner

Stand: September 2026

Die Web-App läuft auf Lovable Cloud. Dort gibt es kein ffmpeg und kein Python,
also kann sie Videos weder anhören noch schneiden. Das intelligente Schneiden
übernimmt deshalb ein kleines Programm auf deinem Windows-Rechner: der
**Worker** unter `worker/`. Die Web-App ist das Steuerpult, der Worker der
Maschinenraum.

Der Worker kennt zwei Wege zu den Aufträgen. Welcher gilt, entscheidet allein
die `.env`:

| Weg | Wann | Was der Worker braucht |
| --- | --- | --- |
| **API-Modus** (Standard) | die App läuft auf Lovable Cloud | `KARAMSVIDS_URL` und `WORKER_SECRET` |
| **Direktmodus** | eigenes Supabase-Projekt | `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` |

Der API-Modus ist der Standard, weil Lovable Cloud den Service-Role-Schlüssel
und die Datenbankadresse nicht herausgibt. Der Worker redet dann nur mit der
App; die App hat serverseitig den Admin-Client und erledigt die Datenbankarbeit.
Auf deinem Rechner liegt kein Datenbankschlüssel, nur das gemeinsame Geheimnis.

```
API-Modus                            Web-App (Lovable)            Dein Rechner
---------                            -----------------            ------------
Clip-Seite: "10 Clips"  ──insert──▶  edit_jobs (Supabase)         worker/ (Python)
                                     POST /api/worker/claim  ◀───  holt Aufträge alle 10 s
Editor zeigt Fortschritt ◀─────────  POST .../progress       ◀───  schreibt Fortschritt
Editor lädt Segmente     ◀─────────  POST .../analysis       ◀───  Transkript + Auswahl
                                     POST .../upload-url     ◀───  signiertes Ziel holen
Warteschlange / Galerie  ◀─────────  POST .../clip           ◀───  fertige MP4 hochgeladen
                                     POST .../finish         ◀───  fertig oder gescheitert
```

Alle sieben Routen liegen unter `/api/worker/*`, sind POST mit JSON und tragen
den Header `Authorization: Bearer <WORKER_SECRET>`. Ohne oder mit falschem
Secret antwortet die App mit 401, ist auf dem Server gar kein Secret angelegt
mit 503. Im Direktmodus fällt diese Zwischenschicht weg, der Worker schreibt
dann selbst in `edit_jobs`, `generated_clips` und den Bucket.

## Was der Worker tut

Je Auftrag, in dieser Reihenfolge (Fortschritt in Klammern):

1. **Quelle laden** (5 bis 17): Datei aus dem Bucket `raw-videos`, sonst den Link
   per `yt-dlp` als MP4 bis 1080p. Einmal geladene Quellen bleiben im
   Arbeitsordner, ein zweiter Auftrag zum selben Video lädt nicht erneut.
2. **Audio ziehen** (20): Tonspur als 16 kHz mono WAV.
3. **Transkript** (20 bis 50): `faster-whisper` lokal auf der CPU mit
   Wort-Zeitmarken, Sprache wird erkannt. Mit `GROQ_API_KEY` läuft stattdessen
   Whisper large-v3-turbo bei Groq (schneller und genauer, kostet Cent-Beträge).
4. **Auswahl der Stellen** (70): mit `LOVABLE_API_KEY` bekommt ein Sprachmodell
   das Transkript als nummerierte Sätze mit Zeitmarken und liefert Clips als
   JSON. Ohne Schlüssel arbeitet eine Heuristik (Hook-Wörter, Fragen, Zahlen,
   Sprechtempo, Pausen). In beiden Fällen liegen Schnittpunkte **immer auf
   Satzgrenzen**, nie mitten im Wort. Länge und Anzahl kommen aus dem Auftrag
   (`min_len_s`, `max_len_s`, `desired_clip_count`). Die Analyse landet sofort
   in `edit_jobs.analysis`, der Editor der Web-App zeigt die Segmente also schon,
   während noch gerendert wird.
5. **Untertitel**: je Clip eine ASS-Datei aus den Wort-Zeitmarken, 2 bis 4
   Wörter je Zeile, das gerade gesprochene Wort farbig, Arial fett mit Umriss
   und leichtem Schatten, im Hochformat 420 px über dem unteren Rand (TikTok-
   und Reels-Sicherheitsbereich). Dieselben Zeilen als SRT in
   `generated_clips.caption_srt`.
6. **Rendern** (70 bis 90): ffmpeg schneidet an den Grenzen und kodiert nur den
   Clip neu. 9:16 = 1080x1920, Standard ist der mittige Ausschnitt (`crop`),
   Option `blur_pad` legt das Bild auf einen unscharfen Hintergrund. Encoder ist
   `h264_qsv` (Intel QuickSync), wenn ein Probelauf klappt, sonst `libx264
   veryfast crf 23`. Audio AAC 128 kBit/s, `faststart`.
7. **Hochladen** (90 bis 95): nach `rendered-clips/{user_id}/{job_id}/{n}.mp4`,
   dann je Clip eine Zeile in `generated_clips` (Status `draft`, `aspect`,
   `duration_s`, `title`, `caption_srt`, `meta` mit `start_s`, `end_s`, `hook`).
   Im API-Modus holt der Worker dafür je Clip ein signiertes Upload-Ziel von der
   App und meldet den fertigen Clip zurück; er schreibt nie selbst in die
   Datenbank.
8. **Fertig** (100): `status = done`. Bei jedem Fehler: `status = failed` und der
   Fehlertext in `edit_jobs.error`, sichtbar im Editor.

## Einrichtung in 5 Schritten (Lovable Cloud)

Voraussetzungen: Windows 10/11, Python 3.12, ffmpeg (Gyan-Build), Internet.
Vorher einmal ffmpeg installieren und die Python-Umgebung anlegen, siehe
"Einmalige Vorbereitung" weiter unten.

1. **Geheimnis erzeugen und in Lovable anlegen.** Einen langen Zufallswert
   bilden, zum Beispiel in PowerShell:
   ```
   [guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()
   ```
   In Lovable im Projekt unter **Secrets** einen Eintrag `WORKER_SECRET` anlegen
   und diesen Wert einsetzen. Fehlt das Secret auf dem Server, antworten alle
   Worker-Routen mit 503; das ist Absicht, damit nie offen steht, was geschlossen
   sein soll.

2. **App veröffentlichen** (Publish). Erst danach existieren die Routen
   `/api/worker/*` unter der öffentlichen Adresse. Die Adresse merken, zum
   Beispiel `https://karamsvids.lovable.app`.

3. **`.env` ausfüllen**: `worker\.env.example` nach `worker\.env` kopieren und
   die beiden Zeilen setzen:
   ```
   KARAMSVIDS_URL=https://karamsvids.lovable.app
   WORKER_SECRET=<derselbe Wert wie in Lovable>
   ```
   `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` bleiben leer. Die `.env` steht
   in `worker/.gitignore` und bleibt auf diesem Rechner.

4. **Probelauf**: einen Auftrag in der Web-App anstoßen und dann
   ```
   .venv\Scripts\python -m karam_worker --once
   ```
   Der Worker meldet "spricht mit der App unter ...", holt den Auftrag, zeigt
   Fortschritt und beendet sich nach dem Auftrag. Beim ersten Lauf lädt Whisper
   sein Modell (`small`, etwa 480 MB) herunter.

5. **Worker starten**: Doppelklick auf `worker\start-worker.cmd` oder im Terminal
   `python -m karam_worker`. Er meldet sich mit Modell, Auswahlmethode und
   Arbeitsordner, holt dann alle 10 Sekunden offene Aufträge. Fenster offen lassen.
   Für Dauerbetrieb `start-worker.cmd` in die Aufgabenplanung legen (Trigger
   "Bei Anmeldung", Aktion "Programm starten", "Starten in" = `C:\kv\KaramsVids\worker`).
   Die Schleife in der CMD startet den Worker nach einem Absturz von selbst neu.

### Einmalige Vorbereitung

1. **ffmpeg installieren** (falls noch nicht da):
   ```
   winget install Gyan.FFmpeg
   ```
   Danach ein neues Terminal öffnen, damit `ffmpeg` im PATH ist. `start-worker.cmd`
   liest den PATH ohnehin frisch aus der Registry, und der Worker sucht zusätzlich
   im WinGet-Ordner. Notfalls `FFMPEG_PATH` in der `.env` setzen.

2. **Python-Umgebung anlegen** (im Ordner `worker/`):
   ```
   cd C:\kv\KaramsVids\worker
   python -m venv .venv
   .venv\Scripts\pip install -r requirements.txt
   ```
   Das zieht `faster-whisper`, `yt-dlp`, `supabase` und ein paar kleine Helfer.
   Alles läuft auf der CPU, eine Grafikkarte ist nicht nötig.

3. **Trockenübung ohne Server** mit einer eigenen Videodatei:
   ```
   .venv\Scripts\python -m karam_worker --local C:\Pfad\video.mp4 --clips 3
   ```
   Das Ergebnis liegt unter `%LOCALAPPDATA%\KaramsVids\work\jobs\local-<name>\`:
   `clip_1.mp4` bis `clip_3.mp4`, dazu `.srt`, `.ass`, `transcript.json` und
   `analysis.json`. Dafür braucht es weder Lovable noch Supabase.

## Alternative: Direktmodus mit eigenem Supabase

Wer ein eigenes Supabase-Projekt betreibt (nicht Lovable Cloud), kann den Worker
wie bisher direkt anschließen: in der `.env` `SUPABASE_URL` und
`SUPABASE_SERVICE_ROLE_KEY` setzen (Supabase-Dashboard, Project Settings, API)
und `KARAMSVIDS_URL` sowie `WORKER_SECRET` leer lassen. Der Service-Role-Schlüssel
umgeht die Zeilen-Sicherheit, deshalb bleibt er nur auf diesem Rechner.

Sind beide Wege ausgefüllt, gewinnt der API-Modus. Fehlt beides, sagt der Worker
beim Start, welche Angaben er für welchen Weg braucht.

Der Direktmodus kann zusätzlich `--job <id>`, weil er beliebige Aufträge selbst
aus der Datenbank holen darf. Im API-Modus gibt es das nicht: dort stößt du den
Auftrag in der Web-App erneut an, der Worker holt ihn dann von selbst.

## Aufrufe

| Aufruf | Wirkung |
| --- | --- |
| `python -m karam_worker` | Endlosschleife: Aufträge holen, abarbeiten, warten |
| `python -m karam_worker --once` | einen Auftrag verarbeiten, dann beenden |
| `python -m karam_worker --job <id>` | einen bestimmten Auftrag neu verarbeiten, auch wenn er schon beansprucht oder fertig war (nur Direktmodus) |
| `python -m karam_worker --local video.mp4 --clips 3` | ohne Server, Ergebnis im Arbeitsordner |
| `... --local video.mp4 --transcript t.json` | Transkript aus Datei, Whisper wird übersprungen (Tests) |
| `... --local ... --blur-pad --caption-preset hormozi --aspect 9:16` | Formatoptionen im lokalen Modus |
| `... --whisper-model tiny` | anderes Whisper-Modell nur für diesen Lauf |
| `python -m karam_worker --help` | alle Schalter |

Die `start-worker.cmd` reicht Argumente durch: `start-worker.cmd --once` oder
`start-worker.cmd --local video.mp4 --clips 3`.

## Einstellungen (`worker/.env`)

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `KARAMSVIDS_URL` | API-Modus | Adresse der veröffentlichten App, ohne Schrägstrich am Ende |
| `WORKER_SECRET` | API-Modus | gemeinsames Geheimnis, identisch mit dem Secret in Lovable |
| `SUPABASE_URL` | Direktmodus | Adresse des Supabase-Projekts |
| `SUPABASE_SERVICE_ROLE_KEY` | Direktmodus | Service-Role-Schlüssel (nur lokal) |
| `GROQ_API_KEY` | nein | Transkription bei Groq (whisper-large-v3-turbo) statt lokal |
| `LOVABLE_API_KEY` | nein | Auswahl der Stellen per Sprachmodell über das Lovable-Gateway; leer = Heuristik |
| `LOVABLE_MODEL` | nein | Modell hinter dem Gateway, Standard `google/gemini-2.5-flash` |
| `WHISPER_MODEL` | nein | `tiny`, `base`, `small` (Standard), `medium`; größer = genauer, langsamer |
| `WHISPER_BEAM` | nein | Beam-Breite, 1 = schnell, 5 = genauer (Standard) |
| `WORK_DIR` | nein | Arbeitsordner, Standard `%LOCALAPPDATA%\KaramsVids\work` |
| `WORKER_ID` | nein | Name dieses Workers in `options.worker_id`, Standard Rechnername-PID |
| `POLL_SECONDS` | nein | Abstand der Abfragen, Standard 10 |
| `FFMPEG_PATH` | nein | fester Pfad zu `ffmpeg.exe`, falls nicht im PATH |
| `KEEP_WORK` | nein | `1` = Arbeitsordner eines Auftrags nach Erfolg behalten |
| `WORKER_ALLOW_FILE_URLS` | nein | nur für den Testaufbau: erlaubt `file://` als Quelle und Upload-Ziel |

## Was der Auftrag mitbringt

Die Web-App legt in `edit_jobs.options` ab, was der Worker liest:

| Feld | Herkunft | Wirkung im Worker |
| --- | --- | --- |
| `engine` = `worker` | `analyzeVideo` in `src/lib/ai.functions.ts` | nur solche Aufträge werden geholt |
| `worker_id` | Worker | leer = frei; gesetzt = beansprucht. Verhindert, dass zwei Worker denselben Auftrag holen |
| `worker_phase`, `worker_heartbeat` | Worker | Phase und Zeitstempel des letzten Fortschritts (für eine spätere Anzeige "Worker läuft nicht") |
| `desired_clip_count` | Clip-Seite | Anzahl Clips; fehlt sie, etwa ein Clip je zwei Minuten |
| `min_len_s`, `max_len_s` | Vorlage auf der Clip-Seite | Länge je Clip, Standard 20 bis 60 s (`auto_cut`: 30 bis 180 s, ein Clip) |
| `aspect` | Clip-Seite | `9:16` (Standard), `1:1`, `16:9` |
| `captions` | Clip-Seite | `false` = keine Untertitel einbrennen |
| `caption_preset` | optional | `clean`, `hormozi`, `bold` (Standard), `neon`, `subtle`, angelehnt an `CAPTION_PRESETS` der Web-App |
| `fill_mode` = `blur_pad` | optional | unscharfer Hintergrund statt Ausschnitt |
| `encoder` | optional | `libx264` oder `h264_qsv` erzwingen |

Modus (`edit_jobs.mode`): `long_to_many` und `ugc_shorts` liefern viele
eigenständige Clips, `auto_cut` einen einzigen langen Clip mit dem stärksten
Abschnitt, `manual` drei Vorschläge.

## Was es kostet

Nichts. Whisper, die Heuristik und ffmpeg laufen lokal und brauchen nur Strom.
Zwei Zusatzoptionen kosten Geld, beide sind abschaltbar, indem der Schlüssel
leer bleibt:

* **Groq-Transkription**: etwa 0,04 $ je Audiostunde (whisper-large-v3-turbo).
  Lohnt sich bei langen Podcasts oder wenn `small` bei Dialekt oder Musik patzt.
* **Auswahl per Sprachmodell** über das Lovable-Gateway: ein Aufruf je Auftrag,
  verbraucht Lovable-Credits wie die Web-App selbst. Ohne Schlüssel greift die
  Heuristik, die auf klar gesprochenen Videos brauchbare Stellen findet.

## Gemessene Zeiten (i5-10210U, 4 Kerne, 16 GB, keine Grafikkarte)

| Schritt | Messung |
| --- | --- |
| Whisper `tiny`, 34 s deutsche Sprache | Modell laden 2 s, Transkription 3,6 s (9,5x Echtzeit), Sprache de mit 99 % |
| Whisper `small` (Standard) | grob 1,5x bis 3x Echtzeit, also 10 Minuten Video in 4 bis 7 Minuten |
| Render 9:16 `crop` mit Untertiteln, `h264_qsv` | 4,0x bis 4,4x Echtzeit (22,7 s Clip in 5,6 s; 33,4 s Clip in 7,5 s) |
| Render 9:16 `blur_pad` mit Untertiteln, `h264_qsv` | 3,4x bis 3,8x Echtzeit (59 s Clip in 17 s), Hintergrund in Viertelauflösung weichgezeichnet |
| Render 9:16 `crop` ohne Untertitel, `libx264 veryfast` | 2,4x Echtzeit (88 s Clip in 37 s) |
| Kompletter Testlauf: 90 s Video, Transkript aus Datei, 3 Clips | 22 bis 23 s inklusive Encoder-Probelauf |
| Kompletter Testlauf: 34 s echte Sprache, Whisper `tiny`, 2 Clips | 15,7 s |
| API-Modus gegen den Nachbau: 37,6 s Sprache, Whisper `tiny`, 2 Clips | 20,3 s gesamt; Quelle 0,7 s (34 MB), Whisper 6,4 s, Auswahl 0,8 s, Rendern 10,7 s (17,4 s Clip in 6,0 s, 10,0 s Clip in 4,1 s), Upload und Meldungen unter 0,3 s |
| Upload über `upload_to_signed_url` (9,3 MB in zwei Clips) | 3,2 s für beide, also etwa 1,5 s je Clip über die Schleife auf `127.0.0.1` |

Faustregel für ein 20-Minuten-Video mit 10 Clips à 40 s: Quelle laden je nach
Leitung 1 bis 3 Minuten, Whisper `small` 8 bis 12 Minuten, Rendern etwa 2
Minuten, Hochladen unter einer Minute. Mit Groq statt lokalem Whisper schrumpft
der mittlere Posten auf unter eine Minute.

## Bekannte Grenzen

* **Ein Rechner, ein Auftrag nach dem anderen.** Der Worker verarbeitet
  Aufträge seriell. Läuft der Rechner nicht, bleiben Aufträge bei `analyzing`
  und `progress 0` stehen, bis der Worker wieder startet. Die Web-App zeigt
  dafür zeigt der Editor einen eigenen Hinweis, sobald der Herzschlag ausbleibt.
* **`blur_pad` kostet etwas mehr.** Der unscharfe Hintergrund wird in einem
  Viertel der Auflösung berechnet und hochskaliert (3,4x statt 1,2x Echtzeit in
  voller Auflösung). `crop` bleibt die schnellste Variante.
* **Kein Gesichts-Tracking.** Der 9:16-Ausschnitt ist immer mittig. Sitzt der
  Sprecher am Rand, hilft `blur_pad` oder ein manueller Neuschnitt im Editor.
* **Whisper `small` ist nicht fehlerfrei.** Eigennamen, Dialekt und Musik unter
  der Stimme führen zu falschen Wörtern in den Untertiteln. `medium` hilft,
  kostet aber etwa das Dreifache an Zeit; Groq ist die bessere Abkürzung.
* **Videos ohne Tonspur** werden mit klarer Fehlermeldung abgelehnt, denn ohne
  Sprache gibt es nichts auszuwählen.
* **yt-dlp und YouTube.** YouTube ändert regelmäßig etwas an seiner Seite;
  dann hilft meist `.venv\Scripts\pip install -U yt-dlp`. Bei Sperren durch
  YouTube bleibt der Upload der Datei über die Web-App.
* **Erneutes Anstoßen** eines Auftrags löscht die alten Worker-Clips aus
  `generated_clips` und überschreibt die Dateien im Bucket unter denselben Namen.
  Entstehen beim zweiten Lauf weniger Clips, bleiben überzählige Dateien im
  Bucket liegen (ohne Datenbankzeile, also unsichtbar in der App).
* **Schriften.** Windows hat keine fontconfig-Konfiguration. Der Worker legt
  deshalb selbst eine kleine `fonts.conf` im Arbeitsordner an, die auf
  `C:\Windows\Fonts` zeigt, und setzt `FONTCONFIG_FILE`, bevor ffmpeg mit dem
  `ass`-Filter läuft. Ohne diesen Kniff bleiben die Untertitel leer.

## Fehlerbilder

| Symptom | Ursache | Abhilfe |
| --- | --- | --- |
| `Der Worker weiss nicht, wohin er sich verbinden soll` | `.env` fehlt oder ist leer | `.env.example` nach `.env` kopieren und einen der beiden Wege ausfüllen |
| `WORKER_SECRET stimmt nicht mit dem Secret in Lovable ueberein` (401) | Tippfehler, oder in Lovable steht ein anderer Wert | beide Werte vergleichen, App neu veröffentlichen |
| `In Lovable ist noch kein WORKER_SECRET angelegt` (503) | Secret fehlt auf dem Server | in Lovable unter Secrets anlegen und neu veröffentlichen |
| `Die Route /api/worker/claim gibt es unter ... nicht` (404) | App ohne die Worker-Routen veröffentlicht, oder falsche Adresse | `KARAMSVIDS_URL` prüfen, App neu veröffentlichen |
| `Die App unter ... ist nicht erreichbar` | Adresse falsch, App schläft, kein Internet | Adresse im Browser öffnen |
| `Der Auftrag gehoert einem anderen Worker` (409) | zwei Worker, oder Auftrag zwischendurch zurückgesetzt | Auftrag in der Web-App erneut anstoßen |
| `ffmpeg nicht gefunden` | ffmpeg nicht installiert oder Terminal noch mit altem PATH | `winget install Gyan.FFmpeg`, Terminal neu öffnen, oder `FFMPEG_PATH` setzen |
| Auftrag bleibt bei `analyzing`, Fortschritt 0 | Worker läuft nicht oder hängt an einem anderen Projekt | Worker starten, `KARAMSVIDS_URL` (oder im Direktmodus `SUPABASE_URL`) mit der Web-App vergleichen |
| `Auftrag ... hat sich ein anderer Worker geholt` | zwei Worker laufen gleichzeitig | erwünscht, nichts tun; Aufträge verteilen sich |
| `Download aus dem Storage: HTTP 400/404` | `raw_videos.storage_path` zeigt auf eine Datei, die nicht (mehr) im Bucket liegt | Video in der Web-App neu hochladen |
| `yt-dlp konnte den Link nicht laden` | yt-dlp veraltet, Video privat oder gesperrt | `pip install -U yt-dlp`; sonst Datei hochladen |
| `Whisper hat keine Woerter erkannt` | reine Musik, Stille oder falsche Tonspur | Video prüfen; bei Mehrspur-Aufnahmen die Sprachspur exportieren |
| `Whisper-Modell ... konnte nicht geladen werden` | kein Internet beim ersten Lauf oder voller Datenträger | einmal online laufen lassen; Modelle liegen unter `%USERPROFILE%\.cache\huggingface` |
| Untertitel fehlen im Clip, kein Fehler | fontconfig findet keine Schrift | `WORK_DIR\fontconfig\fonts.conf` löschen, der Worker legt sie neu an; prüfen, ob `C:\Windows\Fonts\arialbd.ttf` existiert |
| `h264_qsv ist gelistet, der Probelauf schlug aber fehl` | Intel-Grafiktreiber fehlt oder QuickSync deaktiviert | harmlos, der Worker nimmt `libx264`; Treiber aktualisieren bringt die 3,6x zurück |
| `Lovable AI: Credits aufgebraucht (402)` | Guthaben leer | Schlüssel leer lassen (Heuristik) oder Guthaben aufladen |
| `Keine Stelle gefunden, die in die Laengengrenzen passt` | `min_len_s` größer als das Video oder Transkript fast leer | Länge in der Vorlage anpassen |
| Clips landen nicht in der Warteschlange | Worker-Clips haben Status `draft` | auf der Seite "Veröffentlichen" in die Warteschlange stellen |

Der Fehlertext jedes gescheiterten Auftrags steht in `edit_jobs.error` und wird
im Editor unter "KI-Analyse fehlgeschlagen" angezeigt. Erneutes Anstoßen aus der
Web-App setzt `worker_id` zurück, der Worker nimmt den Auftrag dann wieder auf.

## Notnagel ohne Worker

`analyzeVideo` in `src/lib/ai.functions.ts` übergibt standardmäßig an den
Worker. Der alte Weg, bei dem Gemini Schnittpunkte nur aus Titel und Dauer
rät, ohne das Video je gesehen zu haben, ist hinter der Umgebungsvariablen
`CLIPPING_ENGINE=guess` erhalten. Er liefert Segmente, die keine Satzgrenzen
treffen, und erfundene Untertitel. Sinnvoll nur, wenn der Worker-Rechner länger
ausfällt und der Editor trotzdem irgendetwas anzeigen soll.

## Umgesetzt in der Web-App

Die drei Punkte, die hier zuerst als offen standen, sind seit dem 7. September 2026
im Editor umgesetzt: Der Auftrag zeigt Phase, Fortschritt und Wartezeit aus
`options.worker_phase`, `progress` und `options.queued_at`; bleibt ein Auftrag
laenger als zehn Minuten ohne Herzschlag bei 0 %, erscheint der Hinweis "Der Worker
laeuft nicht"; und die vom Worker gerenderten Clips erscheinen nach `done` als
eigener Abschnitt "Worker-Clips" mit Vorschau, Hook und Download.

## Dateien

```
worker/
  start-worker.cmd        Start mit PATH-Refresh und venv, Neustart nach Absturz
  requirements.txt        Python-Abhängigkeiten
  .env.example            Vorlage für die Konfiguration
  karam_worker/
    __main__.py           python -m karam_worker
    main.py               Schleife, Pipeline, lokaler Modus, Kommandozeile
    config.py             .env und Umgebung einlesen, Wahl des Modus
    api_client.py         die sieben Routen /api/worker/* über HTTP
    db.py                 JobStore: ApiStore (über die App) und DirectStore (Supabase)
    errors.py             gemeinsame Fehlerklasse für Meldungen ohne Traceback
    media.py              ffmpeg finden, Quelle laden, ffprobe, Audio ziehen
    transcribe.py         faster-whisper lokal oder Groq, Sätze aus Wörtern
    select.py             Auswahl per Sprachmodell oder Heuristik, Satzgrenzen
    subtitles.py          ASS zum Einbrennen, SRT für die Datenbank
    render.py             Schnitt, Hochformat, Untertitel, Encoder, fontconfig
    storage.py            Upload nach rendered-clips (direkt oder signiert)
  tests/
    fake_api.py           Nachbau der sieben Routen als lokaler Server (nur Test)
    test_api_mode.py      kompletter Durchlauf im API-Modus gegen den Nachbau
```

Test des API-Modus ohne Lovable, mit einer echten Videodatei:

```
cd C:\kv\KaramsVids\worker
.venv\Scripts\python tests\test_api_mode.py --video C:\Pfad\video.mp4
```

Der Test startet den Nachbau auf `127.0.0.1`, lässt `python -m karam_worker --once`
laufen und prüft danach die Reihenfolge der Aufrufe, den Status `done`, die
gemeldeten Clips und die hochgeladenen Dateien. Er läuft in vier Durchgängen:

1. kompletter Auftrag mit `file://` als Upload-Ziel (der Worker kopiert selbst),
2. leerer Durchgang, wenn kein Auftrag offen ist (`claim` liefert `job:null`),
3. kompletter Auftrag über den echten Upload-Weg, also `upload_to_signed_url`
   von `supabase-py` gegen einen nachgebauten Storage-Endpunkt,
4. Fehlerfall: die Quelle antwortet mit 404, der Auftrag muss als `failed` mit
   Text zurückgemeldet werden.

Die Fehlerfälle 401 (falsches Secret) und 503 (kein Secret auf dem Server)
prüft er vorab direkt am `ApiClient`.
