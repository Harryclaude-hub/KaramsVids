# API-Recherche: Kosten, Free-Tiers & Trade-offs

Stand: Juli 2026 · Alle Preise aus öffentlichen Quellen, vor Integration nochmal prüfen.

## 1. Social-Media-Posting (regelmäßiges Publishing)

**Option A — Direkt bei den Plattformen (kostenlos, aber Aufwand):**
| Plattform | API | Kosten | Haken |
|---|---|---|---|
| YouTube | Data API v3 | kostenlos | Quota 10.000 Units/Tag (1 Upload ≈ 1600 Units ≈ 6 Uploads/Tag); App-Review für mehr |
| TikTok | Content Posting API | kostenlos | App-Audit nötig; unauditierte Apps posten nur privat/Draft |
| Instagram/Facebook | Graph API | kostenlos | Business-Account + App-Review; Reels-Upload gut unterstützt |
| X | API v2 | Free: 500 Posts/Monat | Media-Upload im Free-Tier stark limitiert; Basic 200 $/Monat |

→ **Empfehlung Start:** YouTube + Instagram direkt (kostenlos, machbar), TikTok-Audit früh beantragen.

**Option B — Unified-API (ein Endpoint, alle Plattformen):**
| Anbieter | Preis | Free | Bewertung |
|---|---|---|---|
| Ayrshare | 149 $/Monat (1 Profil-Set), Business 599 $/Monat | Testtier | teuerste, aber reifste Lösung |
| Post Bridge / Postpeer / Zernio | ~6–30 $/Monat, z.T. pro Account | Postpeer: 20 Posts/Monat gratis | Budget-Optionen, junge Anbieter |
| Blotato / bundle.social | Mittelfeld | teils | n8n-freundlich |

→ Für unser Multi-Brand-Modell mit eigenem `publish_schedules`-System: **direkt-APIs bevorzugen** (keine laufenden Kosten pro Brand), Unified-API nur als Abkürzung falls App-Reviews nerven.

## 2. Video-Generierung (KI-Studio)

**Aggregatoren (ein API-Key, viele Modelle) — empfohlen:**
| Anbieter | Modelle | Preis | Free |
|---|---|---|---|
| **fal.ai** ⭐ | Kling 3.0, Veo 3.1, Seedance, Wan, Sora 2 (600+) | 0,05–0,40 $/s | Startguthaben |
| Replicate | ähnlich breit | 0,09–0,25 $/s | kleines Startguthaben |

**Preisniveau pro Modell (per Sekunde Video):**
- Kling 3.0: ~0,03–0,10 $/s → **bestes Preis/Leistung**, Multi-Shot mit Charakter-Konsistenz
- Veo 3.1 (Google): 0,15 $/s (fast) bis 0,75 $/s — nativer Ton, 4K, teuer
- Runway Gen-4.5: ~0,12 $/s
- Seedance/Wan: Budget-Bereich ~0,05 $/s

**Rechenbeispiel:** 30-s-Episode mit Kling ≈ 1–3 $. Mit Veo ≈ 5–22 $.

→ **Empfehlung:** fal.ai-Key anlegen, Standard = Kling (billig), Premium-Toggle = Veo 3.1 (mit Ton). Unsere `generation_jobs.provider`-Spalte ist dafür schon vorbereitet.

## 3. Menschen/Model-Generierung (Avatare)

**Bilder (Referenz-Models):**
- Flux (Black Forest Labs) via fal.ai: ~0,03–0,06 $/Bild; **Flux Schnell ist open-source/gratis**; Charakter-Konsistenz bis 5 Personen ohne Fine-Tuning
- → praktisch kostenlos machbar

**Sprechende Avatare (Talking Head):**
| Anbieter | Preis | Free |
|---|---|---|
| HeyGen | ab 29 $/Monat (Creator), API ab 5 $ | 3 Videos/Monat mit Wasserzeichen (nur Web, API-Free entfällt seit 02/2026) |
| Hedra | ab 15 $/Monat | 100 Credits/Monat gratis ⭐ |
| Akool | Credits-Modell | 100 Credits gratis, Plan läuft nicht ab |
| D-ID | Abo | nur Trial |

## 4. Overlap / Face-Swap

| Option | Preis | Bewertung |
|---|---|---|
| Magic Hour API | Free API-Key zum Start | einfachste Integration |
| VModel Video-Face-Swap | 10 $ Startguthaben ≈ 330 s Video | gutes Testbudget |
| WaveSpeedAI / Facemint | ~0,18 $ pro 10-s-Video (720p) | günstig, formelbasiert |
| Akool | Credits (100 gratis) | Face-Swap + Avatare aus einer Hand |
| **Selbst-gehostet:** Deep-Live-Cam / roop (InsightFace) | kostenlos (GPU nötig) | Open Source; GPU-Server ~0,50 $/h mieten (RunPod/Modal) |

→ **Empfehlung:** Start mit Magic Hour/VModel (Gratis-Budget), bei Volumen auf selbst-gehostetes InsightFace auf Modal/RunPod wechseln.

## 5. Transkription / Untertitel (Massen-Clipping-Grundlage)

| Anbieter | Preis | Free |
|---|---|---|
| **Groq (Whisper Large v3 Turbo)** ⭐ | ~0,0006 $/min → 1h-Video ≈ 4 Cent | großzügiger Free-Tier |
| AssemblyAI | 0,0025 $/min | 50 $ Startguthaben |
| Deepgram Nova-3 | 0,0043 $/min | 200 $ Startguthaben |
| OpenAI Whisper | 0,006 $/min | — |
| Speechmatics | — | 480 min/Monat gratis |

→ **Empfehlung:** Groq — fast gratis, Wort-Timestamps für Transkript-Editing + SRT.

## 6. TTS / Musik / Soundeffekte

**Stimmen (TTS):**
- ElevenLabs: beste Qualität, Free 10k Credits/Monat (~10 min), danach ab 5 $/Monat; API vollständig
- OpenAI TTS: 15 $/1M Zeichen, solide, keine Klon-Stimmen
- Kokoro 82M (open-source): ~0,65 $/1M Zeichen selbst-gehostet, oder gratis lokal — **Budget-Sieger**

**Musik:**
- ElevenLabs Music: ~0,80 $/min, offizielle API, inkl. Sound Effects ⭐ (Suno hat KEINE offizielle API)
- Alternative gratis: eigene Musik-Library (lizenzfreie Tracks) — haben wir mit `music-library.ts` schon begonnen

## 7. YouTube-Download (Massen-Clipping-Import)

| Option | Preis | Risiko/Haken |
|---|---|---|
| **yt-dlp selbst-gehostet** ⭐ | kostenlos | verstößt gegen YouTube-ToS (rechtlich in EU/US aber etabliertes Tool, 12M Downloads/Monat); braucht Server mit Rotation, YouTube blockt Cloud-IPs |
| Supadata API | Abo, günstig | verwaltet das IP-Problem für dich; Transcripts inklusive |
| Cobalt (public instance) | kostenlos | für YouTube seit 2026 geblockt; nur self-hosted mit Tricks |
| RapidAPI-Downloader | ~10–30 $/Monat | Qualität schwankt |

→ **Empfehlung:** Für den Start Supadata (zuverlässig, wenig Aufwand) ODER Nutzer lädt Datei manuell hoch (haben wir schon). yt-dlp-Worker später als Kostenoptimierung.

## 8. Gesamtstrategie (Kosten-Minimal-Start)

| Funktion | Start (fast gratis) | Skalierung |
|---|---|---|
| Transkription | Groq Whisper (~0 €) | bleibt |
| Untertitel | aus Whisper-Timestamps (0 €) | bleibt |
| Clipping/Schnitt | ffmpeg.wasm im Browser (0 €) | Server-Render-Worker |
| Video-Gen | fal.ai + Kling (Pay-per-Use, ~1–3 $/Clip) | Volumen-Deals |
| Model-Bilder | Flux Schnell (0 €) | Flux Pro 0,04 $/Bild |
| Talking Avatar | Hedra Free (100 Credits) | HeyGen API |
| Face-Swap | Magic Hour Free-Key | self-hosted InsightFace |
| TTS | Kokoro (0 €) / ElevenLabs Free | ElevenLabs Creator |
| Musik | eigene Library (0 €) | ElevenLabs Music |
| YT-Import | Upload durch Nutzer (0 €) | Supadata / yt-dlp-Worker |
| Social-Posting | YouTube + IG Graph direkt (0 €) | TikTok-Audit, ggf. Unified-API |

**Nächster konkreter Schritt:** fal.ai- und Groq-Keys anlegen (beide mit Free-Start), als Secrets in Lovable Cloud hinterlegen, dann verdrahte ich `generation_jobs` → fal.ai und die Transkript-Pipeline → Groq.
