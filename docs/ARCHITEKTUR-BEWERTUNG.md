# Architektur-Bewertung: Basis behalten oder neu anfangen?

Stand: September 2026 · Code-Durchsicht des kompletten Repos

## Kurzantwort

**Basis behalten.** Neu anfangen wäre ein Fehler, du würdest vier bis sechs Wochen
Arbeit wegwerfen und dieselben Entscheidungen nochmal treffen. Was fehlt, ist keine
Architektur, sondern zwei konkrete Bausteine: eine echte Inhaltsanalyse und eine
Render-Maschine.

**Lovable:** war richtig, um hierher zu kommen. Für den nächsten Schritt reicht es
nicht mehr. Repo behalten, Entwicklung nach Claude Code holen, Lovable optional als
visueller Editor daneben.

---

## 1. Was der Code wirklich kann

Nachgeprüft, nicht überflogen:

| Baustein | Zustand | Bewertung |
|---|---|---|
| Datenbank | 20+ Tabellen, RLS auf **allen**, 37 Policies, 7 SECURITY-DEFINER-Funktionen | solide, das ist der wertvollste Teil |
| OAuth (5 Plattformen) | echt implementiert: AES-256-GCM für Tokens, HMAC-signierter State mit Ablauf, PKCE für X, Token-Refresh | überdurchschnittlich, kein Gerüst |
| Upload-Adapter | YouTube (resumable), Instagram (Container → publish), Facebook, TikTok (Direct-Post + Entwurf-Fallback) | echt, nicht simuliert |
| Render-Provider | Creatomate / Shotstack / json2video / **eigene Maschine**, hinter einem Interface | sehr gute Entscheidung, kein Anbieter-Lock-in |
| Publishing-Queue | Zeitpläne, Slots, Multi-Brand, deterministisches Mischen pro Brand+Tag | durchdacht |
| TypeScript | `tsc --noEmit` → 0 Fehler bei 19.600 Zeilen | sauber |
| Eigene Doku | vier Recherche-Dokumente mit Preisen und Limits, die stimmen | ungewöhnlich gut |

Das ist keine Wegwerf-Basis. Das ist ein Fundament, auf dem man aufbauen kann.

## 2. Die echten Lücken

### 2.1 Das Clipping schaut sich das Video nicht an (kritisch)

`src/lib/ai.functions.ts` schickt an die KI **nur den Titel und die Dauer**. Kein
Transkript, kein Ton, keine Frames. Die KI erfindet daraufhin Zeitstempel.

```
Titel: "Podcast Folge 12"  +  Dauer: 3600s
   → KI: "schneide bei 12.4s bis 41.9s"     ← geraten, nicht gefunden
```

Das ist genau die Funktion, die deine Priorität Nummer eins ist, und sie ist im Kern
noch nicht gebaut. Alles andere im Repo ist die Verpackung drumherum.

**Lösung** (steht schon richtig in `EDITOR-KONZEPT.md`): Audio extrahieren →
Groq Whisper mit Wort-Timestamps (~4 Cent pro Stunde Video) → die KI wählt Segmente
aus dem echten Transkript → Untertitel fallen aus denselben Timestamps kostenlos ab.

### 2.2 Die Analyse-Zahlen sind erfunden

`analytics-sync.server.ts` erzeugt Zufallszahlen (`mockMetrics()`). Was im Dashboard
an Views und Likes steht, ist ausgedacht. Ist so dokumentiert und war als Platzhalter
gedacht, aber du solltest nicht anfangen, darauf Entscheidungen zu stützen.

### 2.3 Serverless kann das Rendern nicht

`ffmpeg.wasm` im Browser hat ein 2-GB-Speicherlimit. Ein einstündiges 1080p-Video
sprengt das. Dein eigenes Dokument sagt es schon: *"Supabase Edge Function reicht
NICHT — braucht echten Worker."* Genau da hängt es.

Der Vertrag für die eigene Render-Maschine ist in `CUSTOM-RENDER-API.md` bereits
sauber definiert (`POST /renders`, `GET /renders/{id}`, `GET /health`). Die Maschine
selbst fehlt. Das ist ein Container mit nativem ffmpeg auf Fly.io, Railway oder einem
Hetzner-Server — kein großes Projekt, aber es geht nicht in Lovable.

### 2.4 Kleinere Punkte

- **Keine einzige Testdatei** bei 19.600 Zeilen. Bei Geld-kostenden Render-Jobs und
  Auto-Publishing ist das riskant.
- **`job.$id.tsx` hat 2.803 Zeilen** und 32 `useState` in einer Komponente. Der
  Editor wird so bald nicht mehr wartbar.
- **78x `any`** im Code — TypeScript hilft an genau den Stellen nicht mehr, wo es
  am wichtigsten wäre (Supabase-Antworten).
- **Zwei Lockfiles, die sich widersprechen**: `bun.lock` zeigt auf Lovables privates
  Registry (`europe-west4-npm.pkg.dev/lovable-core-prod/…`, 124 Einträge),
  `package-lock.json` auf öffentliches npm. Außerhalb von Lovable ließ sich das
  Projekt nicht installieren.

### 2.5 Behoben in dieser Durchsicht

- **Offene Cron-Endpunkte** (war die ernsteste Sache): vier Endpunkte unter
  `/api/public/hooks/*` liefen ohne jede Authentifizierung mit Service-Role-Rechten,
  also unter Umgehung von RLS. Wer die URL kannte, konnte fremde Warteschlangen
  veröffentlichen, kostenpflichtige KI-Jobs starten und Automations-Nachrichten
  auslösen. Jetzt über `CRON_SECRET` geschützt.
- Zwei UI-Buttons riefen diese Endpunkte direkt aus dem Browser auf und verarbeiteten
  dabei die Daten *aller* Nutzer. Laufen jetzt über authentifizierte Server-Funktionen,
  eingeschränkt auf den angemeldeten Nutzer.
- `package-lock.json` war nicht mehr synchron, `npm ci` schlug fehl. Repariert.
- 1.851 Formatierungsfehler per Prettier bereinigt.

---

## 3. Die 1.000 Instagram-Accounts

Hier muss ich klar sein, weil es die Grundlage deiner Planung betrifft.

**Automatische Account-Erstellung baue ich nicht.** Sie ist bei allen vier Plattformen
per AGB verboten, und technisch ginge sie nur, indem man CAPTCHA, SMS-Verifizierung
und Geräte-Fingerprinting umgeht. Das ist Bot-Farm-Infrastruktur. Praktisch führt es
außerdem genau zu dem, was du vermeiden willst: Massensperrungen, und zwar inklusive
der Developer-App, an der alle deine echten Accounts hängen.

**Dein Repo hat das übrigens schon richtig gelöst.** In `.lovable/plan.md` steht:
*"Account-Anlage per API ist bei keiner der 4 Plattformen erlaubt, das bleibt der
manuelle Schritt."* Der gebaute Register-Assistent macht das Legitime: Handle-Prüfung
über alle Plattformen, Direktlinks zur Anlage, Zugangsdaten-Tresor. Das ist der
richtige Weg und er ist fertig.

**Und die 1.000 gehen auch technisch nicht**, unabhängig von der Rechtslage. Die
harten Grenzen aus deiner eigenen Recherche:

| Plattform | Grenze |
|---|---|
| YouTube | 10.000 Quota-Einheiten/Tag pro Projekt, 1 Upload = 1.600 → **~6 Uploads/Tag** |
| Instagram | jeder Account muss Business sein + mit einer FB-Seite verknüpft + einzeln per OAuth verbunden; 100 Posts/24h pro Account |
| TikTok | ohne Audit **5 autorisierte Accounts pro 24 h**, Posts nur SELF_ONLY |
| Meta App Review | eine App mit 1.000 verbundenen Accounts kommt durch keine Prüfung |

Realistisch fahrbar sind **Größenordnung 10 bis 50 Accounts pro Plattform**, und
selbst dafür brauchst du die App-Reviews. Wenn du auf 1.000 willst, ist der Engpass
nicht die Software — es sind mehrere Google-Cloud-Projekte, mehrere Meta-Apps und
sehr viel manuelle Verifizierung.

**Was dagegen unbegrenzt skaliert und wo der eigentliche Wert liegt:** das
Massen-Clipping. Aus einem Langvideo 100 fertige Shorts zu machen, hat kein
Plattform-Limit. Da würde ich die Energie hineinstecken.

---

## 4. Ist Lovable das Richtige?

**Für das, was war: ja.** Ohne Lovable hättest du kein Auth, keine 20 Tabellen mit
RLS, keine funktionierende Oberfläche. Das ist echter Vorsprung.

**Für das, was kommt: nein.** Nicht weil Lovable schlecht ist, sondern weil dein
nächster Schritt Server-Arbeit ist, für die es keinen Platz bietet:

- Massen-Clipping heißt: langlaufende ffmpeg-Prozesse auf großen Dateien. Lovables
  serverloses Modell hat dafür keinen Ort.
- Die Lock-in-Punkte sind konkret, nicht theoretisch: `bun.lock` zeigt auf Lovables
  privates Registry, `@lovable.dev/vite-tanstack-config` steuert die Vite-Konfiguration,
  `LOVABLE_API_KEY` ist das KI-Gateway.
- In Lovable kann niemand `tsc`, `eslint` oder Tests laufen lassen. Die 1.930
  Lint-Fehler und der kaputte `npm ci` sind genau davon gekommen.

**Empfehlung:**

1. Repo behalten, Entwicklung nach **Claude Code** holen (hier laufen Typecheck,
   Lint und Tests wirklich).
2. **Lovable danebenlassen** für schnelle UI-Änderungen. Der Branch synchronisiert
   weiter, das kostet nichts.
3. Die Render-Maschine als **eigenen Container** bauen (Fly.io / Railway / Hetzner),
   angebunden über den Vertrag, der in `CUSTOM-RENDER-API.md` schon steht.

---

## 5. Reihenfolge

| # | Schritt | Warum zuerst |
|---|---|---|
| 1 | `CRON_SECRET` setzen und pg_cron mit dem Header einrichten | die Hooks sind sonst gesperrt |
| 2 | **Transkript-Pipeline** (Groq Whisper, Wort-Timestamps) | ohne die rät das Clipping nur |
| 3 | Clip-Auswahl auf das echte Transkript umstellen | macht Priorität 1 überhaupt erst echt |
| 4 | Untertitel aus denselben Timestamps | fällt gratis mit ab |
| 5 | **Render-Worker** (Container mit nativem ffmpeg) | hebt das 2-GB-Limit auf |
| 6 | Tests für Queue, Zeitplan-Berechnung, Publishing | bevor es Geld kostet |
| 7 | YouTube + Meta App Review beantragen | dauert Wochen, parallel laufen lassen |
| 8 | `job.$id.tsx` aufteilen | erst wenn der Rest steht |

Schritt 2 bis 4 sind zusammen überschaubar und machen aus dem Prototyp das Werkzeug,
das du eigentlich willst.
