import { createFileRoute } from "@tanstack/react-router";

// Holt neue Direktnachrichten aller verbundenen Instagram- und Facebook-
// Kanäle in den Posteingang und beantwortet sie nach den hinterlegten Regeln
// (channel "dm" oder "both").
//
// Aufruf per pg_cron, empfohlen alle 10 Minuten, weil Meta nur 24 Stunden
// Zeit für eine Antwort lässt.
//   POST /api/public/hooks/sync-dms
//   optional ?accountId=<uuid>  → nur ein Account
//   optional ?dryRun=1          → nur einsammeln, nicht antworten
//
// Die eigentliche Arbeit steckt in runDmSync, damit der Knopf in der App
// und der Zeitplan garantiert dasselbe tun.

export const Route = createFileRoute("/api/public/hooks/sync-dms")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronSecret } = await import("@/lib/hook-auth.server");
        const denied = checkCronSecret(request);
        if (denied) return denied;

        const url = new URL(request.url);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runDmSync } = await import("@/lib/dm-sync.server");

        try {
          const result = await runDmSync(supabaseAdmin, {
            accountId: url.searchParams.get("accountId"),
            dryRun: url.searchParams.get("dryRun") === "1",
          });
          return json({ ok: true, ...result, problems: result.problems.slice(0, 20) });
        } catch (e) {
          return json(
            { ok: false, error: e instanceof Error ? e.message : "DM-Sync fehlgeschlagen" },
            500,
          );
        }
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
