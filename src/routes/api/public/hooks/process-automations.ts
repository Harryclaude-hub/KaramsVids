import { createFileRoute } from "@tanstack/react-router";

// pg_cron ruft das alle 5 Minuten: neue Kommentare der verbundenen
// Accounts abholen und nach den Regeln in automation_rules beantworten.

export const Route = createFileRoute("/api/public/hooks/process-automations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireHookSecret } = await import("@/lib/hook-auth.server");
        const denied = requireHookSecret(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: rules, error } = await supabaseAdmin
          .from("automation_rules")
          .select("*")
          .eq("active", true);
        if (error) return json({ ok: false, error: error.message }, 500);
        if (!rules || rules.length === 0)
          return json({ ok: true, sent: 0, note: "keine aktiven Regeln" });

        const { runAutomationsForAccount } = await import("@/lib/social-automation.server");
        let sent = 0;
        const errors: string[] = [];

        const byBrand = new Map<string, typeof rules>();
        for (const r of rules) {
          const list = byBrand.get(r.brand_id) ?? [];
          list.push(r);
          byBrand.set(r.brand_id, list);
        }

        for (const [brandId, brandRules] of byBrand) {
          const { data: brand } = await supabaseAdmin
            .from("brands")
            .select("name")
            .eq("id", brandId)
            .maybeSingle();

          const platforms = [...new Set(brandRules.map((r) => r.platform))];
          for (const platform of platforms) {
            const { data: acc } = await supabaseAdmin
              .from("social_accounts")
              .select(
                "id,brand_id,platform,access_token_encrypted,refresh_token_encrypted,expires_at,meta",
              )
              .eq("brand_id", brandId)
              .eq("platform", platform as never)
              .neq("status", "disconnected")
              .maybeSingle();
            if (!acc) continue;
            try {
              const res = await runAutomationsForAccount(
                supabaseAdmin,
                acc,
                brand?.name ?? "",
                brandRules.filter((r) => r.platform === platform) as never,
              );
              sent += res.sent;
              errors.push(...res.errors);
            } catch (e) {
              errors.push(e instanceof Error ? e.message : String(e));
            }
          }
        }

        return json({ ok: true, sent, errors: errors.slice(0, 20) });
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
