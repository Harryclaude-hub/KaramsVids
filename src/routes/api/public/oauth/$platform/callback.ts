import { createFileRoute } from "@tanstack/react-router";

// OAuth-Rückkanal der Plattformen. Liegt unter /api/public/, weil der
// Provider ohne Session zurückspringt — Absicherung über den signierten State.
//
// Ein Durchlauf kann mehrere Kanäle freischalten (bei Meta jede Seite und
// jeden verknüpften Instagram-Account, bei Google jeden YouTube-Kanal).
// Jeder davon wird zu einem eigenen Eintrag in social_accounts.

export const Route = createFileRoute("/api/public/oauth/$platform/callback")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const providerError =
          url.searchParams.get("error_description") ?? url.searchParams.get("error");

        const { verifyState, exchangeCode, resolveAccounts, encryptToken, PLATFORMS } =
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
          const channels = await resolveAccounts(platform, tokens);
          if (channels.length === 0)
            throw new Error("Keine Kanäle gefunden, die verbunden werden können");

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const labels: string[] = [];
          for (const ch of channels) {
            const row = {
              user_id: st.u,
              brand_id: st.b,
              platform,
              external_id: ch.externalId || null,
              handle: ch.handle,
              display_name: ch.displayName,
              avatar_url: ch.avatarUrl,
              status: "connected",
              sync_error: null,
              access_token_encrypted: encryptToken(ch.accessToken),
              refresh_token_encrypted: ch.refreshToken ? encryptToken(ch.refreshToken) : null,
              expires_at: ch.expiresAt ?? null,
              meta: ch.meta as never,
            };

            // Denselben Kanal nicht doppelt anlegen, aber Tokens auffrischen.
            const { data: existing } = await supabaseAdmin
              .from("social_accounts")
              .select("id")
              .eq("user_id", st.u)
              .eq("brand_id", st.b)
              .eq("platform", platform)
              .eq("external_id", ch.externalId || "")
              .maybeSingle();

            const { error } = existing
              ? await supabaseAdmin.from("social_accounts").update(row).eq("id", existing.id)
              : await supabaseAdmin.from("social_accounts").insert(row);
            if (error) throw new Error(error.message);

            labels.push(ch.handle ?? ch.displayName ?? "Kanal");
          }

          const msg =
            labels.length === 1
              ? labels[0]
              : `${labels.length} Kanäle verbunden: ${labels.slice(0, 4).join(", ")}`;
          return done(true, msg, st.o);
        } catch (e) {
          return done(false, e instanceof Error ? e.message : "Verbindung fehlgeschlagen");
        }
      },
    },
  },
});
