// ============================================================
// Der eigentliche Kommentar-Durchlauf: einsammeln, Regel suchen, antworten.
// Wird sowohl vom Cron-Hook als auch vom Knopf in der App verwendet, damit
// beide Wege garantiert dasselbe tun.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { fetchComments, matchRule, buildReply, replyToComment } from "./social-comments.server";

export type SyncOptions = {
  /** Nur diesen Account abarbeiten. */
  accountId?: string | null;
  /** Nur diesem Nutzer gehoerende Accounts (fuer Aufrufe aus der App). */
  userId?: string | null;
  /** Kommentare einsammeln, aber nichts beantworten. */
  dryRun?: boolean;
};

export type SyncResult = {
  accounts: number;
  fetched: number;
  new: number;
  replied: number;
  problems: Array<{ account: string; error: string }>;
};

const ACCOUNT_FIELDS =
  "id, user_id, brand_id, platform, external_id, handle, display_name, auto_reply_enabled, " +
  "access_token_encrypted, refresh_token_encrypted, expires_at, meta";

export async function runCommentSync(
  supabaseAdmin: any,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  let query = supabaseAdmin
    .from("social_accounts")
    .select(ACCOUNT_FIELDS)
    .eq("status", "connected");
  if (opts.accountId) query = query.eq("id", opts.accountId);
  if (opts.userId) query = query.eq("user_id", opts.userId);

  const { data: accounts, error } = await query;
  if (error) throw new Error(error.message);

  const userIds = [...new Set((accounts ?? []).map((a: any) => a.user_id))];
  const { data: allRules } = await supabaseAdmin
    .from("comment_reply_rules")
    .select("*")
    .eq("active", true)
    .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

  const { data: brands } = await supabaseAdmin.from("brands").select("id, name");
  const brandName = new Map<string, string>(
    (brands ?? []).map((b: any) => [String(b.id), String(b.name)]),
  );

  // Tageszaehler je Regel, damit das Limit ueber alle Accounts hinweg gilt.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: todaysReplies } = await supabaseAdmin
    .from("social_comments")
    .select("rule_id")
    .eq("status", "replied")
    .gte("replied_at", since);
  const usedToday = new Map<string, number>();
  for (const r of todaysReplies ?? []) {
    if (r.rule_id) usedToday.set(r.rule_id, (usedToday.get(r.rule_id) ?? 0) + 1);
  }

  const result: SyncResult = {
    accounts: (accounts ?? []).length,
    fetched: 0,
    new: 0,
    replied: 0,
    problems: [],
  };

  for (const acc of accounts ?? []) {
    let inbound;
    try {
      inbound = await fetchComments(supabaseAdmin, acc);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kommentar-Abruf fehlgeschlagen";
      result.problems.push({ account: acc.handle ?? acc.id, error: msg });
      await supabaseAdmin
        .from("social_accounts")
        .update({ sync_error: msg, last_comment_sync_at: new Date().toISOString() })
        .eq("id", acc.id);
      continue;
    }

    result.fetched += inbound.length;
    const ownHandles = [acc.handle, acc.display_name]
      .filter(Boolean)
      .map((h: string) => String(h).toLowerCase().replace(/^@/, ""));

    for (const c of inbound) {
      // Eigene Kommentare nie beantworten, sonst redet der Account mit sich selbst.
      const author = (c.authorHandle ?? c.authorName ?? "").toLowerCase().replace(/^@/, "");
      const isOwn = author !== "" && ownHandles.includes(author);

      const { data: existing } = await supabaseAdmin
        .from("social_comments")
        .select("id")
        .eq("social_account_id", acc.id)
        .eq("external_comment_id", c.externalCommentId)
        .maybeSingle();
      if (existing) continue;

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("social_comments")
        .insert({
          user_id: acc.user_id,
          brand_id: acc.brand_id,
          social_account_id: acc.id,
          platform: acc.platform,
          external_comment_id: c.externalCommentId,
          external_post_id: c.externalPostId,
          post_url: c.postUrl,
          author_handle: c.authorHandle,
          author_name: c.authorName,
          text: c.text,
          like_count: c.likeCount,
          posted_at: c.postedAt,
          status: isOwn ? "skipped" : "new",
        })
        .select("id")
        .single();
      if (insErr || !inserted) continue;
      result.new++;

      if (isOwn || opts.dryRun || !acc.auto_reply_enabled) continue;

      const rules = (allRules ?? []).filter((r: any) => r.user_id === acc.user_id);
      const rule = matchRule(rules, c, acc);
      if (!rule) continue;

      const used = usedToday.get(rule.id) ?? 0;
      if (used >= rule.daily_limit) continue;

      // Verzoegerung: der Kommentar wartet, bis genug Zeit vergangen ist.
      if (rule.delay_minutes > 0 && c.postedAt) {
        const ready = new Date(c.postedAt).getTime() + rule.delay_minutes * 60_000;
        if (Date.now() < ready) continue;
      }

      const brand = acc.brand_id ? (brandName.get(acc.brand_id) ?? null) : null;
      try {
        const { text, mode } = await buildReply(rule, c, brand);
        await replyToComment(supabaseAdmin, acc, c.externalCommentId, text);
        await supabaseAdmin
          .from("social_comments")
          .update({
            status: "replied",
            reply_text: text,
            reply_mode: mode,
            rule_id: rule.id,
            replied_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", inserted.id);
        usedToday.set(rule.id, used + 1);
        result.replied++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Antwort fehlgeschlagen";
        await supabaseAdmin
          .from("social_comments")
          .update({ status: "failed", rule_id: rule.id, error: msg })
          .eq("id", inserted.id);
        result.problems.push({ account: acc.handle ?? acc.id, error: msg });
      }
    }

    await supabaseAdmin
      .from("social_accounts")
      .update({ last_comment_sync_at: new Date().toISOString(), sync_error: null })
      .eq("id", acc.id);
  }

  return result;
}
