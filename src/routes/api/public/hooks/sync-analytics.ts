import { createFileRoute } from "@tanstack/react-router";

// Public webhook hit by pg_cron every 30 minutes.
// Because the major social platforms (TikTok/IG/YT/FB/X) all require reviewed
// developer apps for analytics access, we simulate a realistic metrics snapshot
// per connected social account and cache it. When real OAuth is wired up per
// brand, the fetch logic per platform gets swapped in here.
export const Route = createFileRoute("/api/public/hooks/sync-analytics")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: accounts, error } = await supabaseAdmin
          .from("social_accounts")
          .select("id, user_id, brand_id, platform, status")
          .neq("status", "disconnected");
        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
        }

        let synced = 0;
        for (const acc of (accounts ?? []).filter((a) => a.brand_id)) {
          try {
            const metrics = mockMetrics();
            await supabaseAdmin.from("analytics_snapshots").insert({
              user_id: acc.user_id,
              brand_id: acc.brand_id!,
              social_account_id: acc.id,
              platform: String(acc.platform ?? "unknown"),
              metrics,
            });
            await supabaseAdmin
              .from("social_accounts")
              .update({ status: "connected", last_sync_at: new Date().toISOString(), sync_error: null })
              .eq("id", acc.id);
            synced++;
          } catch (e) {
            await supabaseAdmin
              .from("social_accounts")
              .update({ status: "error", sync_error: e instanceof Error ? e.message : "sync failed" })
              .eq("id", acc.id);
          }
        }

        return new Response(JSON.stringify({ ok: true, synced }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

function mockMetrics() {
  const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min) + min);
  return {
    views: rand(500, 25000),
    likes: rand(20, 3000),
    comments: rand(0, 400),
    shares: rand(0, 300),
    avg_watch_pct: rand(30, 85),
    drop_off_pct: rand(10, 60),
  };
}
