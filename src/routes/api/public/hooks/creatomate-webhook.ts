import { createFileRoute } from "@tanstack/react-router";

// Öffentlicher Callback von Creatomate: meldet fertige/fehlgeschlagene
// Renders sofort zurück, damit das UI nicht mehr dauerhaft pollen muss.
// Absicherung über das Secret CREATOMATE_WEBHOOK_SECRET im Query-Parameter
// (Creatomate unterstützt keine eigenen Header auf Webhooks).
export const Route = createFileRoute("/api/public/hooks/creatomate-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CREATOMATE_WEBHOOK_SECRET;
        const token = new URL(request.url).searchParams.get("token");
        if (!secret || !token || token !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        const renderId: string | undefined = payload?.id;
        const metadata: string | undefined = payload?.metadata;
        if (!renderId && !metadata) {
          return new Response(JSON.stringify({ ok: false, error: "no id" }), { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { finalizeRender } = await import("@/lib/bulk-render.server");

        let q = supabaseAdmin.from("render_jobs").select("*").limit(1);
        q = metadata ? q.eq("id", metadata) : q.eq("provider_render_id", renderId!);
        const { data: rows } = await q;
        const row = rows?.[0];
        if (!row) {
          return new Response(JSON.stringify({ ok: true, ignored: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const result = await finalizeRender(
            supabaseAdmin,
            row,
            {
              id: renderId ?? row.provider_render_id ?? "",
              status: payload?.status ?? "succeeded",
              url: payload?.url,
              snapshot_url: payload?.snapshot_url,
              error_message: payload?.error_message,
            },
            "webhook",
          );
          return new Response(JSON.stringify({ ok: true, result }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          await supabaseAdmin
            .from("render_jobs")
            .update({ error: e instanceof Error ? e.message : "Webhook-Fehler" })
            .eq("id", row.id);
          return new Response(JSON.stringify({ ok: false }), { status: 500 });
        }
      },
    },
  },
});
