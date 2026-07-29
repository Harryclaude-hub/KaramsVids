// ============================================================
// Creatomate-API-Client (nur Server).
//
// Creatomate rendert serverseitig: Untertitel, Musik-Layer,
// Übergänge, Farb-Look — hunderte Clips parallel, ohne dass der
// Browser des Nutzers läuft.
//
// Secret: CREATOMATE_API_KEY  (https://creatomate.com → Project
// Settings → API Key)
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

/** Startet einen Render-Auftrag. Gibt die Provider-Render-ID zurück. */
export async function submitRender(source: Record<string, unknown>): Promise<CreatomateRender> {
  const res = await fetch(`${API}/renders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({ source }),
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

/** Lädt das fertige MP4 und legt es im Storage-Bucket `rendered-clips` ab. */
export async function storeRenderedFile(
  supabase: any,
  url: string,
  storagePath: string,
): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download des Renders fehlgeschlagen: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const { error } = await supabase.storage
    .from("rendered-clips")
    .upload(storagePath, buf, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error("Storage-Upload: " + error.message);
  return buf.byteLength;
}
