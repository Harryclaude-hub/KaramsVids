// ============================================================
// OAuth + Token-Handling für Social-Plattformen (nur Server).
//
// Pro Plattform brauchst du eine eigene Developer-App:
//   YouTube    → GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
//   Instagram  → META_APP_ID / META_APP_SECRET
//   Facebook   → META_APP_ID / META_APP_SECRET
//   TikTok     → TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET
//   X/Twitter  → X_CLIENT_ID / X_CLIENT_SECRET
//
// Tokens werden mit SOCIAL_TOKEN_KEY (AES-256-GCM) verschlüsselt
// in social_accounts abgelegt, der OAuth-State mit
// SOCIAL_STATE_SECRET (HMAC) signiert.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type Platform = "tiktok" | "youtube" | "instagram" | "facebook" | "x";

export const PLATFORMS: Platform[] = ["youtube", "instagram", "facebook", "tiktok", "x"];

type Cfg = {
  label: string;
  idEnv: string;
  secretEnv: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string;
  docsUrl: string;
  usesPkce?: boolean;
  extraAuthParams?: Record<string, string>;
};

export const OAUTH_CONFIG: Record<Platform, Cfg> = {
  youtube: {
    label: "YouTube",
    idEnv: "GOOGLE_CLIENT_ID",
    secretEnv: "GOOGLE_CLIENT_SECRET",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes:
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    docsUrl: "https://console.cloud.google.com/apis/credentials",
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  instagram: {
    label: "Instagram",
    idEnv: "META_APP_ID",
    secretEnv: "META_APP_SECRET",
    authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes:
      "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management",
    docsUrl: "https://developers.facebook.com/apps",
  },
  facebook: {
    label: "Facebook",
    idEnv: "META_APP_ID",
    secretEnv: "META_APP_SECRET",
    authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes:
      "pages_show_list,pages_manage_posts,pages_read_engagement,read_insights,business_management",
    docsUrl: "https://developers.facebook.com/apps",
  },
  tiktok: {
    label: "TikTok",
    idEnv: "TIKTOK_CLIENT_KEY",
    secretEnv: "TIKTOK_CLIENT_SECRET",
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: "user.info.basic,video.upload,video.publish,video.list",
    docsUrl: "https://developers.tiktok.com/apps",
  },
  x: {
    label: "X (Twitter)",
    idEnv: "X_CLIENT_ID",
    secretEnv: "X_CLIENT_SECRET",
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    scopes: "tweet.read tweet.write users.read offline.access media.write",
    docsUrl: "https://developer.x.com/en/portal/dashboard",
    usesPkce: true,
  },
};

export function platformReady(p: Platform) {
  const c = OAUTH_CONFIG[p];
  return !!process.env[c.idEnv] && !!process.env[c.secretEnv];
}

export function platformStatus() {
  return PLATFORMS.map((p) => ({
    platform: p,
    label: OAUTH_CONFIG[p].label,
    configured: platformReady(p),
    idEnv: OAUTH_CONFIG[p].idEnv,
    secretEnv: OAUTH_CONFIG[p].secretEnv,
    docsUrl: OAUTH_CONFIG[p].docsUrl,
  }));
}

// ---------- Crypto ----------
function tokenKey(): Buffer {
  const raw = process.env.SOCIAL_TOKEN_KEY;
  if (!raw) throw new Error("SOCIAL_TOKEN_KEY fehlt");
  // Beliebig langer String → 32-Byte-Key
  return createHmac("sha256", "videocraft-token-key").update(raw).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptToken(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const d = createDecipheriv("aes-256-gcm", tokenKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

// ---------- State (signiert, kurzlebig) ----------
type StatePayload = {
  u: string; // user id
  b: string; // brand id
  p: Platform;
  o: string; // origin
  v?: string; // pkce verifier
  e: number; // expiry (ms)
};

function stateSecret(): string {
  const s = process.env.SOCIAL_STATE_SECRET;
  if (!s) throw new Error("SOCIAL_STATE_SECRET fehlt");
  return s;
}

export function signState(payload: Omit<StatePayload, "e">): string {
  const body = Buffer.from(JSON.stringify({ ...payload, e: Date.now() + 15 * 60_000 })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string): StatePayload {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Ungültiger State");
  const expected = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("State-Signatur ungültig");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  if (parsed.e < Date.now()) throw new Error("State abgelaufen (bitte erneut verbinden)");
  return parsed;
}

export function redirectUri(origin: string, platform: Platform) {
  return `${origin}/api/public/oauth/${platform}/callback`;
}

// ---------- Authorize-URL ----------
export function buildAuthorizeUrl(opts: {
  platform: Platform;
  origin: string;
  userId: string;
  brandId: string;
}): string {
  const { platform, origin } = opts;
  const cfg = OAUTH_CONFIG[platform];
  const clientId = process.env[cfg.idEnv];
  if (!clientId || !process.env[cfg.secretEnv]) {
    throw new Error(
      `${cfg.label} ist noch nicht eingerichtet — es fehlen die Secrets ${cfg.idEnv} und ${cfg.secretEnv}. Anlegen unter: ${cfg.docsUrl}`,
    );
  }

  const verifier = cfg.usesPkce ? randomBytes(32).toString("base64url") : undefined;
  const state = signState({ u: opts.userId, b: opts.brandId, p: platform, o: origin, v: verifier });
  const ru = redirectUri(origin, platform);

  const u = new URL(cfg.authUrl);
  if (platform === "tiktok") {
    u.searchParams.set("client_key", clientId);
    u.searchParams.set("scope", cfg.scopes);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("redirect_uri", ru);
    u.searchParams.set("state", state);
    return u.toString();
  }
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", ru);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", cfg.scopes);
  u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) u.searchParams.set(k, v);
  if (cfg.usesPkce && verifier) {
    // Plain-Challenge ist für X erlaubt und vermeidet extra Speicher-Runde
    u.searchParams.set("code_challenge", verifier);
    u.searchParams.set("code_challenge_method", "plain");
  }
  return u.toString();
}

// ---------- Token-Exchange ----------
export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  meta?: Record<string, unknown>;
};

export async function exchangeCode(
  platform: Platform,
  code: string,
  origin: string,
  verifier?: string,
): Promise<TokenSet> {
  const cfg = OAUTH_CONFIG[platform];
  const clientId = process.env[cfg.idEnv]!;
  const clientSecret = process.env[cfg.secretEnv]!;
  const ru = redirectUri(origin, platform);

  if (platform === "tiktok") {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: ru,
      }),
    });
    const j: any = await res.json();
    if (!res.ok || j.error)
      throw new Error(`TikTok-Token: ${j.error_description ?? j.error ?? res.status}`);
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
      meta: { open_id: j.open_id, scope: j.scope },
    };
  }

  if (platform === "x") {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: ru,
        code_verifier: verifier ?? "",
      }),
    });
    const j: any = await res.json();
    if (!res.ok) throw new Error(`X-Token: ${j.error_description ?? j.error ?? res.status}`);
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
    };
  }

  if (platform === "youtube") {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: ru,
        grant_type: "authorization_code",
      }),
    });
    const j: any = await res.json();
    if (!res.ok) throw new Error(`Google-Token: ${j.error_description ?? j.error ?? res.status}`);
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
    };
  }

  // Meta (Instagram + Facebook): Short-lived → Long-lived Token
  const shortRes = await fetch(
    `${cfg.tokenUrl}?${new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: ru,
      code,
    })}`,
  );
  const shortJson: any = await shortRes.json();
  if (!shortRes.ok || shortJson.error)
    throw new Error(`Meta-Token: ${shortJson.error?.message ?? shortRes.status}`);

  const longRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: shortJson.access_token,
    })}`,
  );
  const longJson: any = await longRes.json();
  const userToken: string = longJson.access_token ?? shortJson.access_token;

  // Page + (bei Instagram) verknüpften IG-Business-Account ermitteln
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${userToken}`,
  );
  const pagesJson: any = await pagesRes.json();
  const pages: any[] = Array.isArray(pagesJson.data) ? pagesJson.data : [];
  const page =
    platform === "instagram"
      ? (pages.find((p) => p.instagram_business_account) ?? pages[0])
      : pages[0];

  if (!page) {
    throw new Error(
      platform === "instagram"
        ? "Kein Instagram-Business-Account gefunden. Instagram-Account auf 'Business' umstellen und mit einer Facebook-Seite verknüpfen."
        : "Keine Facebook-Seite gefunden, auf die du Posting-Rechte hast.",
    );
  }

  return {
    accessToken: page.access_token ?? userToken,
    refreshToken: null,
    expiresAt: longJson.expires_in
      ? new Date(Date.now() + longJson.expires_in * 1000).toISOString()
      : null,
    meta: {
      page_id: page.id,
      page_name: page.name,
      ig_user_id: page.instagram_business_account?.id ?? null,
      ig_username: page.instagram_business_account?.username ?? null,
    },
  };
}

// ---------- Handle / Profil ----------
export async function fetchHandle(platform: Platform, t: TokenSet): Promise<string | null> {
  try {
    if (platform === "youtube") {
      const r = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${t.accessToken}` } },
      );
      const j: any = await r.json();
      return j.items?.[0]?.snippet?.title ?? null;
    }
    if (platform === "tiktok") {
      const r = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=display_name,username",
        {
          headers: { Authorization: `Bearer ${t.accessToken}` },
        },
      );
      const j: any = await r.json();
      const d = j.data?.user;
      return d?.username ? `@${d.username}` : (d?.display_name ?? null);
    }
    if (platform === "x") {
      const r = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });
      const j: any = await r.json();
      return j.data?.username ? `@${j.data.username}` : null;
    }
    if (platform === "instagram") {
      const ig = (t.meta as any)?.ig_username;
      return ig ? `@${ig}` : null;
    }
    return ((t.meta as any)?.page_name as string) ?? null;
  } catch {
    return null;
  }
}

// ---------- Refresh ----------
export async function refreshIfNeeded(
  supabaseAdmin: any,
  account: {
    id: string;
    platform: Platform;
    access_token_encrypted: string | null;
    refresh_token_encrypted: string | null;
    expires_at: string | null;
  },
): Promise<string> {
  if (!account.access_token_encrypted)
    throw new Error("Kein Access-Token gespeichert — bitte Account neu verbinden");
  const access = decryptToken(account.access_token_encrypted);
  const exp = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  const stillValid = !exp || exp - Date.now() > 5 * 60_000;
  if (stillValid || !account.refresh_token_encrypted) return access;

  const cfg = OAUTH_CONFIG[account.platform];
  const refresh = decryptToken(account.refresh_token_encrypted);
  const clientId = process.env[cfg.idEnv]!;
  const clientSecret = process.env[cfg.secretEnv]!;
  let next: TokenSet | null = null;

  if (account.platform === "youtube") {
    const r = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }),
    });
    const j: any = await r.json();
    if (r.ok && j.access_token)
      next = {
        accessToken: j.access_token,
        expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
      };
  } else if (account.platform === "tiktok") {
    const r = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refresh,
      }),
    });
    const j: any = await r.json();
    if (r.ok && j.access_token)
      next = {
        accessToken: j.access_token,
        refreshToken: j.refresh_token ?? refresh,
        expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
      };
  } else if (account.platform === "x") {
    const r = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
    });
    const j: any = await r.json();
    if (r.ok && j.access_token)
      next = {
        accessToken: j.access_token,
        refreshToken: j.refresh_token ?? refresh,
        expiresAt: new Date(Date.now() + (j.expires_in ?? 7200) * 1000).toISOString(),
      };
  }

  if (!next) return access;
  await supabaseAdmin
    .from("social_accounts")
    .update({
      access_token_encrypted: encryptToken(next.accessToken),
      ...(next.refreshToken ? { refresh_token_encrypted: encryptToken(next.refreshToken) } : {}),
      expires_at: next.expiresAt ?? null,
      status: "connected",
    })
    .eq("id", account.id);
  return next.accessToken;
}
