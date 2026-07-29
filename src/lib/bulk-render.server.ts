// ============================================================
// Bulk-Render-Pipeline (nur Server).
//
// Ablauf:
//   1. enqueueBulkRender(): aus dem KI-Schnittplan (edit_jobs.analysis)
//      entsteht pro Segment eine Zeile in `render_jobs` (status=queued),
//      inkl. Vorlage, Musik-Track und Untertitel.
//   2. processRenderQueue(): läuft wiederholt (UI-Poll oder pg_cron)
//      - prüft laufende Renders parallel
//      - fertige Renders → Storage + generated_clips
//      - füllt freie Slots mit neuen Renders auf (Parallelität via
//        CREATOMATE_CONCURRENCY, Default 20)
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildCreatomateSource, type Aspect } from "@/lib/creatomate-templates";
import { renderTemplateFor } from "@/lib/creatomate-templates";
import { MUSIC_LIBRARY, type MusicMood } from "@/lib/music-library";
import {
  creatomateConfigured,
  fetchRender,
  renderConcurrency,
  storeRenderedFile,
  submitRender,
} from "@/lib/creatomate.server";

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

/** Legt für jeden Clip des Jobs eine Render-Zeile an. */
export async function enqueueBulkRender(
  supabase: any,
  opts: { jobId: string; userId: string; clipIndexes?: number[] | null },
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
    music_mood?: MusicMood;
  };
  const templateId = options.template_id ?? "ugc_hook";
  const aspect: Aspect = options.aspect ?? "9:16";
  const mood: MusicMood = options.music_mood ?? "hype";
  const tpl = renderTemplateFor(templateId);

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
        provider: "creatomate",
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

/** Verarbeitet einen Durchlauf der Render-Queue. */
export async function processRenderQueue(
  supabase: any,
  scope: { userId?: string | null } = {},
): Promise<{
  configured: boolean;
  submitted: number;
  completed: number;
  failed: number;
  active: number;
  queued: number;
}> {
  const configured = creatomateConfigured();
  const base = () => {
    let q = supabase.from("render_jobs").select("*");
    if (scope.userId) q = q.eq("user_id", scope.userId);
    return q;
  };

  // --- 1. laufende Renders prüfen (parallel) ---
  const { data: active } = await base().in("status", ACTIVE).limit(renderConcurrency() * 3);
  let completed = 0;
  let failed = 0;

  if (configured && active?.length) {
    await Promise.all(
      (active as any[]).map(async (row) => {
        if (!row.provider_render_id) return;
        try {
          const r = await fetchRender(row.provider_render_id);
          if (r.status === "succeeded" && r.url) {
            const storagePath = `${row.user_id}/${row.job_id}/clip-${String(row.clip_index + 1).padStart(3, "0")}.mp4`;
            await storeRenderedFile(supabase, r.url, storagePath);
            const { data: clip } = await supabase
              .from("generated_clips")
              .insert({
                user_id: row.user_id,
                job_id: row.job_id,
                brand_id: row.brand_id,
                storage_path: storagePath,
                aspect: row.aspect,
                duration_s: Number(row.end_s) - Number(row.start_s),
                title: row.title,
                caption_srt: row.captions_srt,
                status: "draft",
                meta: {
                  renderer: "creatomate",
                  template_id: row.template_id,
                  music_url: row.music_url,
                  render_job_id: row.id,
                },
              })
              .select("id")
              .single();
            await supabase
              .from("render_jobs")
              .update({
                status: "done",
                progress: 100,
                output_url: r.url,
                storage_path: storagePath,
                clip_id: clip?.id ?? null,
                error: null,
              })
              .eq("id", row.id);
            completed++;
          } else if (r.status === "failed") {
            await supabase
              .from("render_jobs")
              .update({ status: "failed", error: r.error_message ?? "Render fehlgeschlagen" })
              .eq("id", row.id);
            failed++;
          } else {
            const pct = r.status === "rendering" ? 70 : r.status === "transcoding" ? 45 : 20;
            await supabase
              .from("render_jobs")
              .update({ status: "rendering", progress: pct })
              .eq("id", row.id);
          }
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
          const source = buildCreatomateSource({
            templateId: row.template_id,
            aspect: row.aspect as Aspect,
            videoUrl: row.source_url,
            startS: Number(row.start_s),
            endS: Number(row.end_s),
            captionsSrt: row.captions_srt,
            captionsEnabled: true,
            musicUrl: row.music_url,
            hookText: null,
          });
          const r = await submitRender(source);
          await supabase
            .from("render_jobs")
            .update({
              status: "submitted",
              provider_render_id: r.id,
              progress: 10,
              attempts: (row.attempts ?? 0) + 1,
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
    submitted,
    completed,
    failed,
    active: (await counts("rendering")) + (await counts("submitted")),
    queued: await counts("queued"),
  };
}
