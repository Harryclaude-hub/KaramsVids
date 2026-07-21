# Adobe-artiger Editor: Plan

## Zielbild
Ein einziger, dichter **Editor-Screen** (`/app/editor/$jobId?` und `/app/editor` für neu) mit:
- Links: Media-Bin (Rohvideos, Referenzen, Musik) + Effekt-Panel
- Mitte oben: Preview-Canvas (Player mit Play/Pause/Scrub, Aspect-Toggle)
- Mitte unten: **Multi-Track Timeline** (Video / Overlay / Audio) mit Drag, Trim, Split, Transitions
- Rechts: KI-Chat + Inspector (ausgewählter Clip: Position, Dauer, Untertitel, Transition, Volume, Text-Overlay)
- Oben: Brand-Selector, Projekt-Titel, Undo/Redo, Export-Button (dropdown: alle Clips / einzeln)

## Kern-Features (V1)
1. **Import**
   - Datei-Upload (Storage) oder direkte Video-URL (.mp4/.mov/.webm)
   - Bei YouTube/TikTok/Instagram-Domain: Modal mit 2 Optionen
     - "Als normales Video importieren + manuell schneiden" → verlangt direkte MP4-URL, zeigt Hinweis + Copy-Snippet für `yt-dlp`/`cobalt.tools`
     - "Ich habe die Datei" → Upload
2. **Auto-Clips-Anfrage**
   - Nach Import Dialog: Preset (Auto / 3 / 5 / 10 / Max) oder Custom-Zahl (1–20)
   - "Auto" = KI entscheidet nach Länge (bereits vorhanden)
   - KI erzeugt Segmente mit Reasoning (bestehend), Nutzer landet direkt im Editor
3. **Timeline**
   - 3 Tracks: `video` (Hauptclips, sequenziell), `overlay` (Text/Bild, absolut), `audio` (Musik/VO)
   - Drag zum Verschieben, Rand-Drag zum Trimmen, Doppelklick = Split am Playhead
   - Snapping an Nachbarn + Sekunden-Raster
   - Zoom-Slider
4. **Transitions**
   - Zwischen zwei benachbarten Videoclips: Rechtsklick → Fade / Cut / Crossfade (Dauer 0.3–1.5s)
   - Visualisiert als Rautel zwischen den Clips
5. **Text-/Untertitel-Overlays**
   - Overlay-Track: Text hinzufügen (Position: top/center/bottom, Font-Size, Farbe, Hintergrund)
   - Auto-Captions aus Whisper-Transkript (bestehendes Feld `caption_text`), per Klick in Overlay-Track übernehmen
6. **Audio-Spur mit Ducking**
   - Musik-Upload in Media-Bin, Drag auf Audio-Track
   - Toggle "Duck on speech" → nutzt Whisper-Timing des Hauptvideos für Volume-Envelope (0.25 wenn Sprache, 1.0 sonst)
7. **Echter MP4-Export via ffmpeg.wasm** (bestehendes Pattern erweitert)
   - Filter-Graph baut sich aus Timeline-State (Concat + Overlay + drawtext + amix)
   - Aspect-Crop (9:16 / 16:9 / 1:1)
   - Fortschrittsanzeige pro Clip, Ergebnis in `rendered-clips` Bucket
   - "Alle exportieren" oder pro Clip
8. **KI-Chat** bleibt rechts, bekommt zusätzliche Tools:
   - `add_text_overlay`, `add_transition`, `add_music_track`, `set_clip_transition`

## Datenmodell-Ergänzungen
Neue Migration:
```sql
ALTER TABLE generated_clips
  ADD COLUMN transitions jsonb DEFAULT '[]'::jsonb,   -- [{after_clip_id, type, duration_s}]
  ADD COLUMN overlays jsonb DEFAULT '[]'::jsonb,      -- [{type:'text', start_s, end_s, text, style}]
  ADD COLUMN audio_tracks jsonb DEFAULT '[]'::jsonb;  -- [{storage_path, volume, duck}]

ALTER TABLE edit_jobs
  ADD COLUMN timeline_state jsonb DEFAULT '{}'::jsonb; -- zoom, playhead, track_order
```
Grants + RLS bleiben wie bei bestehenden Spalten.

## Technische Details
- **Datei-Layout**
  - `src/routes/_authenticated/app/editor.tsx` (neu, „leerer" Editor mit Import)
  - `src/routes/_authenticated/app/editor.$id.tsx` (Job-basiert; ersetzt die Rolle von `job.$id.tsx` als Bearbeitungs-UI — alte Route bleibt als Legacy-Redirect)
  - `src/components/editor/*` — Preview, Timeline, TrackClip, Inspector, MediaBin, ExportDialog, ImportDialog, ClipsCountDialog
  - `src/lib/editor-state.ts` — Zustand-Store (Zustand-lib schon in Projekt? sonst reducer/context) für Timeline-Zustand + Undo/Redo
  - `src/lib/ffmpeg-render.ts` — Filter-Graph-Builder + Batch-Runner (erweitert)
- **YouTube-Detection**: Regex auf Host, Modal mit `<pre>`-Snippet
- **Autoclips-Anzahl**: neuer optionaler Param `desired_clip_count` an `analyzeVideo` (bestehende server fn), Prompt-Bedingung ergänzen
- **ffmpeg-Filter-Graph** (Beispiel-Skizze):
  ```text
  [0:v]trim=... ,scale=1080:1920,setsar=1[v0];
  [1:v]trim=... [v1];
  [v0][v1]xfade=transition=fade:duration=0.5:offset=... [vmix];
  [vmix][3:v]overlay=... [vout];
  [0:a][2:a]amix=weights=1 0.3[aout]
  ```
- **AI-Chat-Tools**: neue Tool-Defs in `src/routes/api/chat.ts`, alle schreiben in die neuen jsonb-Spalten

## Ausgeklammert (V2)
- 4K-Export, GPU-Effekte, Keyframe-Animationen, LUT-Farbkorrektur, echte YouTube-Download-Integration (rechtlich + Worker-Limit).

## Umsetzungs-Schritte
1. Migration (jsonb-Spalten) + Types-Regen
2. `editor-state.ts` + Basiskomponenten (Preview + Timeline read-only)
3. Interaktion: Drag/Trim/Split/Transition/Overlay
4. Import-Flow + ClipsCountDialog + YouTube-Modal
5. ffmpeg Filter-Graph & Export-UI
6. KI-Chat-Tools erweitern
7. Alte `job.$id.tsx` redirected auf `editor/$id`, Sidebar-Link „Editor" bleibt (`/app/editor`)

## Umfang-Hinweis
Das ist ein großer Umbau (~15 neue/veränderte Dateien). Nach Freigabe implementiere ich in dieser Reihenfolge und melde mich pro Meilenstein, damit du zwischendurch prüfen kannst.
