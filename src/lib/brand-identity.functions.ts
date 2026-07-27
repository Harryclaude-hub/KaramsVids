import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CheckInput = z.object({
  handle: z.string().min(1).max(40),
  platforms: z.array(z.enum(["instagram", "tiktok", "youtube", "facebook", "x"])).min(1),
});

/** Prüft, ob ein Username auf den Plattformen noch frei ist. */
export const checkBrandHandle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CheckInput.parse(i))
  .handler(async ({ data }) => {
    const { checkHandle, sanitizeHandle } = await import("@/lib/brand-identity.server");
    return {
      handle: sanitizeHandle(data.handle),
      results: await checkHandle(data.handle, data.platforms),
    };
  });

const SaveInput = z.object({
  brandId: z.string().uuid(),
  platform: z.enum(["instagram", "tiktok", "youtube", "facebook", "x"]),
  username: z.string().max(120).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  password: z.string().max(300).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/** Speichert Account-Zugangsdaten eines Brands (Passwort AES-verschlüsselt). */
export const saveBrandCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveInput.parse(i))
  .handler(async ({ data, context }) => {
    const { encryptPassword, LOGIN_URL } = await import("@/lib/brand-identity.server");
    const patch: Record<string, unknown> = {
      user_id: context.userId,
      brand_id: data.brandId,
      platform: data.platform,
      username: data.username ?? null,
      email: data.email ?? null,
      notes: data.notes ?? null,
      login_url: LOGIN_URL[data.platform] ?? null,
      updated_at: new Date().toISOString(),
    };
    if (data.password) patch.password_encrypted = encryptPassword(data.password);

    const { data: existing } = await context.supabase
      .from("brand_credentials")
      .select("id")
      .eq("brand_id", data.brandId)
      .eq("platform", data.platform)
      .maybeSingle();

    const q = existing
      ? context.supabase.from("brand_credentials").update(patch as never).eq("id", existing.id)
      : context.supabase.from("brand_credentials").insert(patch as never);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const RevealInput = z.object({ credentialId: z.string().uuid() });

/** Zeigt das Passwort einmalig im Klartext (nur für den Besitzer). */
export const revealBrandCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RevealInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("brand_credentials")
      .select("password_encrypted")
      .eq("id", data.credentialId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.password_encrypted) return { password: null };
    const { decryptPassword } = await import("@/lib/brand-identity.server");
    return { password: decryptPassword(row.password_encrypted) };
  });
