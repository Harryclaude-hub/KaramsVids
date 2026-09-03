# Öffentlichen Link einrichten

Ziel: eine öffentliche HTTPS-Adresse, unter der die echte App läuft, mit
Login, Datenbank und Server-Routen. Kein Prototyp, das laufende Programm.

**Repo bleibt privat.** Das ist Absicht und kostet dich nichts: Cloudflare
kann private Repos bauen, und deine Secrets liegen dann in Cloudflares
Secret-Verwaltung statt im Code.

---

## Warum Cloudflare und nicht GitHub Pages

GitHub Pages scheidet aus zwei unabhängigen Gründen aus:

1. Pages aus einem privaten Repo braucht einen bezahlten GitHub-Plan.
2. Wichtiger: Pages liefert **nur statische Dateien**. Diese App ist
   TanStack Start mit echtem Server-Rendering, eigenem Server-Einstieg in
   `src/server.ts`, 14 `.server.ts`-Modulen und 7 Server-Routen. Statisch
   läuft sie überhaupt nicht.

Cloudflare passt dagegen ohne Umbau: Nitro baut **bereits jetzt** einen
Cloudflare Worker. `src/server.ts` exportiert genau die richtige Signatur
(`fetch(request, env, ctx)`), und der Build erzeugt von selbst
`.output/server/wrangler.json`. Nachgeprüft, der Build läuft außerhalb von
Lovable fehlerfrei durch.

---

## Schritt 1: Cloudflare-Konto (10 Minuten)

1. Auf [dash.cloudflare.com](https://dash.cloudflare.com) anmelden.
   Der kostenlose Tarif reicht zum Start.
2. **Account-ID** notieren, sie steht rechts in der Seitenleiste.
3. Oben rechts aufs Profil, **API Tokens**, **Create Token**,
   Vorlage **Edit Cloudflare Workers** wählen. Token kopieren,
   er wird nur einmal angezeigt.

## Schritt 2: Beide Werte in GitHub hinterlegen (2 Minuten)

Im Repo unter **Settings → Secrets and variables → Actions →
New repository secret**:

| Name | Wert |
|---|---|
| `CLOUDFLARE_API_TOKEN` | der Token aus Schritt 1 |
| `CLOUDFLARE_ACCOUNT_ID` | die Account-ID aus Schritt 1 |

Danach unter **Actions** den Ablauf **Veröffentlichen** einmal von Hand
starten (`Run workflow`). Am Ende steht die Adresse im Protokoll, in der
Form `https://harryclaude-hub-karamsvids.<dein-subdomain>.workers.dev`.

**Ab hier hast du deinen öffentlichen Link.** Alles Weitere macht ihn
funktionsfähig statt nur erreichbar.

## Schritt 3: Secrets der App in Cloudflare (10 Minuten)

In Cloudflare unter **Workers & Pages → dein Worker → Settings →
Variables and Secrets**. Die vollständige Liste steht in `.env.example`.

Diese sind Pflicht, sonst startet die App nicht:

| Variable | Typ | Woher |
|---|---|---|
| `SUPABASE_URL` | Variable | Supabase-Dashboard |
| `SUPABASE_PUBLISHABLE_KEY` | Variable | anon key, darf öffentlich sein |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Supabase → Project Settings → API |
| `CRON_SECRET` | **Secret** | selbst erzeugen: `openssl rand -hex 32` |
| `PUBLIC_APP_URL` | Variable | deine neue Worker-Adresse |

> `SUPABASE_SERVICE_ROLE_KEY` unbedingt als **Secret** anlegen, nicht als
> normale Variable. Er umgeht den kompletten Zugriffsschutz der Datenbank.

Ohne `CRON_SECRET` antworten alle fünf Hook-Endpunkte mit 503 und
Publishing, Analyse und Automationen stehen still. Das ist Absicht, sie
liefen vorher ungeschützt.

## Schritt 4: Zeitpläne wirklich laufen lassen

Die Warteschlange bewegt sich derzeit nur, solange ein Browser-Tab offen
ist. Für echten Dauerbetrieb muss jemand die Hooks regelmäßig aufrufen.
In Cloudflare geht das über **Cron Triggers** oder von außen per:

```
curl -X POST https://DEINE-ADRESSE/api/public/hooks/process-publish-queue \
     -H "Authorization: Bearer $CRON_SECRET"
```

| Endpunkt | Sinnvoller Takt |
|---|---|
| `/api/public/hooks/process-publish-queue` | alle 5 Minuten |
| `/api/public/hooks/process-generation-queue` | alle 5 Minuten |
| `/api/public/hooks/process-automations` | alle 15 Minuten |
| `/api/public/hooks/sync-analytics` | alle 30 Minuten |

## Schritt 5: Eigene Domain (optional, aber bald nötig)

Sobald du OAuth einrichtest, muss die Adresse **fest bleiben**. Sie wird
in vier Entwickler-Konsolen als Redirect-URI eingetragen und darf sich
danach nicht mehr ändern.

In Cloudflare unter **Workers → dein Worker → Settings → Domains &
Routes** eine eigene Domain verbinden. Danach `PUBLIC_APP_URL` anpassen.

---

## Was danach noch fehlt, damit die App wirklich arbeitet

Der Link allein macht die App erreichbar, nicht arbeitsfähig. In dieser
Reihenfolge:

| # | Was | Aufwand | Was ohne das nicht geht |
|---|---|---|---|
| 1 | `GROQ_API_KEY` | 10 min | Das Clipping rät die Schnittpunkte weiter, statt das Video anzuhören |
| 2 | `CREATOMATE_API_KEY` | 20 min, ab ca. 41 $/Monat | Kein einziger fertiger Clip entsteht |
| 3 | Rechtstexte unter festen Adressen | 1 bis 3 Tage | **Alle drei App-Prüfungen** lehnen sofort ab |
| 4 | Google-Cloud-Projekt, OAuth-Client | 30 bis 60 min | YouTube komplett |
| 5 | Meta-Developer-App | 30 bis 45 min | Instagram und Facebook komplett |
| 6 | TikTok-App, Domain verifizieren | 30 bis 60 min | TikTok komplett |
| 7 | Supabase auf Pro | 10 min, ca. 25 $/Monat | Der kostenlose Speicher ist nach zwei Videos voll |

Punkt 3 zuerst anstoßen. Er dauert am längsten, blockiert am meisten,
und du kannst währenddessen an allem anderen weiterarbeiten.

---

## Lovable behalten oder trennen

Beides geht gleichzeitig und schließt sich nicht aus:

- **Cloudflare** ist ab jetzt der Ort, wo die App wirklich läuft.
- **Lovable** kann als visueller Editor danebenlaufen. Der Branch
  synchronisiert weiter, das kostet nichts.

Eine harte Trennung lohnt erst, wenn Lovable im Weg ist. Was du dabei
beachten musst: `bun.lock` zeigt mit 124 Einträgen auf Lovables privates
Registry und ist außerhalb ihrer Sandbox nicht auflösbar. Deshalb bauen
CI und Deployment bewusst mit `npm ci` gegen `package-lock.json`.
