// ============================================================
// Echte Kennzahlen von den Plattformen holen (nur Server).
//
// Ersetzt die frueheren Zufallszahlen. Was eine Plattform nicht
// herausgibt, bleibt 0 — es wird nichts geschaetzt oder erfunden.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { refreshIfNeeded, type Platform } from "./social-oauth.server";
import type { AccountRow } from "./social-comments.server";

export type AccountMetrics = {
  followers: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  posts: number;
};

export type PostMetric = {
  externalPostId: string;
  postUrl: string | null;
  title: string | null;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
};

export type MetricsResult = { account: AccountMetrics; posts: PostMetric[] };

const MAX_POSTS = 25;
const n = (v: unknown) => Number(v ?? 0) || 0;

async function json(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

function sum(posts: PostMetric[], key: keyof PostMetric): number {
  return posts.reduce((a, p) => a + n(p[key]), 0);
}

export async function fetchMetrics(
  supabaseAdmin: any,
  account: AccountRow,
): Promise<MetricsResult> {
  const token = await refreshIfNeeded(supabaseAdmin, account as never);
  switch (account.platform as Platform) {
    case "youtube":
      return youtubeMetrics(token, account);
    case "instagram":
      return instagramMetrics(token, account);
    case "facebook":
      return facebookMetrics(token, account);
    case "tiktok":
      return tiktokMetrics(token);
    default:
      throw new Error(`Kennzahlen für ${account.platform} werden noch nicht unterstützt`);
  }
}

// ---------- YouTube ----------
async function youtubeMetrics(token: string, account: AccountRow): Promise<MetricsResult> {
  const channelId = account.external_id ?? account.meta?.channel_id;
  const h = { Authorization: `Bearer ${token}` };

  const cres = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails${
      channelId ? `&id=${encodeURIComponent(channelId)}` : "&mine=true"
    }`,
    { headers: h },
  );
  const cj = await json(cres);
  if (!cres.ok) throw new Error(`YouTube-Kanal: ${cj.error?.message ?? cres.status}`);
  const ch = cj.items?.[0];
  if (!ch) throw new Error("YouTube-Kanal nicht gefunden");

  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  const posts: PostMetric[] = [];
  if (uploads) {
    const pres = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails,snippet&maxResults=${MAX_POSTS}&playlistId=${uploads}`,
      { headers: h },
    );
    const pj = await json(pres);
    const ids = (pj.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length) {
      const vres = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids.join(",")}`,
        { headers: h },
      );
      const vj = await json(vres);
      for (const v of vj.items ?? []) {
        posts.push({
          externalPostId: String(v.id),
          postUrl: `https://youtube.com/watch?v=${v.id}`,
          title: v.snippet?.title ?? null,
          publishedAt: v.snippet?.publishedAt ?? null,
          views: n(v.statistics?.viewCount),
          likes: n(v.statistics?.likeCount),
          comments: n(v.statistics?.commentCount),
          shares: 0,
          saves: n(v.statistics?.favoriteCount),
          reach: 0,
        });
      }
    }
  }

  return {
    account: {
      followers: n(ch.statistics?.subscriberCount),
      views: n(ch.statistics?.viewCount),
      likes: sum(posts, "likes"),
      comments: n(ch.statistics?.commentCount) || sum(posts, "comments"),
      shares: 0,
      posts: n(ch.statistics?.videoCount),
    },
    posts,
  };
}

// ---------- Instagram ----------
async function instagramMetrics(token: string, account: AccountRow): Promise<MetricsResult> {
  const igId = account.external_id ?? account.meta?.ig_user_id;
  if (!igId) throw new Error("Instagram-Account-ID fehlt — bitte Account neu verbinden");

  const ures = await fetch(
    `https://graph.facebook.com/v21.0/${igId}?fields=followers_count,media_count&access_token=${token}`,
  );
  const uj = await json(ures);
  if (!ures.ok || uj.error)
    throw new Error(`Instagram-Profil: ${uj.error?.message ?? ures.status}`);

  const mres = await fetch(
    `https://graph.facebook.com/v21.0/${igId}/media?limit=${MAX_POSTS}` +
      `&fields=id,permalink,caption,timestamp,like_count,comments_count,media_product_type` +
      `&access_token=${token}`,
  );
  const mj = await json(mres);
  const posts: PostMetric[] = [];

  for (const m of mj.data ?? []) {
    // Reichweite und Views liegen in den Insights, nicht am Medium selbst.
    let views = 0;
    let reach = 0;
    let saves = 0;
    let shares = 0;
    const ires = await fetch(
      `https://graph.facebook.com/v21.0/${m.id}/insights?metric=reach,saved,shares,views&access_token=${token}`,
    );
    const ij = await json(ires);
    for (const item of ij.data ?? []) {
      const val = n(item.values?.[0]?.value);
      if (item.name === "reach") reach = val;
      else if (item.name === "saved") saves = val;
      else if (item.name === "shares") shares = val;
      else if (item.name === "views") views = val;
    }
    posts.push({
      externalPostId: String(m.id),
      postUrl: m.permalink ?? null,
      title: (m.caption ?? "").slice(0, 120) || null,
      publishedAt: m.timestamp ?? null,
      views: views || reach,
      likes: n(m.like_count),
      comments: n(m.comments_count),
      shares,
      saves,
      reach,
    });
  }

  return {
    account: {
      followers: n(uj.followers_count),
      views: sum(posts, "views"),
      likes: sum(posts, "likes"),
      comments: sum(posts, "comments"),
      shares: sum(posts, "shares"),
      posts: n(uj.media_count),
    },
    posts,
  };
}

// ---------- Facebook ----------
async function facebookMetrics(token: string, account: AccountRow): Promise<MetricsResult> {
  const pageId = account.external_id ?? account.meta?.page_id;
  if (!pageId) throw new Error("Facebook-Seiten-ID fehlt — bitte Account neu verbinden");

  const pres = await fetch(
    `https://graph.facebook.com/v21.0/${pageId}?fields=fan_count,followers_count&access_token=${token}`,
  );
  const pj = await json(pres);
  if (!pres.ok || pj.error) throw new Error(`Facebook-Seite: ${pj.error?.message ?? pres.status}`);

  const fres = await fetch(
    `https://graph.facebook.com/v21.0/${pageId}/posts?limit=${MAX_POSTS}` +
      `&fields=id,permalink_url,message,created_time,likes.summary(true),comments.summary(true),shares,` +
      `insights.metric(post_impressions,post_impressions_unique)` +
      `&access_token=${token}`,
  );
  const fj = await json(fres);
  const posts: PostMetric[] = [];

  for (const p of fj.data ?? []) {
    let views = 0;
    let reach = 0;
    for (const item of p.insights?.data ?? []) {
      const val = n(item.values?.[0]?.value);
      if (item.name === "post_impressions") views = val;
      if (item.name === "post_impressions_unique") reach = val;
    }
    posts.push({
      externalPostId: String(p.id),
      postUrl: p.permalink_url ?? null,
      title: (p.message ?? "").slice(0, 120) || null,
      publishedAt: p.created_time ?? null,
      views,
      likes: n(p.likes?.summary?.total_count),
      comments: n(p.comments?.summary?.total_count),
      shares: n(p.shares?.count),
      saves: 0,
      reach,
    });
  }

  return {
    account: {
      followers: n(pj.followers_count ?? pj.fan_count),
      views: sum(posts, "views"),
      likes: sum(posts, "likes"),
      comments: sum(posts, "comments"),
      shares: sum(posts, "shares"),
      posts: posts.length,
    },
    posts,
  };
}

// ---------- TikTok ----------
async function tiktokMetrics(token: string): Promise<MetricsResult> {
  const ures = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const uj = await json(ures);
  if (!ures.ok) throw new Error(`TikTok-Profil: ${uj?.error?.message ?? ures.status}`);
  const u = uj.data?.user ?? {};

  const vres = await fetch(
    "https://open.tiktokapis.com/v2/video/list/?fields=id,title,share_url,create_time,view_count,like_count,comment_count,share_count",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ max_count: MAX_POSTS }),
    },
  );
  const vj = await json(vres);
  const posts: PostMetric[] = (vj.data?.videos ?? []).map((v: any) => ({
    externalPostId: String(v.id),
    postUrl: v.share_url ?? null,
    title: v.title ?? null,
    publishedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
    views: n(v.view_count),
    likes: n(v.like_count),
    comments: n(v.comment_count),
    shares: n(v.share_count),
    saves: 0,
    reach: 0,
  }));

  return {
    account: {
      followers: n(u.follower_count),
      views: sum(posts, "views"),
      likes: n(u.likes_count) || sum(posts, "likes"),
      comments: sum(posts, "comments"),
      shares: sum(posts, "shares"),
      posts: n(u.video_count) || posts.length,
    },
    posts,
  };
}
