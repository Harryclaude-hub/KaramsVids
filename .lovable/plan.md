# VideoCraft AI — Plan (v1, alles in einem Zug)

Ich baue in diesem Zug ein strukturiertes, funktionsfähiges Fundament. Wichtig vorab — ehrlich zur Realität:

## Was in einem Zug realistisch geht
- **Login + Cloud** (Lovable Cloud): Auth, Datenbank, Video-Storage.
- **Upload + Link-Import** von Rohmaterial in die Cloud.
- **KI-Analyse** (Lovable AI, kostenlos für dich): Video wird transkribiert (audio verstehen), Szenen/Highlights erkannt, Cut-Vorschläge, automatisch generierte Untertitel (SRT/VTT), Modi „Normal Cut" / „High-Level UGC" / „Long → viele Shorts".
- **Rendering im Browser** via `ffmpeg.wasm`: Cuts, Untertitel einbrennen, einfache Übergänge, Format-Export (16:9 / 9:16 / 1:1), MP4-Download.
- **Social-Publishing-Struktur**: OAuth-Buttons + Verbindungs-UI für TikTok, YouTube, Instagram (Graph), Facebook, X — mit Upload-Server-Function pro Plattform.
- **Projekt-Dashboard**: Rohvideos, Jobs, generierte Clips, Verlauf.

## Was ehrlich gesagt NICHT in einem Zug seriös geht
- **Server-seitiges High-End-Rendering** (komplexe Effekte, Motion Graphics, 100 Clips in einem Klick auf Server-Niveau wie CapCut/Descript). Grund: die App läuft auf Cloudflare Workers — kein ffmpeg-Binary, keine GPU. Optionen später: externen Render-Dienst (Shotstack/Creatomate/Cloudinary/Replicate) anbinden — kosten dann Geld.
- **Fertige App-Freigaben bei TikTok/Instagram/YouTube**: die OAuth-Apps musst du bei den Plattformen selbst registrieren und freischalten lassen (kann Tage/Wochen dauern). Ich baue die Integration technisch fertig — du trägst dann API-Keys ein.

## Architektur

```
[Browser]
  Upload / Link-Import ──► Lovable Cloud Storage (raw-videos bucket)
  ffmpeg.wasm  ◄─ generierte Clips ─► Storage (rendered-clips bucket)
        │
        ▼
[Server Functions (TanStack)]
  - createRawVideo / listVideos
  - analyzeVideo → Lovable AI (google/gemini-2.5-flash, gratis-Tier, multimodal)
      → Transkript + Segmente + Cut-Plan + Untertitel
  - createRenderJob / listJobs / getJob
  - publishTo{TikTok|YouTube|Instagram|Facebook|X}  (Skelett + OAuth)
```

## Datenmodell (Lovable Cloud / Supabase)
- `profiles(id, display_name, avatar_url)`
- `raw_videos(id, user_id, title, source_url, storage_path, duration_s, status, created_at)`
- `edit_jobs(id, user_id, raw_video_id, mode, options jsonb, status, progress, created_at)`
  - `mode`: `auto_cut` | `ugc_shorts` | `long_to_many` | `manual`
  - `options`: aspect ratio, Untertitel-Stil, Cut-Aggressivität, Ziel-Clipanzahl, Sprache
- `generated_clips(id, job_id, user_id, storage_path, aspect, duration_s, caption_srt, thumbnail_url, meta jsonb)`
- `social_accounts(id, user_id, platform, handle, access_token_encrypted, refresh_token_encrypted, expires_at)`
- `publish_jobs(id, clip_id, platform, status, external_url, error, created_at)`

RLS auf alle Tabellen: `user_id = auth.uid()`. Storage-Buckets `raw-videos` (privat) und `rendered-clips` (privat, signed URLs).

## UI (Routen)
- `/` — Landing (öffentlich, Login-CTA)
- `/auth` — Login/Register (Email + Google)
- `/app` — Dashboard (Rohvideos + Jobs)
- `/app/upload` — Upload / URL-Import
- `/app/video/$id` — Video-Detail: Editor-Modus wählen (Normal Cut / UGC / Long→Shorts), Optionen (Untertitel an/aus, Sprache, Aggressivität, Zielanzahl), „Analysieren & Schneiden" starten
- `/app/job/$id` — Job-Status + generierte Clips-Vorschau + Download + „Publish to…"-Buttons
- `/app/connections` — Social-Media-Konten verbinden

## Design-System
- Dunkle, editorielle Ästhetik (kein Neon-Purple), Akzent warm-orange für „Cut/Action", monospaced Details für Timecodes. Semantische Tokens in `src/styles.css`.

## Rendering-Details (ffmpeg.wasm im Browser)
- Video wird per signed URL geladen, `ffmpeg` schneidet nach dem KI-Cut-Plan (`-ss`/`-to` Segmente + `concat`), rendert 9:16-Version mit Crop, brennt SRT als Untertitel ein (`subtitles=…:force_style=…`), Fade-Übergänge (`xfade`). Ergebnis-MP4 wird zurück in Storage geladen.
- Läuft auf dem Client → keine Server-Kosten, aber Videos >~500 MB werden zäh. Für v1 Limit 500 MB pro Rohvideo.

## Publishing (v1-Umfang)
- **YouTube Data API v3** (resumable upload) — funktioniert mit OAuth.
- **TikTok Content Posting API** — OAuth + Upload-Endpoint.
- **Instagram Graph / Facebook Graph** — Reels/Video-Container-Flow.
- **X API v2** — Media Upload + Tweet.
- Jeder Provider braucht Client-ID/Secret als Secret (frage ich dich beim ersten Verbinden ab, wenn du willst).

## Was ich in diesem Zug baue (Reihenfolge)
1. Lovable Cloud aktivieren (Auth + DB + Storage).
2. Design-System + Landing + Auth-Flow.
3. Migration: alle Tabellen + RLS + Storage-Buckets.
4. Dashboard + Upload/Import + Video-Detail.
5. Server-Function `analyzeVideo` (Lovable AI, google/gemini-2.5-flash, multimodal auf Audio).
6. Editor-Seite mit ffmpeg.wasm-Rendering + Clip-Vorschau + Download.
7. Connections-Seite + Publish-Server-Functions (Skelett + YouTube komplett).
8. Doku-Karte in der App, was noch API-Keys braucht.

Sag „los" und ich starte. Möchtest du eine der Punkte anders (z. B. YouTube weglassen, andere Modelle, andere Bucket-Größe)? Sonst baue ich genau das.
