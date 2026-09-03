// ============================================================
// Creatomate-API-Client (nur Server).
//
// Creatomate rendert serverseitig: Untertitel, Musik-Layer,
// Übergänge, Farb-Look — hunderte Clips parallel, ohne dass der
// Browser des Nutzers läuft.
//
// Secret: CREATOMATE_API_KEY  (https://creatomate.com → Project
// Settings → API Key)
// Secret: CREATOMATE_WEBHOOK_SECRET (automatisch erzeugt) — schützt
// den öffentlichen Callback-Endpunkt.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = "https://api.creatomate.com/v1";

export function creatomateConfigured() {
  return !!process.env.CREATOMATE_API_KEY;
}

/** Wie viele Renders dürfen gleichzeitig beim Provider laufen. */
export function renderConcurrency() {
  const n = Number(process.env.CREATOMATE_CONCURRENCY ?? 20);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 20;
}

/** Geschätzte Kosten pro Ausgabeminute (USD) — überschreibbar per Secret. */
export function costPerOutputMinute() {
  const n = Number(process.env.CREATOMATE_COST_PER_MINUTE ?? 0.05);
  return Number.isFinite(n) && n >= 0 ? n : 0.05;
}

export function estimateCostUsd(outputSeconds: number) {
  return Number(((Math.max(0, outputSeconds) / 60) * costPerOutputMinute()).toFixed(4));
}

/** Stabile Produktions-URL dieses Projekts (überschreibbar per Secret). */
const DEFAULT_APP_URL = "https://project--110c9ea8-91da-4cb4-8c6a-4aa4858912b8.lovable.app";

/** Öffentliche Callback-URL — Creatomate meldet fertige Renders direkt hierher. */
export function webhookUrl(): string | null {
  const secret = process.env.CREATOMATE_WEBHOOK_SECRET;
  if (!secret) return null;
  const base = (process.env.PUBLIC_APP_URL ?? DEFAULT_APP_URL).replace(/\/$/, "");
  return `${base}/api/public/hooks/creatomate-webhook?token=${encodeURIComponent(secret)}`;
}

export function webhookConfigured() {
  return !!webhookUrl();
}

function key() {
  const k = process.env.CREATOMATE_API_KEY;
  if (!k) {
    throw new Error(
      "CREATOMATE_API_KEY fehlt — hinterlege den Key aus creatomate.com (Project Settings → API Key), dann läuft das Massen-Rendering serverseitig.",
    );
  }
  return k;
}

export type CreatomateRender = {
  id: string;
  status: "planned" | "waiting" | "transcoding" | "rendering" | "succeeded" | "failed";
  url?: string;
  snapshot_url?: string;
  error_message?: string;
};

/** Verbindungstest: prüft Key + Erreichbarkeit der API. */
export async function pingCreatomate(): Promise<{ ok: boolean; message: string }> {
  if (!creatomateConfigured()) {
    return { ok: false, message: "Kein API-Key hinterlegt." };
  }
  try {
    const res = await fetch(`${API}/renders?limit=1`, {
      headers: { Authorization: `Bearer ${key()}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Key wurde abgelehnt (401/403) — bitte Key prüfen." };
    }
    if (!res.ok) {
      return { ok: false, message: `Creatomate antwortete mit HTTP ${res.status}.` };
    }
    return { ok: true, message: "Verbindung steht — Renders können gestartet werden." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Netzwerkfehler" };
  }
}

/** Startet einen Render-Auftrag. Gibt die Provider-Render-ID zurück. */
export async function submitRender(
  source: Record<string, unknown>,
  opts: { metadata?: string } = {},
): Promise<CreatomateRender> {
  const hook = webhookUrl();
  const res = await fetch(`${API}/renders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      source,
      ...(hook ? { webhook_url: hook } : {}),
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Creatomate ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text) as CreatomateRender[] | CreatomateRender;
  const first = Array.isArray(json) ? json[0] : json;
  if (!first?.id) throw new Error("Creatomate lieferte keine Render-ID");
  return first;
}

/** Fragt den Status eines laufenden Renders ab. */
export async function fetchRender(id: string): Promise<CreatomateRender> {
  const res = await fetch(`${API}/renders/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key()}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Creatomate Status ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as CreatomateRender;
}

/** Lädt eine Datei und legt sie im Storage-Bucket `rendered-clips` ab. */
export async function storeRemoteFile(
  supabase: any,
  url: string,
  storagePath: string,
  contentType: string,
): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const { error } = await supabase.storage
    .from("rendered-clips")
    .upload(storagePath, buf, { contentType, upsert: true });
  if (error) throw new Error("Storage-Upload: " + error.message);
  return buf.byteLength;
}

/** Lädt das fertige MP4 und legt es im Storage-Bucket `rendered-clips` ab. */
export async function storeRenderedFile(
  supabase: any,
  url: string,
  storagePath: string,
): Promise<number> {
  return storeRemoteFile(supabase, url, storagePath, "video/mp4");
}
