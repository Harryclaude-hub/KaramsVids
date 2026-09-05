import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Serverfunktionen für den Kommentar-Posteingang und die Regeln.
// Alles läuft über die angemeldete Sitzung, RLS schützt zusätzlich.
// ============================================================

const PLATFORMS = ["tiktok", "youtube", "instagram", "facebook", "x"] as const;

/** Kommentare jetzt abholen und nach Regeln beantworten. */
export const syncCommentsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runCommentSync } = await import("@/lib/comment-sync.server");

    // Fremde Accounts sind ausgeschlossen: der Sync läuft nur über Accounts,
    // die dem angemeldeten Nutzer gehören.
    return runCommentSync(supabaseAdmin, {
      accountId: data.accountId ?? null,
      userId: context.userId,
    });
  });

/** Auto-Antworten für einen Account ein- oder ausschalten. */
export const setAutoReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("social_accounts")
      .update({ auto_reply_enabled: data.enabled })
      .eq("id", data.accountId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Von Hand auf einen Kommentar antworten. */
export const replyManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ commentId: z.string().uuid(), text: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { replyToComment } = await import("@/lib/social-comments.server");

    const { data: comment, error } = await context.supabase
      .from("social_comments")
      .select("id, external_comment_id, social_account_id, status")
      .eq("id", data.commentId)
      .eq("user_id", context.userId)
      .single();
    if (error || !comment) throw new Error("Kommentar nicht gefunden");
    if (comment.status === "replied")
      throw new Error("Auf diesen Kommentar wurde bereits geantwortet");

    const { data: account, error: accErr } = await supabaseAdmin
      .from("social_accounts")
      .select(
        "id, user_id, brand_id, platform, external_id, handle, access_token_encrypted, refresh_token_encrypted, expires_at, meta",
      )
      .eq("id", comment.social_account_id)
      .eq("user_id", context.userId)
      .single();
    if (accErr || !account) throw new Error("Account nicht gefunden");

    try {
      await replyToComment(supabaseAdmin, account as never, comment.external_comment_id, data.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Antwort fehlgeschlagen";
      await context.supabase
        .from("social_comments")
        .update({ status: "failed", error: msg })
        .eq("id", comment.id);
      throw new Error(msg);
    }

    await context.supabase
      .from("social_comments")
      .update({
        status: "replied",
        reply_text: data.text,
        reply_mode: "manual",
        replied_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", comment.id);
    return { ok: true };
  });

/** Einen Kommentar ohne Antwort abhaken. */
export const skipComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ commentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("social_comments")
      .update({ status: "skipped" })
      .eq("id", data.commentId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const RuleInput = z.object({
  id: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable(),
  platform: z.enum(PLATFORMS).nullable(),
  socialAccountId: z.string().uuid().nullable(),
  name: z.string().min(1).max(80),
  mode: z.enum(["template", "ai"]),
  keywords: z.array(z.string().max(60)).max(30),
  excludeKeywords: z.array(z.string().max(60)).max(30),
  messageTemplate: z.string().max(1000).nullable(),
  aiInstruction: z.string().max(2000).nullable(),
  aiTone: z.string().max(40),
  maxLength: z.number().int().min(20).max(1000),
  dailyLimit: z.number().int().min(1).max(500),
  delayMinutes: z.number().int().min(0).max(1440),
  priority: z.number().int().min(0).max(100),
  active: z.boolean(),
});

/** Regel anlegen oder ändern. */
export const saveReplyRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RuleInput.parse(input))
  .handler(async ({ data, context }) => {
    if (data.mode === "template" && !data.messageTemplate?.trim())
      throw new Error("Eine Vorlagen-Regel braucht einen Antworttext");
    if (data.mode === "ai" && !data.aiInstruction?.trim())
      throw new Error("Eine KI-Regel braucht eine Anweisung");

    const row = {
      user_id: context.userId,
      brand_id: data.brandId,
      platform: data.platform,
      social_account_id: data.socialAccountId,
      name: data.name,
      mode: data.mode,
      keywords: data.keywords.filter(Boolean),
      exclude_keywords: data.excludeKeywords.filter(Boolean),
      message_template: data.messageTemplate,
      ai_instruction: data.aiInstruction,
      ai_tone: data.aiTone,
      max_length: data.maxLength,
      daily_limit: data.dailyLimit,
      delay_minutes: data.delayMinutes,
      priority: data.priority,
      active: data.active,
    };

    const q = data.id
      ? context.supabase
          .from("comment_reply_rules")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", context.userId)
      : context.supabase.from("comment_reply_rules").insert(row);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteReplyRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("comment_reply_rules")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Zeigt, was die KI auf einen Beispielkommentar antworten würde. */
export const previewAiReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        commentText: z.string().min(1).max(2000),
        aiInstruction: z.string().min(1).max(2000),
        aiTone: z.string().max(40).default("freundlich"),
        maxLength: z.number().int().min(20).max(1000).default(220),
        brandName: z.string().max(80).nullable().optional(),
        authorName: z.string().max(80).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { generateAiReply } = await import("@/lib/social-comments.server");
    const text = await generateAiReply(
      {
        id: "preview",
        user_id: "preview",
        brand_id: null,
        platform: null,
        social_account_id: null,
        name: "Vorschau",
        mode: "ai",
        keywords: [],
        exclude_keywords: [],
        message_template: null,
        ai_instruction: data.aiInstruction,
        ai_tone: data.aiTone,
        max_length: data.maxLength,
        daily_limit: 1,
        delay_minutes: 0,
        priority: 0,
        active: true,
      },
      {
        externalCommentId: "preview",
        externalPostId: null,
        postUrl: null,
        authorHandle: data.authorName ?? null,
        authorName: data.authorName ?? "Zuschauer",
        text: data.commentText,
        likeCount: 0,
        postedAt: new Date().toISOString(),
      },
      data.brandName ?? null,
    );
    return { text };
  });

/** Kennzahlen für einen Account sofort neu holen. */
export const syncMetricsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchMetrics } = await import("@/lib/social-metrics.server");

    let q = supabaseAdmin
      .from("social_accounts")
      .select(
        "id, user_id, brand_id, platform, external_id, handle, access_token_encrypted, refresh_token_encrypted, expires_at, meta",
      )
      .eq("user_id", context.userId)
      .neq("status", "disconnected");
    if (data.accountId) q = q.eq("id", data.accountId);

    const { data: accounts, error } = await q;
    if (error) throw new Error(error.message);

    let synced = 0;
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
          await supabaseAdmin.from("post_metrics").upsert(
            posts.map((p) => ({
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
            })),
            { onConflict: "social_account_id,external_post_id" },
          );
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
    return { synced, problems };
  });
