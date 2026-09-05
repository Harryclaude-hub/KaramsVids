# Betrieb: viele Accounts, Auto-Antworten, echtes Tracking

Stand: September 2026

Diese Datei beschreibt, was eingerichtet sein muss, damit die Plattform
selbständig läuft: Kanäle verbinden, Videos posten, Kommentare beantworten,
Zahlen einsammeln.

## Der Aufbau in einem Satz

Ein Login → mehrere **Profile** (`workspaces`) → je Profil mehrere **Brands** →
je Brand beliebig viele **Kanäle** (`social_accounts`) auf TikTok, YouTube,
Instagram und Facebook.

```
Login (auth.users)
 └── Profil            workspaces          z. B. "Agentur", "Privat"
      └── Brand        brands              z. B. "Fitness", "Auto"
           └── Kanal   social_accounts     @fitness_de (IG), FitnessDE (YT), …
                ├── Beiträge               post_metrics
                ├── Kommentare             social_comments
                └── Einnahmen              earnings
```

Mehrere Kanäle derselben Plattform in einem Brand sind ausdrücklich erlaubt.
Der frühere Riegel `UNIQUE (user_id, platform)` ist entfernt; eindeutig ist
jetzt die Kombination aus Nutzer, Plattform, Brand und Kanal-ID.

## Was diese Plattform nicht tut

Accounts bei TikTok, YouTube, Instagram oder Facebook werden **nicht**
automatisch angelegt. Das verbieten die Nutzungsbedingungen aller vier
Anbieter und würde zu Sperren führen. Du legst Accounts wie gewohnt selbst an
und verbindest sie hier per offiziellem Login. Alles Weitere, also Hochladen,
Antworten und Auswerten, läuft danach automatisch über die dokumentierten
Schnittstellen.

## Umgebungsvariablen

| Variable | Wofür | Pflicht |
|---|---|---|
| `SOCIAL_TOKEN_KEY` | Verschlüsselt die Zugangs-Tokens in der Datenbank | ja |
| `SOCIAL_STATE_SECRET` | Signiert den OAuth-State | ja |
| `CRON_SECRET` | Schützt `/api/public/hooks/*` vor fremden Aufrufen | dringend empfohlen |
| `LOVABLE_API_KEY` | KI-Antworten auf Kommentare | nur für KI-Regeln |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | YouTube | pro Plattform |
| `META_APP_ID` / `META_APP_SECRET` | Instagram + Facebook | pro Plattform |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok | pro Plattform |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X | optional |

Zusätzlich lassen sich die angeforderten Rechte je Plattform überschreiben,
etwa `TIKTOK_SCOPES` oder `YOUTUBE_SCOPES`. Das ist nötig, sobald TikTok deiner
App die Kommentar-Rechte freischaltet (siehe unten).

Als Redirect-URI trägst du bei jeder Developer-App ein:

```
https://<deine-domain>/api/public/oauth/<plattform>/callback
```

## Zeitpläne einrichten (pg_cron)

Ohne diese Jobs passiert nichts von allein. Einmal im Supabase-SQL-Editor
ausführen und dabei Domain und Secret einsetzen:

```sql
-- Einmalig, falls noch nicht vorhanden
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Videos aus der Warteschlange posten, alle 5 Minuten
SELECT cron.schedule('publish-queue', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://DEINE-DOMAIN/api/public/hooks/process-publish-queue',
    headers := '{"Content-Type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb
  );
$$);

-- Kommentare holen und nach Regeln beantworten, alle 15 Minuten
SELECT cron.schedule('sync-comments', '*/15 * * * *', $$
  SELECT net.http_post(
    url := 'https://DEINE-DOMAIN/api/public/hooks/sync-comments',
    headers := '{"Content-Type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb
  );
$$);

-- Kennzahlen aller Kanäle abholen, stündlich
SELECT cron.schedule('sync-analytics', '0 * * * *', $$
  SELECT net.http_post(
    url := 'https://DEINE-DOMAIN/api/public/hooks/sync-analytics',
    headers := '{"Content-Type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb
  );
$$);
```

Laufende Jobs anzeigen: `SELECT * FROM cron.job;`
Einen Job entfernen: `SELECT cron.unschedule('sync-comments');`

Solange `CRON_SECRET` nicht gesetzt ist, sind die Endpunkte offen erreichbar.
Setz die Variable, sonst kann jeder deine Uploads und KI-Aufrufe auslösen.

## Kommentare und Auto-Antworten

**Posteingang:** Unter *Kommentare* laufen alle Kommentare der verbundenen
Kanäle zusammen. Jeder Kommentar lässt sich von Hand beantworten oder abhaken.

**Regeln:** Eine Regel besteht aus Stichwörtern und einer Antwort. Zwei Arten:

- *Vorlage*: fester Text mit den Platzhaltern `{name}`, `{brand}`, `{kommentar}`
- *KI*: eine Anweisung, aus der die KI je Kommentar eine passende Antwort
  schreibt. Vor dem Speichern lässt sich die Antwort an einem Testkommentar
  ausprobieren.

Es greift immer die Regel mit der höchsten Priorität, deren Stichwort passt.
Ohne Stichwörter passt eine Regel auf jeden Kommentar.

**Sicherheitsnetze**, damit nichts aus dem Ruder läuft:

- Auto-Antworten sind je Kanal einzeln zu aktivieren, Standard ist aus
- jede Regel hat ein Tageslimit
- eigene Kommentare werden nie beantwortet
- jeder Kommentar wird höchstens einmal beantwortet
- eine Wartezeit je Regel verhindert Antworten in derselben Sekunde
- eine Ausschlussliste hält bestimmte Wörter von Antworten fern

### Rechtelage je Plattform

| Plattform | Kommentare lesen | Antworten | Bemerkung |
|---|---|---|---|
| YouTube | ja | ja | braucht den Scope `youtube.force-ssl`. Bestehende Kanäle einmal neu verbinden, sonst fehlt das Recht. |
| Instagram | ja | ja | Business-Account mit verknüpfter Facebook-Seite |
| Facebook | ja | ja | Seiten-Rechte nötig |
| TikTok | nur mit Freigabe | nur mit Freigabe | Scopes `comment.list` und `comment.create` bei TikTok beantragen, danach `TIKTOK_SCOPES` setzen und Kanal neu verbinden |
| X | nein | nein | Video und Kommentare erst ab dem kostenpflichtigen Tier |

## Tracking

Die Seite *Tracking* zeigt Follower, Aufrufe, Likes, Kommentare und erfasste
Einnahmen über alle Kanäle, gruppiert nach Brand, dazu die stärksten Beiträge.

Die Zahlen kommen aus den offiziellen Schnittstellen und landen in
`post_metrics` (je Beitrag) und `analytics_snapshots` (Verlauf je Kanal).
Was eine Plattform nicht herausgibt, bleibt 0. Es wird nichts geschätzt.

Einnahmen trägst du unter *Profil & Earnings* ein oder ordnest sie einem
Affiliate-Programm zu. `earnings.social_account_id` erlaubt die Zuordnung zu
einem einzelnen Kanal.

## Wenn etwas klemmt

| Meldung | Ursache und Lösung |
|---|---|
| „Der Zugriff auf Kommentare fehlt" | YouTube-Kanal wurde vor der Scope-Erweiterung verbunden. Kanal trennen und neu verbinden. |
| „Kein Instagram-Business-Account gefunden" | Instagram-Konto auf Business umstellen und mit einer Facebook-Seite verknüpfen. |
| „scope_not_authorized" bei TikTok | Die beantragten Rechte sind noch nicht freigegeben. |
| „SOCIAL_TOKEN_KEY fehlt" | Umgebungsvariable setzen und neu ausrollen. |
| Kanal steht auf „error" | Die genaue Meldung steht unter *Social* und *Tracking* am Kanal. |
