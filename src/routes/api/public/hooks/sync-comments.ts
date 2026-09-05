import { createFileRoute } from "@tanstack/react-router";

// Holt neue Kommentare aller verbundenen Accounts in den Posteingang und
// beantwortet sie nach den hinterlegten Regeln.
//
// Aufruf per pg_cron, empfohlen alle 15 Minuten.
//   POST /api/public/hooks/sync-comments
//   optional ?accountId=<uuid>  → nur ein Account
//   optional ?dryRun=1          → nur einsammeln, nicht antworten
//
// Die eigentliche Arbeit steckt in runCommentSync, damit der Knopf in der App
// und der Zeitplan garantiert dasselbe tun.

export const Route = createFileRoute("/api/public/hooks/sync-comments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronSecret } = await import("@/lib/hook-auth.server");
        const denied = checkCronSecret(request);
        if (denied) return denied;

        const url = new URL(request.url);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runCommentSync } = await import("@/lib/comment-sync.server");

        try {
          const result = await runCommentSync(supabaseAdmin, {
            accountId: url.searchParams.get("accountId"),
            dryRun: url.searchParams.get("dryRun") === "1",
          });
          return json({ ok: true, ...result, problems: result.problems.slice(0, 20) });
        } catch (e) {
          return json(
            { ok: false, error: e instanceof Error ? e.message : "Sync fehlgeschlagen" },
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
