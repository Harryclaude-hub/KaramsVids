// ============================================================
// Brand-Identität: Handle-Verfügbarkeit prüfen + Zugangsdaten
// (verschlüsselt) verwalten. Nur Server.
// ============================================================

import { encryptToken, decryptToken } from "./social-oauth.server";

export type HandleCheck = {
  platform: string;
  url: string;
  state: "free" | "taken" | "unknown";
  signupUrl: string;
};

const PROFILE_URL: Record<string, (h: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}/`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  facebook: (h) => `https://www.facebook.com/${h}`,
  x: (h) => `https://x.com/${h}`,
};

export const SIGNUP_URL: Record<string, string> = {
  instagram: "https://www.instagram.com/accounts/emailsignup/",
  tiktok: "https://www.tiktok.com/signup",
  youtube: "https://www.youtube.com/create_channel",
  facebook: "https://www.facebook.com/pages/create",
  x: "https://x.com/i/flow/signup",
};

export const LOGIN_URL: Record<string, string> = {
  instagram: "https://www.instagram.com/accounts/login/",
  tiktok: "https://www.tiktok.com/login",
  youtube: "https://accounts.google.com/",
  facebook: "https://www.facebook.com/login",
  x: "https://x.com/login",
};

export function sanitizeHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 30)
    .toLowerCase();
}

async function checkOne(platform: string, handle: string): Promise<HandleCheck> {
  const url = PROFILE_URL[platform]?.(handle) ?? "";
  const base: HandleCheck = {
    platform,
    url,
    state: "unknown",
    signupUrl: SIGNUP_URL[platform] ?? "",
  };
  if (!url) return base;
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (res.status === 404 || res.status === 410) return { ...base, state: "free" };
    if (res.status === 200) return { ...base, state: "taken" };
    return base; // 3xx/429/Login-Wall → nicht sicher feststellbar
  } catch {
    return base;
  }
}

export async function checkHandle(handle: string, platforms: string[]): Promise<HandleCheck[]> {
  const h = sanitizeHandle(handle);
  if (!h) return [];
  return Promise.all(platforms.map((p) => checkOne(p, h)));
}

export function encryptPassword(plain: string): string {
  return encryptToken(plain);
}
export function decryptPassword(stored: string): string {
  return decryptToken(stored);
}

// ---------- Setup-Assistent (Account-Anlage ohne Plattform-API) ----------

/** Erzeugt freie, plattformkonforme Handle-Varianten aus einem Brand-Namen. */
export function suggestHandleVariants(raw: string): string[] {
  const base = sanitizeHandle(raw);
  if (!base) return [];
  const out = new Set<string>([
    base,
    `${base}.official`,
    `${base}_hq`,
    `the.${base}`,
    `${base}.daily`,
    `${base}${new Date().getFullYear() % 100}`,
    `real.${base}`,
    `${base}.studio`,
  ]);
  return [...out].map((h) => h.slice(0, 30)).filter(Boolean);
}

/** Starkes, aber überall zulässiges Passwort (keine exotischen Sonderzeichen). */
export function generateStrongPassword(len = 18): string {
  const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%*?-_"];
  const all = sets.join("");
  const bytes = new Uint8Array(Math.max(len, 12));
  crypto.getRandomValues(bytes);
  const pick = (pool: string, i: number) => pool[bytes[i]! % pool.length]!;
  const chars = sets.map((s, i) => pick(s, i));
  for (let i = sets.length; i < bytes.length; i++) chars.push(pick(all, i));
  // deterministisch mischen mit weiteren Zufallsbytes
  const mix = new Uint8Array(chars.length);
  crypto.getRandomValues(mix);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = mix[i]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
