// ============================================================
// Kommentare aller Plattformen einsammeln und beantworten (nur Server).
//
// Abgedeckt:
//   YouTube    → commentThreads (lesen) + comments (antworten)
//   Instagram  → media/comments (lesen) + comment/replies (antworten)
//   Facebook   → posts/comments (lesen) + comment/comments (antworten)
//   TikTok     → video/comment (nur mit freigeschalteten Scopes)
//
// Was hier NICHT passiert: Accounts anlegen, Logins automatisieren oder
// Zugriff ohne offizielle API. Alles laeuft ueber die dokumentierten
// Schnittstellen der jeweiligen Plattform.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { refreshIfNeeded, type Platform } from "./social-oauth.server";

export type InboundComment = {
  externalCommentId: string;
  externalPostId: string | null;
  postUrl: string | null;
  authorHandle: string | null;
  authorName: string | null;
  text: string;
  likeCount: number;
  postedAt: string | null;
};

export type AccountRow = {
  id: string;
  user_id: string;
  brand_id: string | null;
  platform: Platform;
  external_id: string | null;
  handle: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
  meta: any;
};

const MAX_POSTS = 10;
const MAX_COMMENTS_PER_POST = 50;

async function json(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

// ============================================================
// Lesen
// ============================================================

export async function fetchComments(
  supabaseAdmin: any,
  account: AccountRow,
): Promise<InboundComment[]> {
  const token = await refreshIfNeeded(supabaseAdmin, account as never);
  switch (account.platform) {
    case "youtube":
      return fetchYouTube(token, account);
    case "instagram":
      return fetchInstagram(token, account);
    case "facebook":
      return fetchFacebook(token, account);
    case "tiktok":
      return fetchTikTok(token);
    default:
      throw new Error(`Kommentare für ${account.platform} werden noch nicht unterstützt`);
  }
}

async function fetchYouTube(token: string, account: AccountRow): Promise<InboundComment[]> {
  const channelId = account.external_id ?? account.meta?.channel_id;
  if (!channelId) throw new Error("YouTube-Kanal-ID fehlt, bitte Account neu verbinden");

  const url =
    `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&order=time` +
    `&maxResults=${MAX_COMMENTS_PER_POST}&allThreadsRelatedToChannelId=${encodeURIComponent(channelId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await json(res);
  if (!res.ok) {
    const reason = j.error?.errors?.[0]?.reason;
    if (reason === "insufficientPermissions")
      throw new Error(
        "YouTube: Der Zugriff auf Kommentare fehlt. Account bitte neu verbinden, damit der Scope youtube.force-ssl erteilt wird.",
      );
    throw new Error(`YouTube-Kommentare: ${j.error?.message ?? res.status}`);
  }

  return (j.items ?? []).map((it: any) => {
    const top = it.snippet?.topLevelComment;
    const s = top?.snippet ?? {};
    return {
      externalCommentId: String(top?.id ?? it.id),
      externalPostId: s.videoId ?? null,
      postUrl: s.videoId ? `https://youtube.com/watch?v=${s.videoId}` : null,
      authorHandle: s.authorDisplayName ?? null,
      authorName: s.authorDisplayName ?? null,
      text: s.textOriginal ?? s.textDisplay ?? "",
      likeCount: Number(s.likeCount ?? 0),
      postedAt: s.publishedAt ?? null,
    };
  });
}

async function fetchInstagram(token: string, account: AccountRow): Promise<InboundComment[]> {
  const igId = account.external_id ?? account.meta?.ig_user_id;
  if (!igId) throw new Error("Instagram-Account-ID fehlt, bitte Account neu verbinden");

  const mres = await fetch(
    `https://graph.facebook.com/v21.0/${igId}/media?fields=id,permalink&limit=${MAX_POSTS}&access_token=${token}`,
  );
  const mj = await json(mres);
  if (!mres.ok || mj.error)
    throw new Error(`Instagram-Medien: ${mj.error?.message ?? mres.status}`);

  const out: InboundComment[] = [];
  for (const media of mj.data ?? []) {
    const cres = await fetch(
      `https://graph.facebook.com/v21.0/${media.id}/comments?fields=id,text,username,timestamp,like_count` +
        `&limit=${MAX_COMMENTS_PER_POST}&access_token=${token}`,
    );
    const cj = await json(cres);
    if (!cres.ok || cj.error) continue;
    for (const c of cj.data ?? []) {
      out.push({
        externalCommentId: String(c.id),
        externalPostId: String(media.id),
        postUrl: media.permalink ?? null,
        authorHandle: c.username ? `@${c.username}` : null,
        authorName: c.username ?? null,
        text: c.text ?? "",
        likeCount: Number(c.like_count ?? 0),
        postedAt: c.timestamp ?? null,
      });
    }
  }
  return out;
}

async function fetchFacebook(token: string, account: AccountRow): Promise<InboundComment[]> {
  const pageId = account.external_id ?? account.meta?.page_id;
  if (!pageId) throw new Error("Facebook-Seiten-ID fehlt, bitte Account neu verbinden");

  const pres = await fetch(
    `https://graph.facebook.com/v21.0/${pageId}/posts?fields=id,permalink_url&limit=${MAX_POSTS}&access_token=${token}`,
  );
  const pj = await json(pres);
  if (!pres.ok || pj.error)
    throw new Error(`Facebook-Beiträge: ${pj.error?.message ?? pres.status}`);

  const out: InboundComment[] = [];
  for (const post of pj.data ?? []) {
    const cres = await fetch(
      `https://graph.facebook.com/v21.0/${post.id}/comments?fields=id,message,from,created_time,like_count` +
        `&limit=${MAX_COMMENTS_PER_POST}&access_token=${token}`,
    );
    const cj = await json(cres);
    if (!cres.ok || cj.error) continue;
    for (const c of cj.data ?? []) {
      out.push({
        externalCommentId: String(c.id),
        externalPostId: String(post.id),
        postUrl: post.permalink_url ?? null,
        authorHandle: c.from?.name ?? null,
        authorName: c.from?.name ?? null,
        text: c.message ?? "",
        likeCount: Number(c.like_count ?? 0),
        postedAt: c.created_time ?? null,
      });
    }
  }
  return out;
}

async function fetchTikTok(token: string): Promise<InboundComment[]> {
  // TikTok gibt Kommentare nur frei, wenn die App die Scopes comment.list /
  // comment.list.manage bewilligt bekommen hat. Ohne Freigabe liefert der
  // Endpunkt scope_not_authorized zurueck.
  const vres = await fetch("https://open.tiktokapis.com/v2/video/list/?fields=id,title,share_url", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ max_count: MAX_POSTS }),
  });
  const vj = await json(vres);
  if (!vres.ok || vj?.error?.code === "scope_not_authorized")
    throw new Error(
      "TikTok: Für Kommentare braucht deine TikTok-App die Scopes comment.list und comment.list.manage. Nach der Freigabe TIKTOK_SCOPES setzen und den Account neu verbinden.",
    );

  const out: InboundComment[] = [];
  for (const v of vj.data?.videos ?? []) {
    const cres = await fetch(
      "https://open.tiktokapis.com/v2/video/comment/list/?fields=id,text,create_time,like_count,username",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ video_id: v.id, max_count: MAX_COMMENTS_PER_POST }),
      },
    );
    const cj = await json(cres);
    if (!cres.ok || cj?.error?.code === "scope_not_authorized") break;
    for (const c of cj.data?.comments ?? []) {
      out.push({
        externalCommentId: String(c.id),
        externalPostId: String(v.id),
        postUrl: v.share_url ?? null,
        authorHandle: c.username ? `@${c.username}` : null,
        authorName: c.username ?? null,
        text: c.text ?? "",
        likeCount: Number(c.like_count ?? 0),
        postedAt: c.create_time ? new Date(c.create_time * 1000).toISOString() : null,
      });
    }
  }
  return out;
}

// ============================================================
// Antworten
// ============================================================

export async function replyToComment(
  supabaseAdmin: any,
  account: AccountRow,
  externalCommentId: string,
  message: string,
): Promise<void> {
  const token = await refreshIfNeeded(supabaseAdmin, account as never);
  const body = message.trim();
  if (!body) throw new Error("Leere Antwort");

  if (account.platform === "youtube") {
    const res = await fetch("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ snippet: { parentId: externalCommentId, textOriginal: body } }),
    });
    const j = await json(res);
    if (!res.ok) throw new Error(`YouTube-Antwort: ${j.error?.message ?? res.status}`);
    return;
  }

  if (account.platform === "instagram") {
    const res = await fetch(`https://graph.facebook.com/v21.0/${externalCommentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: body, access_token: token }),
    });
    const j = await json(res);
    if (!res.ok || j.error) throw new Error(`Instagram-Antwort: ${j.error?.message ?? res.status}`);
    return;
  }

  if (account.platform === "facebook") {
    const res = await fetch(`https://graph.facebook.com/v21.0/${externalCommentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: body, access_token: token }),
    });
    const j = await json(res);
    if (!res.ok || j.error) throw new Error(`Facebook-Antwort: ${j.error?.message ?? res.status}`);
    return;
  }

  if (account.platform === "tiktok") {
    const res = await fetch("https://open.tiktokapis.com/v2/video/comment/reply/create/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: externalCommentId, text: body }),
    });
    const j = await json(res);
    if (!res.ok || (j?.error?.code && j.error.code !== "ok"))
      throw new Error(
        `TikTok-Antwort: ${j?.error?.message ?? res.status}. Benötigt den freigeschalteten Scope comment.create.`,
      );
    return;
  }

  throw new Error(`Antworten auf ${account.platform} wird nicht unterstützt`);
}

// ============================================================
// Regeln anwenden
// ============================================================

export type ReplyRule = {
  id: string;
  user_id: string;
  brand_id: string | null;
  platform: string | null;
  social_account_id: string | null;
  name: string;
  mode: "template" | "ai";
  keywords: string[];
  exclude_keywords: string[];
  message_template: string | null;
  ai_instruction: string | null;
  ai_tone: string;
  max_length: number;
  daily_limit: number;
  delay_minutes: number;
  priority: number;
  active: boolean;
};

function normalize(s: string) {
  return s.toLowerCase();
}

/** Erste passende Regel nach Priorität. */
export function matchRule(
  rules: ReplyRule[],
  comment: InboundComment,
  account: AccountRow,
): ReplyRule | null {
  const text = normalize(comment.text);
  const candidates = rules
    .filter((r) => r.active)
    .filter((r) => !r.platform || r.platform === account.platform)
    .filter((r) => !r.social_account_id || r.social_account_id === account.id)
    .filter((r) => !r.brand_id || r.brand_id === account.brand_id)
    .sort((a, b) => b.priority - a.priority);

  for (const r of candidates) {
    if (r.exclude_keywords.some((k) => k && text.includes(normalize(k)))) continue;
    if (r.keywords.length === 0 || r.keywords.some((k) => k && text.includes(normalize(k))))
      return r;
  }
  return null;
}

export function renderTemplate(
  tpl: string,
  vars: { name?: string | null; brand?: string | null; comment?: string | null },
): string {
  return tpl
    .replaceAll("{name}", (vars.name ?? "").replace(/^@/, ""))
    .replaceAll("{brand}", vars.brand ?? "")
    .replaceAll("{kommentar}", vars.comment ?? "")
    .replaceAll("{comment}", vars.comment ?? "")
    .trim();
}

/** Antworttext per KI erzeugen. Faellt bei Problemen auf die Vorlage zurueck. */
export async function generateAiReply(
  rule: ReplyRule,
  comment: InboundComment,
  brandName: string | null,
): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key)
    throw new Error("LOVABLE_API_KEY fehlt, KI-Antworten sind ohne Schlüssel nicht möglich");

  const prompt = `Du beantwortest einen Kommentar unter einem Social-Media-Video.

Marke: ${brandName ?? "unbekannt"}
Plattform-Kommentar von ${comment.authorName ?? "einem Zuschauer"}: "${comment.text}"

Anweisung des Betreibers: ${rule.ai_instruction || "Antworte hilfreich und passend zum Kommentar."}
Tonfall: ${rule.ai_tone}

Regeln für deine Antwort:
- Höchstens ${rule.max_length} Zeichen.
- Sprache des Kommentars übernehmen.
- Keine Erfindungen über Produkte, Preise oder Zusagen.
- Keine Links, ausser die Anweisung nennt einen ausdrücklich.
- Bei Beleidigungen oder Hass: sachlich und kurz bleiben, nicht provozieren.
- Nur der reine Antworttext, keine Anführungszeichen, keine Erklärung.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
    }),
  });
  if (!res.ok) throw new Error(`KI-Antwort fehlgeschlagen: ${res.status} ${await res.text()}`);
  const j = await json(res);
  const text: string = j.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("KI lieferte keine Antwort");
  return text.slice(0, rule.max_length);
}

/** Fertigen Antworttext für eine Regel bestimmen. */
export async function buildReply(
  rule: ReplyRule,
  comment: InboundComment,
  brandName: string | null,
): Promise<{ text: string; mode: "template" | "ai" }> {
  if (rule.mode === "ai") {
    try {
      return { text: await generateAiReply(rule, comment, brandName), mode: "ai" };
    } catch (e) {
      // Ohne Vorlage als Netz bleibt nur der Fehler.
      if (!rule.message_template) throw e;
    }
  }
  const tpl = rule.message_template ?? "";
  if (!tpl.trim()) throw new Error(`Regel "${rule.name}" hat keine Vorlage hinterlegt`);
  return {
    text: renderTemplate(tpl, {
      name: comment.authorName,
      brand: brandName,
      comment: comment.text,
    }).slice(0, rule.max_length),
    mode: "template",
  };
}
