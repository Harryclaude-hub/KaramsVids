import { createFileRoute } from "@tanstack/react-router";

// Holt die echten Kennzahlen jedes verbundenen Accounts von der jeweiligen
// Plattform: Follower und Gesamtwerte als Snapshot, dazu die Zahlen der
// letzten Beitraege in post_metrics.
//
// Aufruf per pg_cron, empfohlen alle 30 bis 60 Minuten.
//   POST /api/public/hooks/sync-analytics
//   optional ?accountId=<uuid> → nur ein Account
//
// Frueher standen hier Zufallszahlen. Wenn eine Plattform einen Wert nicht
// herausgibt, bleibt er jetzt 0, statt eine Zahl zu erfinden.

export const Route = createFileRoute("/api/public/hooks/sync-analytics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronSecret } = await import("@/lib/hook-auth.server");
        const denied = checkCronSecret(request);
        if (denied) return denied;

        const onlyAccount = new URL(request.url).searchParams.get("accountId");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { fetchMetrics } = await import("@/lib/social-metrics.server");

        let query = supabaseAdmin
          .from("social_accounts")
          .select(
            "id, user_id, brand_id, platform, external_id, handle, access_token_encrypted, refresh_token_encrypted, expires_at, meta",
          )
          .neq("status", "disconnected");
        if (onlyAccount) query = query.eq("id", onlyAccount);

        const { data: accounts, error } = await query;
        if (error) return json({ ok: false, error: error.message }, 500);

        let synced = 0;
        let postsWritten = 0;
        const problems: Array<{ account: string; error: string }> = [];

        for (const acc of accounts ?? []) {
          try {
            const { account: metrics, posts } = await fetchMetrics(supabaseAdmin, acc as never);

            await supabaseAdmin.from("analytics_snapshots").insert({
              user_id: acc.user_id,
              brand_id: acc.brand_id!,
              social_account_id: acc.id,
              platform: String(acc.platform),
              metrics: metrics as never,
              source: "live",
            });

            if (posts.length) {
              const rows = posts.map((p) => ({
                user_id: acc.user_id,
                brand_id: acc.brand_id,
                social_account_id: acc.id,
                platform: String(acc.platform),
                external_post_id: p.externalPostId,
                post_url: p.postUrl,
                title: p.title,
                published_at: p.publishedAt,
                views: p.views,
                likes: p.likes,
                comments: p.comments,
                shares: p.shares,
                saves: p.saves,
                reach: p.reach,
                fetched_at: new Date().toISOString(),
              }));
              const { error: upErr } = await supabaseAdmin
                .from("post_metrics")
                .upsert(rows, { onConflict: "social_account_id,external_post_id" });
              if (!upErr) postsWritten += rows.length;
            }

            await supabaseAdmin
              .from("social_accounts")
              .update({
                status: "connected",
                follower_count: metrics.followers,
                last_sync_at: new Date().toISOString(),
                sync_error: null,
              })
              .eq("id", acc.id);
            synced++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Abruf fehlgeschlagen";
            problems.push({ account: acc.handle ?? acc.id, error: msg });
            await supabaseAdmin
              .from("social_accounts")
              .update({ status: "error", sync_error: msg })
              .eq("id", acc.id);
          }
        }

        return json({ ok: true, synced, posts: postsWritten, problems: problems.slice(0, 20) });
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
