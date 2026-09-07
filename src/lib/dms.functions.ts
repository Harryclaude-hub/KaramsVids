import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Serverfunktionen für den DM-Posteingang (Direktnachrichten).
// Gleiches Muster wie comments.functions.ts: alles läuft über die
// angemeldete Sitzung, RLS schützt zusätzlich. Die Regeln selbst werden
// weiterhin über saveReplyRule / deleteReplyRule in comments.functions.ts
// gepflegt, dort mit channel "dm" oder "both".
// ============================================================

const ACCOUNT_FIELDS =
  "id, user_id, brand_id, platform, external_id, handle, display_name, " +
  "access_token_encrypted, refresh_token_encrypted, expires_at, meta";

/** Direktnachrichten jetzt abholen und nach Regeln beantworten. */
export const syncDmsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runDmSync } = await import("@/lib/dm-sync.server");

    // Fremde Accounts sind ausgeschlossen: der Sync läuft nur über Accounts,
    // die dem angemeldeten Nutzer gehören.
    return runDmSync(supabaseAdmin, {
      accountId: data.accountId ?? null,
      userId: context.userId,
    });
  });

/** Auto-Antworten auf DMs für einen Account ein- oder ausschalten. */
export const setAutoReplyDms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("social_accounts")
      .update({ auto_reply_dms_enabled: data.enabled })
      .eq("id", data.accountId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Von Hand auf eine Direktnachricht antworten.
 * Die Antwort geht an den Absender der Nachricht; das 24-Stunden-Fenster von
 * Meta wird in sendDm anhand der letzten Nachricht dieser Person geprüft.
 */
export const replyDmManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    // 1000 Zeichen ist das Limit von Instagram, Messenger erlaubt 2000.
    // Die Oberfläche bleibt beim kleineren Wert, dann passt es überall.
    z.object({ dmId: z.string().uuid(), text: z.string().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendDm } = await import("@/lib/social-dms.server");

    const { data: dm, error } = await context.supabase
      .from("social_dms")
      .select("id, sender_id, social_account_id, status")
      .eq("id", data.dmId)
      .eq("user_id", context.userId)
      .single();
    if (error || !dm) throw new Error("Nachricht nicht gefunden");
    if (dm.status === "replied") throw new Error("Auf diese Nachricht wurde bereits geantwortet");

    const { data: account, error: accErr } = await supabaseAdmin
      .from("social_accounts")
      .select(ACCOUNT_FIELDS)
      .eq("id", dm.social_account_id)
      .eq("user_id", context.userId)
      .single();
    if (accErr || !account) throw new Error("Account nicht gefunden");

    try {
      await sendDm(supabaseAdmin, account as never, dm.sender_id, data.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Antwort fehlgeschlagen";
      await context.supabase
        .from("social_dms")
        .update({ status: "failed", error: msg })
        .eq("id", dm.id);
      throw new Error(msg);
    }

    await context.supabase
      .from("social_dms")
      .update({
        status: "replied",
        reply_text: data.text,
        reply_mode: "manual",
        replied_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", dm.id);
    return { ok: true };
  });

/** Eine Direktnachricht ohne Antwort abhaken. */
export const skipDm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ dmId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("social_dms")
      .update({ status: "skipped" })
      .eq("id", data.dmId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
