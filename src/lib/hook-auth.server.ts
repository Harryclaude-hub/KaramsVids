// ============================================================
// Zugriffsschutz für die Cron-/Webhook-Endpunkte unter
// /api/public/hooks/* (nur Server).
//
// Diese Endpunkte arbeiten mit der Service-Role und umgehen damit
// RLS: sie posten in fremde Accounts, starten kostenpflichtige
// KI-Jobs und verschicken Automations-Nachrichten. Ohne Schutz
// kann sie jeder auslösen, der die URL kennt.
//
// Secret setzen:
//   CRON_SECRET = langer Zufallsstring (z. B. `openssl rand -hex 32`)
//
// Aufruf durch pg_cron / einen externen Scheduler:
//   POST /api/public/hooks/<name>
//   Header: Authorization: Bearer <CRON_SECRET>
//   (alternativ: X-Cron-Secret: <CRON_SECRET> oder ?token=<CRON_SECRET>)
// ============================================================

import { timingSafeEqual } from "node:crypto";

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Liest das mitgeschickte Secret aus Header oder Query-Parameter. */
function presentedSecret(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (bearer) return bearer;
  }
  const header = request.headers.get("x-cron-secret");
  if (header?.trim()) return header.trim();

  try {
    const token = new URL(request.url).searchParams.get("token");
    if (token?.trim()) return token.trim();
  } catch {
    /* ungültige URL — dann eben kein Token */
  }
  return null;
}

/**
 * Prüft den Aufruf eines Hook-Endpunkts.
 *
 * Gibt `null` zurück, wenn der Aufruf berechtigt ist, sonst eine
 * fertige Fehler-Response, die der Handler direkt zurückgeben soll.
 *
 * Bewusst „fail closed": Ist CRON_SECRET nicht gesetzt, wird der
 * Endpunkt komplett gesperrt statt offen zu stehen.
 */
export function requireHookSecret(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return json(
      {
        ok: false,
        error:
          "CRON_SECRET ist nicht gesetzt — dieser Endpunkt ist deshalb gesperrt. " +
          "Secret in den Server-Umgebungsvariablen hinterlegen und beim Aufruf als " +
          "'Authorization: Bearer <CRON_SECRET>' mitschicken.",
      },
      503,
    );
  }

  const presented = presentedSecret(request);
  if (!presented || !safeEquals(presented, expected)) {
    return json({ ok: false, error: "Nicht autorisiert" }, 401);
  }
  return null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
