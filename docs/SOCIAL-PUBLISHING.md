# Social-Publishing: Wie die Website automatisiert in verbundene Accounts postet

Stand: Juli 2026

## Das Grundprinzip (gilt für alle Plattformen)

Du „kaufst" keine APIs — du **registrierst selbst kostenlos eine Developer-App** bei jeder
Plattform. Die App bekommt eine **Client-ID + Client-Secret**. Damit läuft OAuth:

```
Nutzer klickt „TikTok verbinden" auf der Website
   → Redirect zur Plattform (Login + Zustimmung)
   → Plattform leitet zurück mit Code
   → Server tauscht Code gegen Access-Token + Refresh-Token
   → Tokens verschlüsselt in social_accounts (pro Brand!) speichern
   → Publish-Queue nutzt Token, um Videos hochzuladen
```

**Stand heute ist das gebaut und in Betrieb:**
- `social_accounts` mit verschlüsselten Tokens, `brand_id` und `external_id`
- beliebig viele Kanäle pro Plattform und Brand
- OAuth-Start und Callback für alle fünf Plattformen
- echte Upload-Adapter (YouTube, Instagram, Facebook, TikTok)
- Kommentar-Posteingang mit Auto-Antworten
- echte Kennzahlen statt Schätzungen

Wie das eingerichtet wird, steht in [BETRIEB.md](./BETRIEB.md).

## Plattform für Plattform

### 1. YouTube — sofort machbar, kostenlos ⭐
- **Wo:** [console.cloud.google.com](https://console.cloud.google.com) → Projekt anlegen → „YouTube Data API v3" aktivieren → OAuth-Client-ID (Web) erstellen
- **Scope:** `youtube.upload`
- **Ohne Review nutzbar:** Ja — App im „Testing"-Modus, bis zu 100 Test-Nutzer (deine eigenen Google-Accounts einfach als Tester eintragen)
- **Limit:** 10.000 Quota-Units/Tag, 1 Upload = 1.600 Units → **~6 Uploads/Tag** pro Projekt
- **Mehr Quota:** kostenloses Audit-Formular (YouTube API Services Audit) ausfüllen
- **Upload-Technik:** Resumable Upload (Video in Chunks streamen)

### 2. Instagram + Facebook (Meta) — sofort für eigene Accounts ⭐
- **Wo:** [developers.facebook.com](https://developers.facebook.com) → App anlegen (Typ Business)
- **Voraussetzung:** Instagram-**Business**-Account (kostenlos umstellbar), verknüpft mit einer Facebook-Page
- **Scopes:** `instagram_business_basic`, `instagram_business_content_publish` (+ `pages_manage_posts` für FB)
- **Der Trick:** Im **Development-Mode** funktioniert alles für Accounts mit App-Rolle (Admin/Developer/Tester) — **ohne App-Review!** Da du deine eigenen Brand-Accounts postest, trägst du sie als Tester ein → sofort produktiv nutzbar.
- **App-Review** (2–4 Wochen, Screencast nötig) erst, wenn fremde Nutzer die Website nutzen sollen
- **Limits:** 100 API-Posts pro Account pro 24h; Reels max. 90 s über API
- **Upload-Technik:** 2 Schritte — Container erstellen (`POST /{ig-user-id}/media`, `media_type=REELS`, Video-URL) → publizieren (`/media_publish`). Wichtig: Video muss per **öffentlicher URL** abrufbar sein → unsere signierten Supabase-Storage-URLs funktionieren dafür.

### 3. TikTok — der einzige harte Brocken
- **Wo:** [developers.tiktok.com](https://developers.tiktok.com) → App anlegen → „Content Posting API" beantragen
- **Ohne Audit:** Posts sind zwangsweise **SELF_ONLY** (nur du siehst sie) + max. 5 autorisierte Accounts/24h
- **Praktischer Workaround ohne Audit:** Modus „Upload to Inbox/Draft" — das Video landet in den TikTok-Entwürfen des Accounts, du tippst in der TikTok-App nur noch „Posten". Halbautomatisch, aber sofort nutzbar.
- **Audit für echtes Direct-Posting:** Privacy-Policy-URL, Demo-Video des kompletten Flows, UI muss Privacy-Level/Duet/Stitch-Optionen anzeigen; Dauer 1–6 Wochen. App muss als öffentliches Tool positioniert sein.
- **Kosten:** kostenlos

### 4. X (Twitter) — überspringen
- Free-Tier: 500 Posts/Monat, Media-Upload eingeschränkt; sinnvolle Nutzung ab Basic **200 $/Monat** → lohnt für Video-Publishing nicht.

## Was fertig ist

| Baustein | Datei |
|---|---|
| OAuth-Start | `src/lib/social.functions.ts` |
| OAuth-Callback, legt alle Kanäle eines Logins an | `src/routes/api/public/oauth/$platform/callback.ts` |
| Token-Refresh vor jedem Zugriff | `src/lib/social-oauth.server.ts` |
| Upload-Adapter je Plattform | `src/lib/social-publish.server.ts` |
| Kommentare lesen und beantworten | `src/lib/social-comments.server.ts` |
| Regelwerk und Durchlauf | `src/lib/comment-sync.server.ts` |
| Echte Kennzahlen | `src/lib/social-metrics.server.ts` |

Offen bleibt nur, was von außen kommt: die Secrets je Plattform und bei
TikTok die Freigabe der Kommentar-Rechte.

## Empfohlene Reihenfolge

1. **YouTube** — heute registrierbar, sofort 6 Uploads/Tag
2. **Meta (IG+FB)** — Development-Mode + eigene Accounts als Tester = sofort produktiv
3. **TikTok** — sofort mit Draft-Workaround starten, Audit parallel beantragen
4. **X** — nur falls später wirklich nötig

Gesamtkosten: **0 €** (alle Registrierungen kostenlos, nur X würde kosten).
