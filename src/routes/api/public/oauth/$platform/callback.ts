import { createFileRoute } from "@tanstack/react-router";

// OAuth-Rückkanal der Plattformen. Liegt unter /api/public/, weil der
// Provider ohne Session zurückspringt — Absicherung über den signierten State.

export const Route = createFileRoute("/api/public/oauth/$platform/callback")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const providerError =
          url.searchParams.get("error_description") ?? url.searchParams.get("error");

        const { verifyState, exchangeCode, fetchHandle, encryptToken, PLATFORMS } =
          await import("@/lib/social-oauth.server");

        const platform = params.platform as (typeof PLATFORMS)[number];
        const done = (ok: boolean, msg: string, origin?: string) =>
          Response.redirect(
            `${origin ?? url.origin}/app/connections?${new URLSearchParams({
              [ok ? "connected" : "error"]: msg,
              platform,
            })}`,
            302,
          );

        if (!PLATFORMS.includes(platform)) return done(false, "Unbekannte Plattform");
        if (providerError) return done(false, providerError);
        if (!code || !state) return done(false, "Kein Autorisierungscode erhalten");

        try {
          const st = verifyState(state);
          if (st.p !== platform) throw new Error("State passt nicht zur Plattform");

          const tokens = await exchangeCode(platform, code, st.o, st.v);
          const handle = await fetchHandle(platform, tokens);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: existing } = await supabaseAdmin
            .from("social_accounts")
            .select("id")
            .eq("user_id", st.u)
            .eq("brand_id", st.b)
            .eq("platform", platform)
            .maybeSingle();

          const row = {
            user_id: st.u,
            brand_id: st.b,
            platform,
            handle,
            status: "connected",
            sync_error: null,
            access_token_encrypted: encryptToken(tokens.accessToken),
            refresh_token_encrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
            expires_at: tokens.expiresAt ?? null,
            meta: (tokens.meta ?? {}) as never,
          };

          const { error } = existing
            ? await supabaseAdmin.from("social_accounts").update(row).eq("id", existing.id)
            : await supabaseAdmin.from("social_accounts").insert(row);
          if (error) throw new Error(error.message);

          return done(true, handle ?? "Account verbunden", st.o);
        } catch (e) {
          return done(false, e instanceof Error ? e.message : "Verbindung fehlgeschlagen");
        }
      },
    },
  },
});
