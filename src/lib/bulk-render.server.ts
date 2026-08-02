// ============================================================
// Bulk-Render-Pipeline (nur Server).
//
// Ablauf:
//   1. enqueueBulkRender(): aus dem KI-Schnittplan (edit_jobs.analysis)
//      entsteht pro Segment eine Zeile in `render_jobs` (status=queued),
//      inkl. Vorlage, Musik-Track und Untertitel.
//   2. processRenderQueue(): läuft wiederholt (UI-Poll oder pg_cron)
//      - prüft laufende Renders (nur solange kein Webhook aktiv ist)
//      - fertige Renders → Storage + generated_clips
//      - füllt freie Slots mit neuen Renders auf
//   3. finalizeRender(): gemeinsame Abschluss-Logik für Webhook + Polling
//      (MP4 + Thumbnail in den Job-Ordner, Kosten & Laufzeit schreiben)
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  mergeTemplate,
  renderTemplateFor,
  type Aspect,
  type TemplateOverrides,
} from "@/lib/creatomate-templates";
import { MUSIC_LIBRARY, type MusicMood } from "@/lib/music-library";
import {
  estimateCostUsd,
  renderConcurrency,
  storeRemoteFile,
  storeRenderedFile,
  webhookConfigured,
  type CreatomateRender,
} from "@/lib/creatomate.server";
import {
  isRenderProviderId,
  renderProvider,
  renderProviderCatalog,
  type RenderProviderId,
} from "@/lib/render-providers.server";

const SIGNED_URL_TTL = 60 * 60 * 12; // 12h — reicht für lange Render-Queues

export type Segment = {
  start_s: number;
  end_s: number;
  title?: string;
  hook?: string;
  captions?: string;
};

/** Deterministische Musikauswahl: gleiche Stimmung → rotierende Tracks. */
export function pickTrackUrl(mood: MusicMood, index: number): string | null {
  if (mood === "none") return null;
  const pool = MUSIC_LIBRARY.filter((t) => t.mood === mood);
  const list = pool.length ? pool : MUSIC_LIBRARY;
  if (!list.length) return null;
  return list[index % list.length].url;
}

async function sourceUrlFor(supabase: any, raw: any): Promise<string> {
  if (raw?.storage_path) {
    const { data, error } = await supabase.storage
      .from("raw-videos")
      .createSignedUrl(raw.storage_path, SIGNED_URL_TTL);
    if (error || !data?.signedUrl) throw new Error("Signierte URL fehlgeschlagen: " + (error?.message ?? ""));
    return data.signedUrl;
  }
  if (raw?.source_url) return raw.source_url as string;
  throw new Error(
    "Kein abspielbares Rohvideo — bitte zuerst die Datei hochladen oder den YouTube-MP4-Import laufen lassen.",
  );
}

/** Ordnerpfad aller Export-Assets eines Jobs. */
export function jobFolder(userId: string, jobId: string) {
  return `${userId}/${jobId}`;
}

/** Legt für jeden Clip des Jobs eine Render-Zeile an. */
export async function enqueueBulkRender(
  supabase: any,
  opts: {
    jobId: string;
    userId: string;
    clipIndexes?: number[] | null;
    provider?: RenderProviderId | null;
  },
): Promise<{ queued: number; skipped: number }> {
  const { data: job, error } = await supabase
    .from("edit_jobs")
    .select("*, raw_videos(*)")
    .eq("id", opts.jobId)
    .eq("user_id", opts.userId)
    .single();
  if (error || !job) throw new Error("Job nicht gefunden");

  const analysis = (job.analysis ?? {}) as { segments?: Segment[] };
  const segments = Array.isArray(analysis.segments) ? analysis.segments : [];
  if (!segments.length) throw new Error("Noch kein KI-Schnittplan vorhanden — bitte zuerst analysieren.");

  const raw = job.raw_videos;
  const videoUrl = await sourceUrlFor(supabase, raw);

  const options = (job.options ?? {}) as {
    aspect?: Aspect;
    captions?: boolean;
    template_id?: string;
    template_preset_id?: string;
    music_mood?: MusicMood;
    render_provider?: string;
  };
  const templateId = options.template_id ?? "ugc_hook";
  const aspect: Aspect = options.aspect ?? "9:16";
  const mood: MusicMood = options.music_mood ?? "hype";
  const provider: RenderProviderId = isRenderProviderId(opts.provider)
    ? opts.provider
    : isRenderProviderId(options.render_provider)
      ? options.render_provider
      : "creatomate";

  // Eigene Vorlage (Template-Editor) laden, falls im Job hinterlegt —
  // sonst wird die zuletzt gespeicherte Vorlage zur Basis-Vorlage genutzt.
  let overrides: TemplateOverrides = {};
  let presetQuery = supabase
    .from("render_template_presets")
    .select("id, base_template_id, config")
    .eq("user_id", opts.userId);
  presetQuery = options.template_preset_id
    ? presetQuery.eq("id", options.template_preset_id)
    : presetQuery.eq("base_template_id", templateId).order("updated_at", { ascending: false }).limit(1);
  const { data: presets } = await presetQuery;
  if (presets?.length) overrides = (presets[0].config ?? {}) as TemplateOverrides;

  const tpl = mergeTemplate(renderTemplateFor(templateId), overrides);

  const { data: existing } = await supabase
    .from("render_jobs")
    .select("clip_index, status")
    .eq("job_id", job.id);
  const blocked = new Set(
    (existing ?? [])
      .filter((r: any) => r.status !== "failed")
      .map((r: any) => r.clip_index as number),
  );

  const wanted = opts.clipIndexes?.length
    ? opts.clipIndexes
    : segments.map((_, i) => i);

  const rows = wanted
    .filter((i) => i >= 0 && i < segments.length && !blocked.has(i))
    .map((i) => {
      const s = segments[i];
      return {
        user_id: opts.userId,
        job_id: job.id,
        brand_id: job.brand_id,
        clip_index: i,
        template_id: templateId,
        template_config: overrides as any,
        provider,
        status: "queued",
        source_url: videoUrl,
        start_s: Math.max(0, Number(s.start_s) || 0),
        end_s: Math.max(1, Number(s.end_s) || 0),
        aspect,
        title: s.title ?? `Clip ${i + 1}`,
        captions_srt: options.captions === false ? null : (s.captions ?? null),
        music_url: pickTrackUrl(mood, i),
        music_volume: tpl.music.volumePct / 100,
      };
    });

  if (!rows.length) return { queued: 0, skipped: wanted.length };

  const { error: insErr } = await supabase.from("render_jobs").insert(rows);
  if (insErr) throw new Error("Render-Queue: " + insErr.message);
  return { queued: rows.length, skipped: wanted.length - rows.length };
}

const ACTIVE = ["submitted", "rendering"];

/**
 * Abschluss eines Renders: MP4 + Thumbnail in den Job-Ordner legen,
 * Clip anlegen, Laufzeit und geschätzte Kosten schreiben.
 * Wird sowohl vom Webhook als auch vom Polling benutzt (idempotent).
 */
export async function finalizeRender(
  supabase: any,
  row: any,
  render: CreatomateRender,
  source: "webhook" | "poll",
): Promise<"done" | "failed" | "pending"> {
  if (row.status === "done") return "done";

  const nowIso = new Date().toISOString();
  const stamp = source === "webhook" ? { webhook_received_at: nowIso } : {};

  if (render.status === "failed") {
    await supabase
      .from("render_jobs")
      .update({
        status: "failed",
        finished_at: nowIso,
        error: render.error_message ?? "Render fehlgeschlagen",
        ...stamp,
      })
      .eq("id", row.id);
    return "failed";
  }

  if (render.status !== "succeeded" || !render.url) {
    const pct = render.status === "rendering" ? 70 : render.status === "transcoding" ? 45 : 20;
    await supabase.from("render_jobs").update({ status: "rendering", progress: pct, ...stamp }).eq("id", row.id);
    return "pending";
  }

  const folder = jobFolder(row.user_id, row.job_id);
  const base = `clip-${String(row.clip_index + 1).padStart(3, "0")}`;
  const storagePath = `${folder}/${base}.mp4`;
  await storeRenderedFile(supabase, render.url, storagePath);

  let thumbnailPath: string | null = null;
  if (render.snapshot_url) {
    try {
      thumbnailPath = `${folder}/${base}.jpg`;
      await storeRemoteFile(supabase, render.snapshot_url, thumbnailPath, "image/jpeg");
    } catch {
      thumbnailPath = null;
    }
  }

  const durationS = Math.max(0, Number(row.end_s) - Number(row.start_s));
  const startedAt = row.submitted_at ? new Date(row.submitted_at).getTime() : null;
  const renderSeconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;

  const { data: clip } = await supabase
    .from("generated_clips")
    .insert({
      user_id: row.user_id,
      job_id: row.job_id,
      brand_id: row.brand_id,
      storage_path: storagePath,
      aspect: row.aspect,
      duration_s: durationS,
      title: row.title,
      caption_srt: row.captions_srt,
      status: "draft",
      meta: {
        renderer: row.provider ?? "creatomate",
        template_id: row.template_id,
        music_url: row.music_url,
        render_job_id: row.id,
        thumbnail_path: thumbnailPath,
      },
    })
    .select("id")
    .single();

  await supabase
    .from("render_jobs")
    .update({
      status: "done",
      progress: 100,
      output_url: render.url,
      storage_path: storagePath,
      thumbnail_path: thumbnailPath,
      audio_path: null,
      clip_id: clip?.id ?? null,
      finished_at: nowIso,
      render_seconds: renderSeconds,
      cost_usd: estimateCostUsd(durationS),
      error: null,
      ...stamp,
    })
    .eq("id", row.id);

  return "done";
}

/** Verarbeitet einen Durchlauf der Render-Queue. */
export async function processRenderQueue(
  supabase: any,
  scope: { userId?: string | null; force?: boolean } = {},
): Promise<{
  configured: boolean;
  webhook: boolean;
  submitted: number;
  completed: number;
  failed: number;
  active: number;
  queued: number;
}> {
  const catalog = renderProviderCatalog();
  const configured = catalog.some((p) => p.configured);
  const webhook = webhookConfigured();
  const base = () => {
    let q = supabase.from("render_jobs").select("*");
    if (scope.userId) q = q.eq("user_id", scope.userId);
    return q;
  };

  // --- 1. laufende Renders prüfen ---
  // Mit aktivem Webhook nur noch als Sicherheitsnetz: Zeilen, die seit >5 min
  // keine Rückmeldung hatten. Ohne Webhook wird regulär gepollt.
  let completed = 0;
  let failed = 0;

  if (configured) {
    const activeQ = base().in("status", ACTIVE).limit(renderConcurrency() * 3);
    const { data: active } = await activeQ;
    const graceCutoff = Date.now() - 5 * 60_000;

    await Promise.all(
      ((active as any[]) ?? []).map(async (row) => {
        if (!row.provider_render_id) return;
        const p = renderProvider(row.provider);
        // Provider mit aktivem Webhook nur als Sicherheitsnetz nachfragen.
        if (
          p.supportsWebhook &&
          webhook &&
          !scope.force &&
          row.submitted_at &&
          new Date(row.submitted_at).getTime() > graceCutoff
        ) {
          return;
        }
        if (!p.configured()) return;
        try {
          const r = await p.fetch(row.provider_render_id);
          const res = await finalizeRender(supabase, row, r, "poll");
          if (res === "done") completed++;
          if (res === "failed") failed++;
        } catch (e) {
          await supabase
            .from("render_jobs")
            .update({ error: e instanceof Error ? e.message : String(e) })
            .eq("id", row.id);
        }
      }),
    );
  }

  // --- 2. freie Slots mit neuen Renders füllen ---
  const { count: stillActive } = await (() => {
    let q = supabase.from("render_jobs").select("id", { count: "exact", head: true }).in("status", ACTIVE);
    if (scope.userId) q = q.eq("user_id", scope.userId);
    return q;
  })();

  const free = Math.max(0, renderConcurrency() - (stillActive ?? 0));
  let submitted = 0;

  if (configured && free > 0) {
    const { data: queued } = await base()
      .eq("status", "queued")
      .order("clip_index", { ascending: true })
      .limit(free);

    await Promise.all(
      ((queued as any[]) ?? []).map(async (row) => {
        try {
          const p = renderProvider(row.provider);
          if (!p.configured()) {
            throw new Error(
              `Render-Provider ${p.label} ist nicht verbunden — Secret ${p.keyName} fehlt.`,
            );
          }
          const r = await p.submit({
            rowId: row.id,
            templateId: row.template_id,
            overrides: (row.template_config ?? {}) as TemplateOverrides,
            aspect: row.aspect as Aspect,
            videoUrl: row.source_url,
            startS: Number(row.start_s),
            endS: Number(row.end_s),
            captionsSrt: row.captions_srt,
            musicUrl: row.music_url,
            musicVolume: Number(row.music_volume ?? 0.3),
            title: row.title ?? null,
          });
          await supabase
            .from("render_jobs")
            .update({
              status: "submitted",
              provider_render_id: r.id,
              progress: 10,
              attempts: (row.attempts ?? 0) + 1,
              submitted_at: new Date().toISOString(),
              error: null,
            })
            .eq("id", row.id);
          submitted++;
        } catch (e) {
          const attempts = (row.attempts ?? 0) + 1;
          await supabase
            .from("render_jobs")
            .update({
              attempts,
              status: attempts >= 3 ? "failed" : "queued",
              error: e instanceof Error ? e.message : String(e),
            })
            .eq("id", row.id);
          if (attempts >= 3) failed++;
        }
      }),
    );
  }

  const counts = async (status: string) => {
    let q = supabase.from("render_jobs").select("id", { count: "exact", head: true }).eq("status", status);
    if (scope.userId) q = q.eq("user_id", scope.userId);
    const { count } = await q;
    return count ?? 0;
  };

  return {
    configured,
    webhook,
    submitted,
    completed,
    failed,
    active: (await counts("rendering")) + (await counts("submitted")),
    queued: await counts("queued"),
  };
}
