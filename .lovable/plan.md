## Ziel

Aus dem heutigen Tool (1 Account → Brands) wird eine dreistufige Struktur:

```text
User-Login
└── Profil (unbegrenzt, komplett getrennt)   ← umschaltbar oben links
    ├── Brands (unbegrenzt, je 1–4 Social-Accounts)
    ├── Affiliate-Links + Auszahlungs-Anbieter (pro Profil)
    └── Earnings-Übersicht (alle Brands summiert)
```

## Teil 1 — Profile-Ebene

- Neue Tabelle `profiles_workspaces` (Name, Farbe, Avatar, Payout-Anbieter, Payout-Details).
- Jede Brand bekommt `workspace_id`; Daten sind zwischen Profilen strikt getrennt (RLS + Filter).
- Profil-Switcher im Header; alle Ansichten (Editor, Clipping, Publishing, Social) folgen dem aktiven Profil.

## Teil 2 — Brand-Netzwerk & Multi-Brand-Uploads

- Ein Publishing-Slot kann **mehrere Brands** auswählen.
- „Clip duplizieren & verteilen": ein Clip wird auf N Brands kopiert, Upload-Reihenfolge pro Brand automatisch **gemischt** (Shuffle-Seed pro Brand), damit Kampagnen nicht identisch aussehen.
- Massen-Brand-Anlage: Brand erstellen → Handle-Check auf allen 4 Plattformen → Direktlinks zur Account-Erstellung + Credential-Vault (Account-Anlage per API ist bei keiner der 4 Plattformen erlaubt, das bleibt der manuelle Schritt).

## Teil 3 — Affiliate & Earnings

- Tabelle `affiliate_programs` (pro Profil): Name, Basis-Link, Vergütung (CPM / pro Sale), Notizen.
- Beim Clip/Slot wählbar: Affiliate-Programm → Link wandert automatisch in Caption/Bio-Text.
- `earnings`-Tabelle: pro Brand/Plattform/Zeitraum — teils automatisch aus den Views-Snapshots (CPM-Rechnung), teils manuell/Import.
- Profil-Dashboard: Gesamt-Earnings, Aufteilung nach Brand/Plattform/Programm, Auszahlungs-Anbieter hinterlegt.
- Ehrlich: echtes „Auscashen" (Geld abheben) geht technisch nicht — TikTok/YouTube/Meta zahlen direkt an dein Bankkonto und bieten dafür keine API. Wir zeigen alle Beträge gebündelt an und verlinken die jeweilige Auszahlungsseite; einzige echte Auszahlung wäre über Stripe Connect, falls du selbst Clipper bezahlst.

## Teil 4 — Empfohlene APIs

**YouTube-Link → MP4 (Pflicht, Server-seitig):**
| Dienst | Preis | Bewertung |
|---|---|---|
| **Supadata** | ~9 $/Mon, 10k Requests | beste Wahl: stabil, gibt direkte MP4/Transcript-URL |
| RapidAPI „ytstream"/„yt-api" | 0–15 $/Mon | günstig, aber Endpunkte brechen öfter |
| Eigener yt-dlp-Server | Server-Kosten | volle Kontrolle, aber nicht in unserer Serverless-Umgebung lauffähig |

**Massen-Rendering (Schnitt, Untertitel, Musik, Übergänge) — statt Browser-ffmpeg:**
| Dienst | Preis | Bewertung |
|---|---|---|
| **Creatomate** | ab 41 $/Mon (~1.000 Renders) | bestes Preis/Leistung für Massen-Shorts, JSON-Templates, Untertitel |
| Shotstack | ab 49 $/Mon | sehr stabil, gute Doku, etwas teurer |
| json2video | ab 20 $/Mon | günstigste Option, kleinere Feature-Auswahl |

**Transkription/Untertitel:** Deepgram (0,0043 $/Min) oder das bereits eingebaute Lovable-AI-Whisper — für den Start reicht das Eingebaute.

Empfehlung: **Supadata + Creatomate** — damit laufen 100 Clips pro YouTube-Link zuverlässig serverseitig durch, ohne Browser-Rendering.

## Reihenfolge der Umsetzung

1. Profil-Ebene + Migration bestehender Brands in ein Standard-Profil
2. Profil-Switcher & Profil-Dashboard (Earnings-Summary, Payout-Anbieter)
3. Affiliate-Programme + Verknüpfung mit Clips/Slots
4. Multi-Brand-Slots, Clip-Duplizierung, Upload-Shuffle
5. Anschluss von Supadata + Creatomate, sobald du die Keys hast

## Technisches

Neue Tabellen mit RLS auf `auth.uid()`; `workspace_id` wird an brands, publish_schedules, generated_clips durchgereicht. Shuffle deterministisch pro (Brand, Tag), damit Reihenfolge reproduzierbar bleibt. Earnings-Berechnung läuft im bestehenden `sync-analytics`-Hook mit.
