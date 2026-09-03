import { createFileRoute } from "@tanstack/react-router";

// pg_cron ruft das alle 5 Minuten für ALLE Nutzer auf.
// Geschützt über CRON_SECRET (siehe src/lib/hook-auth.server.ts) —
// der Endpunkt arbeitet mit der Service-Role und umgeht damit RLS.
//
// Die eigentliche Logik liegt in src/lib/publish-queue.server.ts und
// wird von der UI ("Jetzt ausführen") nutzergebunden aufgerufen.

export const Route = createFileRoute("/api/public/hooks/process-publish-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireHookSecret } = await import("@/lib/hook-auth.server");
        const denied = requireHookSecret(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { processPublishQueue } = await import("@/lib/publish-queue.server");

        try {
          const result = await processPublishQueue(supabaseAdmin, new Date());
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
