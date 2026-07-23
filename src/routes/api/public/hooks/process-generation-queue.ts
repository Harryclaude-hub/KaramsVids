import { createFileRoute } from "@tanstack/react-router";

// pg_cron kann das regelmäßig aufrufen (wie process-publish-queue):
// verarbeitet offene Generierungs-Jobs ALLER Nutzer mit Service-Role.
// Bis der Cron eingerichtet ist, stößt die UI die Verarbeitung selbst an.

export const Route = createFileRoute("/api/public/hooks/process-generation-queue")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { processJobs, providerStatus } = await import("@/lib/generation-core.server");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: jobs, error } = await (supabaseAdmin as any)
          .from("generation_jobs")
          .select("*")
          .in("status", ["pending", "waiting_provider", "running"])
          .order("created_at", { ascending: true })
          .limit(25);
        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results = await processJobs(supabaseAdmin, jobs ?? []);
        return new Response(
          JSON.stringify({
            ok: true,
            processed: results.length,
            results,
            providers: providerStatus(),
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
