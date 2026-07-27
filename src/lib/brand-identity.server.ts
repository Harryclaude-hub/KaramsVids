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
  const base: HandleCheck = { platform, url, state: "unknown", signupUrl: SIGNUP_URL[platform] ?? "" };
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
