// ============================================================
// Echte Uploads zu den Plattformen (nur Server).
// Wird von /api/public/hooks/process-publish-queue aufgerufen.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { refreshIfNeeded, type Platform } from "./social-oauth.server";

export type PublishResult = { url: string | null; note?: string };

async function signedClipUrl(supabaseAdmin: any, storagePath: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from("rendered-clips")
    .createSignedUrl(storagePath, 60 * 60 * 3);
  if (error || !data?.signedUrl) throw new Error("Signierte Video-URL fehlgeschlagen: " + (error?.message ?? ""));
  return data.signedUrl as string;
}

export async function publishClip(
  supabaseAdmin: any,
  account: {
    id: string;
    platform: Platform;
    access_token_encrypted: string | null;
    refresh_token_encrypted: string | null;
    expires_at: string | null;
    meta: any;
  },
  clip: { id: string; storage_path: string; title: string | null; caption_srt?: string | null },
): Promise<PublishResult> {
  const token = await refreshIfNeeded(supabaseAdmin, account);
  const videoUrl = await signedClipUrl(supabaseAdmin, clip.storage_path);
  const title = clip.title?.slice(0, 95) || "Neuer Clip";

  switch (account.platform) {
    case "youtube":
      return publishYouTube(token, videoUrl, title);
    case "instagram":
      return publishInstagram(token, account.meta?.ig_user_id, videoUrl, title);
    case "facebook":
      return publishFacebook(token, account.meta?.page_id, videoUrl, title);
    case "tiktok":
      return publishTikTok(token, videoUrl, title);
    case "x":
      throw new Error(
        "X (Twitter) unterstützt Video-Upload erst ab dem Basic-Tier (kostenpflichtig) — bitte Plattform im Zeitplan abwählen.",
      );
    default:
      throw new Error("Unbekannte Plattform");
  }
}

// ---------- YouTube (Shorts) ----------
async function publishYouTube(token: string, videoUrl: string, title: string): Promise<PublishResult> {
  const file = await fetch(videoUrl);
  if (!file.ok) throw new Error(`Video-Download aus dem Storage: HTTP ${file.status}`);
  const bytes = await file.arrayBuffer();

  const meta = {
    snippet: { title, description: `${title}\n\n#shorts`, categoryId: "22" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };

  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Length": String(bytes.byteLength),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(meta),
    },
  );
  if (!init.ok) throw new Error(`YouTube-Init: ${init.status} ${await init.text()}`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube gab keine Upload-URL zurück");

  const up = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.byteLength) },
    body: bytes,
  });
  const j: any = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(`YouTube-Upload: ${up.status} ${JSON.stringify(j)}`);
  return { url: j.id ? `https://youtube.com/watch?v=${j.id}` : null };
}

// ---------- Instagram Reels ----------
async function publishInstagram(
  token: string,
  igUserId: string | undefined,
  videoUrl: string,
  caption: string,
): Promise<PublishResult> {
  if (!igUserId) throw new Error("Kein Instagram-Business-Account am Token — bitte Account neu verbinden");

  const create = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: true,
      access_token: token,
    }),
  });
  const cj: any = await create.json();
  if (!create.ok || cj.error) throw new Error(`Instagram-Container: ${cj.error?.message ?? create.status}`);

  // Verarbeitung abwarten (max ~3 Min)
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(
      `https://graph.facebook.com/v21.0/${cj.id}?fields=status_code,status&access_token=${token}`,
    );
    const sj: any = await st.json();
    if (sj.status_code === "FINISHED") break;
    if (sj.status_code === "ERROR") throw new Error(`Instagram-Verarbeitung: ${sj.status ?? "ERROR"}`);
  }

  const pub = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: cj.id, access_token: token }),
  });
  const pj: any = await pub.json();
  if (!pub.ok || pj.error) throw new Error(`Instagram-Publish: ${pj.error?.message ?? pub.status}`);
  return { url: pj.id ? `https://www.instagram.com/reel/${pj.id}` : null };
}

// ---------- Facebook Reels/Video ----------
async function publishFacebook(
  token: string,
  pageId: string | undefined,
  videoUrl: string,
  description: string,
): Promise<PublishResult> {
  if (!pageId) throw new Error("Keine Facebook-Seite am Token — bitte Account neu verbinden");
  const res = await fetch(`https://graph-video.facebook.com/v21.0/${pageId}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: videoUrl, description, access_token: token }),
  });
  const j: any = await res.json();
  if (!res.ok || j.error) throw new Error(`Facebook-Upload: ${j.error?.message ?? res.status}`);
  return { url: j.id ? `https://www.facebook.com/${j.id}` : null };
}

// ---------- TikTok ----------
async function publishTikTok(token: string, videoUrl: string, title: string): Promise<PublishResult> {
  // Direct Post benötigt einen bestandenen TikTok-Audit. Ohne Audit landet das
  // Video über "inbox" in den Entwürfen des Accounts (halbautomatisch).
  const direct = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      post_info: { title, privacy_level: "SELF_ONLY", disable_comment: false },
      source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
    }),
  });
  const dj: any = await direct.json().catch(() => ({}));
  if (direct.ok && !dj?.error?.code?.match?.(/^(?!ok$)/i)) {
    return { url: null, note: `TikTok Direct-Post gestartet (publish_id ${dj?.data?.publish_id ?? "?"})` };
  }

  const inbox = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source_info: { source: "PULL_FROM_URL", video_url: videoUrl } }),
  });
  const ij: any = await inbox.json().catch(() => ({}));
  if (!inbox.ok || (ij?.error?.code && ij.error.code !== "ok")) {
    throw new Error(
      `TikTok-Upload: ${ij?.error?.message ?? dj?.error?.message ?? inbox.status}. Hinweis: Ohne bestandenen TikTok-Audit ist nur der Entwurfs-Upload möglich und die Video-URL-Domain muss in der TikTok-App verifiziert sein.`,
    );
  }
  return { url: null, note: "In TikTok-Entwürfe geladen — in der App nur noch auf 'Posten' tippen." };
}
