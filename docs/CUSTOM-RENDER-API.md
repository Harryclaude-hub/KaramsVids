# Eigene Render-Maschine anbinden (Provider "custom")

Du kannst die Video-Erzeugung komplett selbst bauen (z. B. ffmpeg-Worker auf deinem
eigenen Server) und im Bulk-Render-Panel als Provider **„Eigene Render-Maschine"**
auswählen. Die App spricht dann nur noch diesen einfachen JSON-Vertrag.

## Secrets

| Secret | Pflicht | Bedeutung |
|---|---|---|
| `CUSTOM_RENDER_API_URL` | ja | Basis-URL, z. B. `https://render.meinedomain.de` |
| `CUSTOM_RENDER_API_KEY` | optional | wird als `Authorization: Bearer …` mitgeschickt |

## Endpunkte, die deine Maschine anbieten muss

### `GET /health`
`200 OK` → Verbindungstest im UI ist grün.

### `POST /renders`
Body:

```json
{
  "reference": "uuid-der-render-zeile",
  "template_id": "ugc_hook",
  "overrides": { "captionStyle": "karaoke", "musicVolume": 0.18, "transition": "whip", "kenBurns": true },
  "output": { "width": 1080, "height": 1920, "fps": 30, "format": "mp4" },
  "source": { "url": "https://…signierte-quelle.mp4", "start_s": 12.4, "end_s": 41.9 },
  "captions_srt": "1\n00:00:00,000 --> …",
  "music": { "url": "https://…mp3", "volume": 0.18 },
  "title": "Hook-Text"
}
```

Antwort: `{ "id": "dein-render-id" }`

### `GET /renders/{id}`

```json
{ "status": "queued|processing|done|failed", "url": "https://…mp4", "thumbnail": "https://…jpg", "error": null }
```

Sobald `status = done` und `url` gesetzt ist, lädt die App das MP4 (und ggf. das
Thumbnail) automatisch in den Cloud-Storage `rendered-clips/{user}/{job}/` und
legt den Clip in der Brand-History an — Publishing/Slots laufen unverändert weiter.

## Storage

Du musst selbst nichts speichern: Deine Maschine darf temporäre URLs liefern
(mind. ~1 h gültig). Die dauerhafte Ablage übernimmt der Cloud-Storage der App.

## Skalierung

Die Bulk-Pipeline schickt mehrere Renders parallel (Konfiguration
`RENDER_CONCURRENCY`). Deine Maschine sollte also eine Queue haben und
`POST /renders` sofort mit einer ID antworten, statt synchron zu rendern.
