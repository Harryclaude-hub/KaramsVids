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
                ├── Direktnachrichten      social_dms
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
| `WORKER_SECRET` | Ausweis des lokalen Schnitt-Workers gegenüber `/api/worker/*` | ja, sobald der Worker läuft |
| `LOVABLE_API_KEY` | KI-Antworten auf Kommentare und Direktnachrichten | nur für KI-Regeln |
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

-- Direktnachrichten holen und nach Regeln beantworten, alle 10 Minuten
-- (enger als bei Kommentaren, weil Meta nur 24 Stunden Zeit zum Antworten lässt)
SELECT cron.schedule('sync-dms', '*/10 * * * *', $$
  SELECT net.http_post(
    url := 'https://DEINE-DOMAIN/api/public/hooks/sync-dms',
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

**Posteingang:** Unter *Kommentare & Nachrichten* laufen alle Kommentare der
verbundenen Kanäle im Reiter *Kommentare* zusammen. Jeder Kommentar lässt sich
von Hand beantworten oder abhaken. Direktnachrichten haben einen eigenen
Reiter, siehe unten.

**Regeln:** Eine Regel besteht aus Stichwörtern und einer Antwort. Zwei Arten:

- *Vorlage*: fester Text mit den Platzhaltern `{name}`, `{brand}`, `{kommentar}`
  und `{nachricht}` (`{nachricht}` meint dasselbe wie `{kommentar}`, liest sich
  bei Nachrichten-Regeln aber natürlicher)
- *KI*: eine Anweisung, aus der die KI je Kommentar eine passende Antwort
  schreibt. Vor dem Speichern lässt sich die Antwort an einem Testkommentar
  ausprobieren.

Jede Regel hat ein Feld *Gilt für*: *Kommentare*, *Direktnachrichten* oder
*Beides*. Ältere Regeln ohne diese Angabe gelten nur für Kommentare.

Es greift immer die Regel mit der höchsten Priorität, deren Stichwort passt.
Ohne Stichwörter passt eine Regel auf jeden Kommentar bzw. jede Nachricht.

**Sicherheitsnetze**, damit nichts aus dem Ruder läuft:

- Auto-Antworten sind je Kanal einzeln zu aktivieren, Standard ist aus
- jede Regel hat ein Tageslimit
- eigene Kommentare werden nie beantwortet
- jeder Kommentar wird höchstens einmal beantwortet
- eine Wartezeit je Regel verhindert Antworten in derselben Sekunde
- eine Ausschlussliste hält bestimmte Wörter von Antworten fern

### Rechtelage je Plattform

| Plattform | Kommentare lesen | Antworten | DMs | Bemerkung |
|---|---|---|---|---|
| YouTube | ja | ja | nein | braucht den Scope `youtube.force-ssl`. Bestehende Kanäle einmal neu verbinden, sonst fehlt das Recht. YouTube hat keine Direktnachrichten. |
| Instagram | ja | ja | ja | Business-Account mit verknüpfter Facebook-Seite. Für DMs den Scope `instagram_manage_messages` und in der Instagram-App unter „Verbundene Tools" den Nachrichtenzugriff erlauben. |
| Facebook | ja | ja | ja | Seiten-Rechte nötig. Für DMs den Scope `pages_messaging`. |
| TikTok | nur mit Freigabe | nur mit Freigabe | nein | Scopes `comment.list` und `comment.create` bei TikTok beantragen, danach `TIKTOK_SCOPES` setzen und Kanal neu verbinden. TikTok stellt keine DM-Schnittstelle bereit. |
| X | nein | nein | nein | Video und Kommentare erst ab dem kostenpflichtigen Tier. Die DM-Schnittstelle von X ist nicht angebunden. |

## Direktnachrichten

Der Reiter *Direktnachrichten* unter *Kommentare & Nachrichten* sammelt die
Nachrichten aus Instagram (Business-Account) und Facebook (Seite). Beides läuft
über die Meta Graph API und den Seiten-Token. Die Nachrichten landen in
`social_dms`, gruppiert nach Konversation (`external_thread_id`): eine Person
ist ein Verlauf, die neueste Nachricht steht oben. Nachrichten ohne Text
(Anhang, Sticker, Story-Reaktion) landen mit leerem Text im Posteingang.

**Zeitplan:** Der Cron-Job `sync-dms` (siehe oben, alle 10 Minuten) ruft
`/api/public/hooks/sync-dms` auf. Von Hand geht es über *Jetzt abholen* im
Reiter. Ohne den Job passiert nichts von allein.

**Auto-Antworten:** Je Instagram- und Facebook-Kanal gibt es einen eigenen
Schalter *Nachrichten*, getrennt vom Schalter *Kommentare*. Standard ist aus.
Er steuert `auto_reply_dms_enabled`; der Zeitpunkt des letzten Abrufs steht in
`last_dm_sync_at` und wird am Kanal angezeigt. Die Automatik antwortet nur mit
Regeln, deren *Gilt für* auf *Direktnachrichten* oder *Beides* steht. Hat der
Betreiber im selben Verlauf bereits selbst geantwortet (etwa per Handy-App),
bleibt die Automatik still.

**Zusätzliche Meta-Rechte:** Beim Verbinden werden jetzt zusätzlich
`instagram_manage_messages` (Instagram) und `pages_messaging` (Facebook)
angefordert. Bei Instagram muss außerdem in der App unter *Einstellungen,
Nachrichten, Verbundene Tools* der Nachrichtenzugriff erlaubt sein. Beide
Rechte müssen in der Meta-Developer-App freigeschaltet sein; solange die App im
Entwicklungsmodus läuft, gilt das nur für Tester und Administratoren der App.

**Bestehende Kanäle neu verbinden:** Instagram- und Facebook-Kanäle, die vor
diesem Ausbau verbunden wurden, haben die neuen Rechte noch nicht. Sie müssen
unter *Kanäle* einmal getrennt und neu verbunden werden. Sonst meldet der Abruf
„Der Zugriff auf Direktnachrichten fehlt" mit dem fehlenden Scope.

**Das 24-Stunden-Fenster:** Meta erlaubt einer Seite nur innerhalb von 24
Stunden nach der letzten Nachricht der Person eine Antwort. Die Oberfläche
zeigt je Verlauf die Restzeit an; ist das Fenster zu, ist der Antwortknopf
gesperrt und es erscheint „Antwortfenster abgelaufen, erst wieder möglich,
wenn die Person schreibt". Maßgeblich ist die neueste Nachricht dieser Person
im selben Kanal, unabhängig davon, ob sie schon beantwortet wurde. Der Server
prüft das Fenster zusätzlich vor jedem Versand und übersetzt eine Ablehnung
von Meta in dieselbe Meldung. Deshalb sollte der Cron-Job enger laufen als bei
Kommentaren.

**Status je Nachricht:** `new` (offen), `replied` (beantwortet, mit Text,
Art und Zeitpunkt), `skipped` (abgehakt), `failed` (Antwort fehlgeschlagen,
die Meldung steht an der Nachricht; ein neuer Versuch geht nur von Hand).

**Längen:** Instagram erlaubt 1000 Zeichen je Nachricht, Messenger 2000. Die
Oberfläche bleibt beim kleineren Wert, dann passt es überall.

## Worker anbinden

Das eigentliche Schneiden macht der lokale Python-Worker (`worker/`, siehe
`docs/WORKER.md`). Er braucht ffmpeg und Python, beides gibt es in der Cloud
nicht. Für den Zugriff auf Datenbank und Storage gibt es zwei Betriebsarten:

1. **Über die App** (Standard auf Lovable Cloud). Lovable Cloud gibt den
   Service-Role-Schlüssel und die Datenbank-URL nicht nach außen. Der Worker
   redet deshalb über HTTP mit der App und weist sich mit einem gemeinsamen
   Geheimnis aus. Die Datenbankarbeit macht die App mit ihrem Admin-Client.
2. **Direkt** (nur mit eigenem Supabase). Der Worker greift wie bisher mit
   `SUPABASE_SERVICE_ROLE_KEY` selbst auf `edit_jobs`, `generated_clips` und
   den Storage zu. Diese Betriebsart bleibt erhalten.

### Einrichten in drei Schritten

**1. Geheimnis erzeugen.** Irgendein langer Zufallswert, zum Beispiel:

```bash
openssl rand -hex 32
```

**2. In Lovable hinterlegen.** Im Lovable-Projekt unter *Cloud*, *Secrets* ein
neues Secret `WORKER_SECRET` mit diesem Wert anlegen und die App neu ausrollen.
Secrets landen in der Server-Umgebung; im Browser taucht der Wert nie auf.

**3. Beim Worker eintragen.** Denselben Wert in `worker/.env` schreiben:

```
WORKER_SECRET=<derselbe Wert wie in Lovable>
```

Dazu braucht der Worker die Adresse der App, damit er weiß, wohin er sich
melden soll. Welche Variable das ist, steht in `docs/WORKER.md`.

### Die Schnittstelle

Alle Routen liegen unter `/api/worker/*`, sind `POST`, sprechen JSON und
verlangen den Header `Authorization: Bearer <WORKER_SECRET>`.

| Route | Wofür |
|---|---|
| `/api/worker/claim` | Auftrag beanspruchen, liefert Quelle als signierte URL oder Link |
| `/api/worker/progress` | Fortschritt und Phase melden |
| `/api/worker/analysis` | Schnittplan ablegen, nur solange noch keiner da ist |
| `/api/worker/upload-url` | Signierte Upload-URL für einen fertigen Clip |
| `/api/worker/clip` | Fertigen Clip in `generated_clips` eintragen |
| `/api/worker/finish` | Auftrag auf `done` oder `failed` setzen |
| `/api/worker/reset-clips` | Worker-Clips eines Auftrags löschen, für erneutes Anstoßen |

Antworten:

| Fall | Antwort |
|---|---|
| Alles in Ordnung | `200 {"ok":true, ...}` |
| Falsches oder fehlendes Secret | `401 {"ok":false,"error":"Nicht autorisiert"}` |
| `WORKER_SECRET` am Server nicht gesetzt | `503 {"ok":false,"error":"WORKER_SECRET fehlt"}` |
| Auftrag unbekannt oder gehört einem anderen Worker | `409` mit Meldung |
| Pflichtfeld fehlt oder hat den falschen Typ | `400` mit Meldung |

Ohne gesetztes `WORKER_SECRET` ist die Schnittstelle **geschlossen**, nicht
offen. Das ist Absicht: eine halb eingerichtete Umgebung soll niemandem
erlauben, Aufträge zu beanspruchen oder Clips einzutragen. Anders als bei
`CRON_SECRET` gibt es hier also keinen Übergangszustand.

Ein Auftrag gehört immer genau einem Worker. Beim Beanspruchen wird
`options.worker_id` in einem einzigen bedingten Update gesetzt, das nur greift,
solange das Feld leer ist. Zwei Worker holen sich deshalb nie denselben
Auftrag. Alle weiteren Aufrufe schicken ihre `workerId` mit; passt sie nicht
zum Auftrag, kommt `409`.

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
| „Der Zugriff auf Direktnachrichten fehlt" | Instagram- oder Facebook-Kanal wurde vor dem DM-Ausbau verbunden. Kanal trennen und neu verbinden, damit `instagram_manage_messages` bzw. `pages_messaging` erteilt wird. Bei Instagram zusätzlich „Verbundene Tools" prüfen. |
| „Das 24-Stunden-Fenster von Meta ist abgelaufen" | Die Person hat seit über 24 Stunden nicht geschrieben. Eine Antwort ist erst wieder möglich, wenn sie erneut schreibt. Cron-Job `sync-dms` enger stellen, damit die Automatik rechtzeitig antwortet. |
| „Facebook-Seiten-ID fehlt" | Der Kanal kennt keine Seite, über die DMs laufen. Kanal neu verbinden. |
| „Kein Instagram-Business-Account gefunden" | Instagram-Konto auf Business umstellen und mit einer Facebook-Seite verknüpfen. |
| „scope_not_authorized" bei TikTok | Die beantragten Rechte sind noch nicht freigegeben. |
| „SOCIAL_TOKEN_KEY fehlt" | Umgebungsvariable setzen und neu ausrollen. |
| Kanal steht auf „error" | Die genaue Meldung steht unter *Social* und *Tracking* am Kanal. |
| „WORKER_SECRET fehlt" (503 beim Worker) | Das Secret ist in Lovable nicht angelegt oder die App wurde danach nicht neu ausgerollt. |
| „Nicht autorisiert" (401 beim Worker) | Die Werte in Lovable und in `worker/.env` sind nicht identisch. Auf Leerzeichen am Ende achten. |
| „Auftrag gehört einem anderen Worker" (409) | Ein zweiter Worker hat den Auftrag zuerst beansprucht. In der App neu anstoßen, dann ist `options.worker_id` wieder leer. |
| „Quelle fehlt: weder storage_path noch source_url gesetzt" | Das Rohvideo hat weder Datei noch Link. Der Auftrag wird auf `failed` gesetzt. Video neu hochladen. |
