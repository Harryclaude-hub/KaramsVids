// ============================================================
// YouTube → MP4 Pipeline (nur Server).
//
// Lovable Cloud läuft serverless — yt-dlp als Binary geht dort
// nicht. Stattdessen eine Provider-Kette über HTTP:
//
//   1. RapidAPI  → Secret RAPIDAPI_KEY
//      (Default-Host: yt-api.p.rapidapi.com, überschreibbar
//       via RAPIDAPI_YTDL_HOST)
//   2. Cobalt    → Secret COBALT_API_URL (selbst gehostete
//      Instanz, z.B. auf Railway/Fly), optional COBALT_API_KEY
//
// Der Server lädt die MP4 und legt sie im Supabase-Storage ab —
// danach funktionieren KI-Analyse, Schnitt & Export mit der
// echten Datei.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_MB = Number(process.env.YT_IMPORT_MAX_MB ?? 250);

export function downloadProviders() {
  return {
    rapidapi: !!process.env.RAPIDAPI_KEY,
    cobalt: !!process.env.COBALT_API_URL,
    any: !!process.env.RAPIDAPI_KEY || !!process.env.COBALT_API_URL,
  };
}

export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (h === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (h.includes("youtube")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/\/(shorts|embed|live)\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[2];
    }
    return null;
  } catch {
    return null;
  }
}

type Resolved = { mp4Url: string; title?: string; durationS?: number };

// --- Provider 1: RapidAPI (yt-api) --------------------------
async function viaRapidApi(url: string): Promise<Resolved> {
  const key = process.env.RAPIDAPI_KEY!;
  const host = process.env.RAPIDAPI_YTDL_HOST ?? "yt-api.p.rapidapi.com";
  const id = extractYouTubeId(url);
  if (!id) throw new Error("Keine YouTube-Video-ID im Link gefunden");

  const res = await fetch(`https://${host}/dl?id=${encodeURIComponent(id)}`, {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": host },
  });
  if (!res.ok) throw new Error(`RapidAPI: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as any;

  // Progressive MP4-Formate (Video+Audio in einer Datei), max. 720p bevorzugt
  const formats: any[] = Array.isArray(j.formats) ? j.formats : [];
  const mp4s = formats
    .filter((f) => typeof f?.url === "string" && String(f.mimeType ?? "").includes("video/mp4"))
    .sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0));
  const pick = mp4s.find((f) => (Number(f.height) || 0) <= 720) ?? mp4s[0];
  if (!pick) {
    throw new Error(
      "RapidAPI lieferte kein progressives MP4-Format — anderes Video probieren oder anderen RAPIDAPI_YTDL_HOST setzen",
    );
  }
  return {
    mp4Url: pick.url,
    title: typeof j.title === "string" ? j.title : undefined,
    durationS: j.lengthSeconds ? Number(j.lengthSeconds) : undefined,
  };
}

// --- Provider 2: Cobalt (selbst gehostet) -------------------
async function viaCobalt(url: string): Promise<Resolved> {
  const base = process.env.COBALT_API_URL!;
  const res = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(process.env.COBALT_API_KEY
        ? { Authorization: `Api-Key ${process.env.COBALT_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      url,
      videoQuality: "720",
      youtubeVideoCodec: "h264",
      filenameStyle: "basic",
    }),
  });
  const j = (await res.json()) as any;
  if ((j.status === "tunnel" || j.status === "redirect") && typeof j.url === "string") {
    return { mp4Url: j.url };
  }
  throw new Error(`Cobalt: ${j?.error?.code ?? j?.status ?? res.status}`);
}

export async function resolveYouTubeMp4(url: string): Promise<Resolved> {
  const p = downloadProviders();
  const errors: string[] = [];
  if (p.rapidapi) {
    try {
      return await viaRapidApi(url);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (p.cobalt) {
    try {
      return await viaCobalt(url);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (!p.any) {
    throw new Error(
      "Kein Download-Provider konfiguriert. Hinterlege RAPIDAPI_KEY (RapidAPI, z.B. yt-api) oder COBALT_API_URL als Secret.",
    );
  }
  throw new Error("Download fehlgeschlagen: " + errors.join(" | "));
}

/**
 * Lädt das YouTube-Video als MP4 und legt es im Storage ab.
 * Aktualisiert raw_videos (storage_path, duration_s, size_bytes).
 */
export async function importYouTubeToStorage(
  supabase: any,
  rawVideo: { id: string; user_id: string; source_url: string; title?: string | null },
): Promise<{ storagePath: string; sizeBytes: number; durationS: number | null }> {
  const resolved = await resolveYouTubeMp4(rawVideo.source_url);

  const mp4Res = await fetch(resolved.mp4Url);
  if (!mp4Res.ok) throw new Error(`MP4-Download: HTTP ${mp4Res.status}`);

  const len = Number(mp4Res.headers.get("content-length") ?? 0);
  if (len && len > MAX_MB * 1024 * 1024) {
    throw new Error(
      `Video ist ${(len / 1024 / 1024).toFixed(0)} MB — Limit für Direkt-Import ist ${MAX_MB} MB (~30-45 Min in 720p). Bitte kürzeres Video oder Datei manuell hochladen.`,
    );
  }

  const buf = await mp4Res.arrayBuffer();
  if (buf.byteLength > MAX_MB * 1024 * 1024) {
    throw new Error(`Video überschreitet das ${MAX_MB}-MB-Limit für den Direkt-Import.`);
  }

  const storagePath = `${rawVideo.user_id}/yt-${rawVideo.id}.mp4`;
  const { error: upErr } = await supabase.storage
    .from("raw-videos")
    .upload(storagePath, buf, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error("Storage-Upload: " + upErr.message);

  const patch: Record<string, unknown> = {
    storage_path: storagePath,
    size_bytes: buf.byteLength,
    status: "ready",
  };
  if (resolved.durationS) patch.duration_s = resolved.durationS;
  if (resolved.title && (!rawVideo.title || rawVideo.title.startsWith("http"))) {
    patch.title = resolved.title;
  }
  const { error: dbErr } = await supabase.from("raw_videos").update(patch).eq("id", rawVideo.id);
  if (dbErr) throw new Error("DB-Update: " + dbErr.message);

  return {
    storagePath,
    sizeBytes: buf.byteLength,
    durationS: resolved.durationS ?? null,
  };
}
