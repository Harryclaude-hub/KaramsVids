// ============================================================
// Schutz für die Cron-Endpunkte unter /api/public/hooks/*.
//
// Die Endpunkte liegen im oeffentlichen Bereich, weil pg_cron ohne
// Nutzersitzung anklopft. Ohne Schluessel koennte sie jeder ausloesen und
// damit Uploads, KI-Aufrufe und API-Kontingente verbrennen.
//
// Ist CRON_SECRET gesetzt, muss der Aufruf ihn mitschicken:
//   Header  Authorization: Bearer <CRON_SECRET>
//   Header  x-cron-secret: <CRON_SECRET>
//   oder    ?secret=<CRON_SECRET>
//
// Ist CRON_SECRET nicht gesetzt, bleibt alles wie bisher offen. So bricht
// kein bestehender Zeitplan, sobald diese Version ausgerollt wird.
// ============================================================

import { timingSafeEqual } from "node:crypto";

function sameSecret(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Gibt null zurück, wenn der Aufruf in Ordnung ist, sonst die Fehlerantwort. */
export function checkCronSecret(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) return null;

  const url = new URL(request.url);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  const query = url.searchParams.get("secret") ?? "";

  const ok = [bearer, header, query].some((v) => v && sameSecret(v, expected));
  if (ok) return null;

  return new Response(JSON.stringify({ ok: false, error: "Nicht autorisiert" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
