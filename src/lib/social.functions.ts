import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Welche Plattformen haben hinterlegte App-Keys? (für die Connections-Seite) */
export const getSocialPlatformStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { platformStatus } = await import("@/lib/social-oauth.server");
    return platformStatus();
  });

const StartInput = z.object({
  platform: z.enum(["tiktok", "youtube", "instagram", "facebook", "x"]),
  brandId: z.string().uuid(),
  origin: z.string().url(),
});

/** Liefert die Authorize-URL für den OAuth-Flow (Nutzer wird dorthin geschickt). */
export const startSocialConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StartInput.parse(input))
  .handler(async ({ data, context }) => {
    const { buildAuthorizeUrl } = await import("@/lib/social-oauth.server");
    const origin = data.origin.replace(/\/$/, "");
    const url = buildAuthorizeUrl({
      platform: data.platform,
      origin,
      userId: context.userId,
      brandId: data.brandId,
    });
    return { url, redirectUri: `${origin}/api/public/oauth/${data.platform}/callback` };
  });

const DisconnectInput = z.object({ accountId: z.string().uuid() });

export const disconnectSocialAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DisconnectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("social_accounts")
      .update({
        status: "disconnected",
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        expires_at: null,
      })
      .eq("id", data.accountId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
