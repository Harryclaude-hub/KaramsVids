import { createFileRoute } from "@tanstack/react-router";

// pg_cron ruft das alle 30 Minuten für ALLE Nutzer auf.
// Geschützt über CRON_SECRET (siehe src/lib/hook-auth.server.ts) —
// der Endpunkt arbeitet mit der Service-Role und umgeht damit RLS.
//
// Die Logik liegt in src/lib/analytics-sync.server.ts. Wichtig: Die
// Metriken sind derzeit simuliert, siehe Kommentar dort.

export const Route = createFileRoute("/api/public/hooks/sync-analytics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireHookSecret } = await import("@/lib/hook-auth.server");
        const denied = requireHookSecret(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncAnalytics } = await import("@/lib/analytics-sync.server");

        try {
          const result = await syncAnalytics(supabaseAdmin);
          return json({ ok: true, ...result });
        } catch (e) {
          return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
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
