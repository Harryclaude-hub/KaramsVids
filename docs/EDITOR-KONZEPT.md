# Deep-Recherche: Profi-Editor-Konzept (Adobe-Niveau + KI-Transparenz)

Stand: Juli 2026 · Für VideoCraft AI (Video Studio AI)

## 1. Was die besten Tools heute können

| Tool             | Kernidee                                                     | Was wir übernehmen                                                                                       |
| ---------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Descript**     | Transkript-basiertes Editing: Text löschen = Video schneiden | Transkript-Spalte im Editor; Klick auf Wort springt zur Timeline; Füllwörter ("ähm") per Klick entfernen |
| **Opus Clip**    | Fabrik: Langvideo → viele Shorts mit Virality-Score          | Massen-Clipping-Flow (haben wir); zusätzlich: Score pro Clip ("Hook-Stärke"), Reframing auf Sprecher     |
| **CapCut**       | Plattform-Styling: Captions-Presets, Trends, Effekte         | Caption-Templates (Hormozi-Style etc.), Auto-Emoji, Keyword-Highlighting                                 |
| **Premiere Pro** | Profi-Timeline: Magnetismus, Ripple/Roll-Trim, Proxys        | Siehe Timeline-Anforderungen unten                                                                       |

Quellen: gstory.ai, tasarim.ai, getaitoolhub.com, toolchase.com (Vergleiche 2026).

## 2. Timeline-Anforderungen für „Adobe-Niveau"

**Muss (Reihenfolge der Umsetzung):**

1. **Snapping/Magnetismus** — Clips rasten an Schnittkanten & Playhead ein
2. **Ripple-Trim** — Clip kürzen schiebt nachfolgende Clips automatisch nach
3. **JKL-Shortcuts** — J rückwärts, K stopp, L vorwärts (mehrfach L = schneller); Space = Play; S = Split; Entf = Ripple-Delete
4. **Waveform-Darstellung** auf der Audio-Spur (Web Audio API, `OfflineAudioContext`)
5. **Thumbnail-Filmstreifen** auf Video-Clips (Canvas-Frames alle n Sekunden)
6. **Mehrspur-Video** (V1, V2 für Overlays/B-Roll) — aktuell nur 1 Videospur
7. **Proxy-Workflow für 1h-Videos**: Beim Import 480p-Proxy erzeugen (ffmpeg.wasm oder Server), Editor arbeitet auf Proxy, Export nutzt Original

**Für 1h-Material zwingend (Architektur):**

- ffmpeg.wasm hat ein 2-GB-Speicherlimit → 1h-1080p-Dateien sprengen das.
  Lösung A (kurzfristig): Proxy-Datei (480p, ~300MB/h) im Browser schneiden, Original-Export serverseitig.
  Lösung B (richtig): Server-Rendering mit nativem ffmpeg (Render-Queue, Supabase Edge Function reicht NICHT — braucht echten Worker, z.B. Fly.io/Railway-Container oder Modal).
- Virtualisierte Timeline (nur sichtbare Clips rendern) — Ruler ist schon adaptiv (Fix von heute).

## 3. Transkript-basiertes Editing (der größte Hebel)

Workflow wie Descript:

1. Beim Import → Audio extrahieren → STT mit **Wort-Timestamps** (Whisper via Groq: ~0,60 $/1000 min)
2. Transkript-Panel neben der Timeline; jedes Wort kennt start/end
3. Textauswahl löschen = Segment aus Timeline entfernen
4. Highlights markieren = Clip-Kandidat für Massen-Clipping
5. Untertitel entstehen gratis aus denselben Timestamps (SRT/ASS-Export, eingebrannt via drawtext/subtitles-Filter)

Das ersetzt unsere aktuelle Metadaten-Schätzung in `ai.functions.ts` durch echte Inhaltsanalyse — die KI clippt dann anhand des tatsächlichen Transkripts.

## 4. KI-Transparenz („KI zeigt, welche Schritte sie nutzt")

Konzept **„Aktionsprotokoll"**: Jede KI-Aktion wird als Tool-Schritt angezeigt, wie in unserem Editor-Chat schon angelegt (`list_clips`, `add_clip` …). Ausbau:

- Jeder Chat-Tool-Call rendert eine Karte: **Werkzeug** (z.B. „Split bei 0:42"), **Warum** (1 Satz), **Undo-Button**
- Timeline-Änderungen der KI werden 2 s farblich gepulst (Diff-Highlight)
- „Plan-Modus": KI schlägt erst Schrittliste vor („1. Stille entfernen, 2. 12 Clips schneiden, 3. Captions"), Nutzer bestätigt, dann Ausführung Schritt für Schritt mit Fortschritt
- Neue Tools fürs Chat-Backend: `remove_silence`, `apply_caption_template`, `set_transition`, `add_music`, `reorder_clips`

## 5. Empfohlene Editor-Roadmap

| Phase | Inhalt                                                         | Aufwand |
| ----- | -------------------------------------------------------------- | ------- |
| 1     | Transkript-Pipeline (Groq Whisper) + Untertitel aus Timestamps | klein   |
| 2     | Snapping, JKL, Ripple-Trim, Waveforms                          | mittel  |
| 3     | Proxy-Workflow + Server-Render-Queue (1h-Videos)               | groß    |
| 4     | KI-Aktionsprotokoll + Plan-Modus                               | mittel  |
| 5     | Mehrspur (V2/B-Roll), Caption-Templates, Reframing             | mittel  |
