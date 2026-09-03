# Start: vom Repo zum laufenden Programm

Kompakt. Jeder Schritt mit Zeit und Kosten.

---

## Die Hosting-Entscheidung

Zwei Maschinen, weil sie zwei verschiedene Dinge tun.

| Was | Wo | Warum | Kosten |
|---|---|---|---|
| Die App: Oberfläche, Datenbank, Warteschlange, Zeitpläne | **Cloudflare Workers** | Der Build erzeugt das bereits von selbst. Nichts umzubauen. | 0 € |
| Die Zeitpläne wirklich auslösen | **Cloudflare Cron Triggers** | Löst das Problem, dass die Warteschlange bisher nur bei offenem Browser-Tab läuft | 0 € |
| Der Render-Worker: ffmpeg, Schnitt, Untertitel | **Hetzner CX22** | 20 TB Traffic inklusive. Fly und Railway rechnen pro Gigabyte ab, bei Video ist das der teure Posten. | 5,49 € |

**Nicht nehmen:** Railway (ein Dauerworker kostet dort rechnerisch 30 $/Monat),
CPX oder CCX bei Hetzner (am 15.06.2026 um 107 bis 204 Prozent verteuert).

### Was das im Monat kostet

Angenommen 20 Stunden Quellmaterial, daraus etwa 130 fertige Shorts:

| Posten | Kosten |
|---|---|
| Hetzner CX22, Render-Worker | 6,00 $ |
| Groq, Transkription 20 Stunden | 0,80 $ |
| Clip-Auswahl (Claude Haiku) | 0,60 $ |
| YouTube-Download, 20 Videos | 1,00 $ |
| Untertitel, Reframe, B-Roll, Musik | 0,00 $ |
| **Summe** | **8,40 $ im Monat** |

Cloudflare, ffmpeg, libass, Pexels und Pixabay sind kostenlos.
Die Rechenlast liegt bei 3 bis 5 CPU-Stunden im Monat auf einer Maschine,
die 1.460 liefert. Rendern ist bei dem Volumen kein Engpass.

---

## Warum nicht auf dem Laptop

Für Entwickeln ja, für Betrieb nein. Der Grund ist simpel: dein Laptop
schläft. Ein Zeitplan, der um 03:00 posten soll, postet dann nicht.
Dazu kommt, dass OAuth eine feste öffentliche HTTPS-Adresse braucht,
die in vier Entwickler-Konsolen hinterlegt wird und sich nicht mehr
ändern darf.

Lokal zum Ausprobieren:

```bash
npm ci
npm run dev          # läuft auf http://localhost:5173
```

---

## Schritt für Schritt

### 1. Öffentlicher Link, 12 Minuten, 0 €

1. [dash.cloudflare.com](https://dash.cloudflare.com), anmelden, **Account-ID** notieren (rechte Seitenleiste)
2. Profil oben rechts, **API Tokens**, **Create Token**, Vorlage **Edit Cloudflare Workers**, Token kopieren
3. Im Repo: **Settings → Secrets and variables → Actions**, zwei Secrets anlegen:
   `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID`
4. **Actions → Veröffentlichen → Run workflow**

Die Adresse steht danach im Protokoll. **Ab hier hast du deinen Link.**

### 2. App zum Laufen bringen, 10 Minuten

In Cloudflare unter **Workers → dein Worker → Settings → Variables and Secrets**:

| Variable | Typ | Woher |
|---|---|---|
| `SUPABASE_URL` | Variable | Supabase-Dashboard |
| `SUPABASE_PUBLISHABLE_KEY` | Variable | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Supabase → Settings → API |
| `CRON_SECRET` | **Secret** | `openssl rand -hex 32` |
| `PUBLIC_APP_URL` | Variable | deine neue Adresse |

### 3. Zeitpläne automatisch auslösen, 5 Minuten

In Cloudflare unter **Workers → Settings → Trigger Events → Cron Triggers**.
Ohne das bewegt sich die Warteschlange nur, solange ein Tab offen ist.

| Endpunkt | Takt |
|---|---|
| `/api/public/hooks/process-publish-queue` | alle 5 Minuten |
| `/api/public/hooks/process-generation-queue` | alle 5 Minuten |
| `/api/public/hooks/process-automations` | alle 15 Minuten |
| `/api/public/hooks/sync-analytics` | alle 30 Minuten |

Jeder Aufruf braucht den Kopf `Authorization: Bearer <CRON_SECRET>`.

### 4. Clipping echt machen, 10 Minuten, 0,80 $ im Monat

[console.groq.com](https://console.groq.com), Konto anlegen, Key erzeugen,
als `GROQ_API_KEY` in Cloudflare hinterlegen.

Das ist der wichtigste Schritt der ganzen Liste. Ohne ihn bekommt die KI
weiterhin nur Titel und Dauer und **rät** die Schnittpunkte.

### 5. Render-Worker, 30 Minuten, 5,49 € im Monat

[hetzner.com/cloud](https://www.hetzner.com/cloud), **CX22** wählen (nicht CPX, nicht CCX),
Docker und ffmpeg installieren. Die Maschine muss drei Endpunkte anbieten,
der Vertrag steht fertig in [`CUSTOM-RENDER-API.md`](CUSTOM-RENDER-API.md):

```
GET  /health          → 200
POST /renders         → { "id": "..." }
GET  /renders/{id}    → { "status": "...", "url": "..." }
```

Danach in Cloudflare `CUSTOM_RENDER_API_URL` und `CUSTOM_RENDER_API_KEY` setzen
und im Bulk-Panel den Provider „Eigene Render-Maschine" wählen.

Alternative ohne eigenen Server: `CREATOMATE_API_KEY` setzen, ab etwa 41 $/Monat.

### 6. Rechtstexte, 1 bis 3 Tage

Impressum, Datenschutzerklärung, Nutzungsbedingungen und eine
Datenlöschungs-Seite unter festen Adressen auf deiner Domain.

**Das blockiert alle drei App-Prüfungen gleichzeitig.** Meta, TikTok und
Google lehnen ohne erreichbare Datenschutz-URL sofort ab. Früh anfangen,
alles andere läuft parallel weiter.

### 7. Plattformen verbinden, je 30 bis 60 Minuten

| Plattform | Wo | Was du bekommst |
|---|---|---|
| YouTube | [console.cloud.google.com](https://console.cloud.google.com) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Instagram + Facebook | [developers.facebook.com](https://developers.facebook.com) | `META_APP_ID`, `META_APP_SECRET` |
| TikTok | [developers.tiktok.com](https://developers.tiktok.com) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |

Redirect-URI überall: `https://DEINE-ADRESSE/api/public/oauth/<plattform>/callback`

---

## Wie viele Konten wirklich gehen

Wichtig für die Planung, weil der Engpass nicht dort liegt, wo man ihn vermutet.

Nicht das Anlegen der Konten ist die Grenze, sondern das **Posten**:

| Plattform | Harte Grenze |
|---|---|
| TikTok | ohne Audit **5 postende Creator pro rollierende 24 Stunden**. Der Deckel bleibt nach dem Audit, nur höher, und richtet sich nach dem, was du im Audit angegeben hast |
| YouTube | 100 Uploads pro Tag und Projekt |
| Instagram | 100 Posts pro gleitende 24 Stunden **je Konto**, jedes Konto einzeln per OAuth verbunden |
| Facebook | Seiten-Token je Seite, App-Prüfung nötig |

Ein Video alle 30 Minuten auf 200 Konten wären 9.600 Posts am Tag. Das
scheitert nicht an der Software, die kann das. Es scheitert an diesen
Grenzen, und der Versuch ist genau das Muster, das zu Massensperrungen führt,
inklusive der Entwickler-App, an der alle deine echten Konten hängen.

**Realistisch:** 10 bis 50 Konten je Plattform, mit App-Prüfungen.
**Ohne Grenze skaliert dagegen:** aus einem Langvideo 100 Shorts machen.
Da liegt der Hebel, und dafür ist alles gebaut.
