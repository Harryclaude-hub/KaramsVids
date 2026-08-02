import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Ist der Creatomate-Key hinterlegt? (für UI-Banner) */
export const getRenderProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { creatomateConfigured, renderConcurrency, webhookConfigured, webhookUrl, costPerOutputMinute } =
      await import("@/lib/creatomate.server");
    const { renderProviderCatalog } = await import("@/lib/render-providers.server");
    return {
      providers: renderProviderCatalog(),
      creatomate: creatomateConfigured(),
      concurrency: renderConcurrency(),
      webhook: webhookConfigured(),
      webhookUrl: webhookUrl(),
      costPerMinute: costPerOutputMinute(),
    };
  });

const ProviderId = z.enum(["creatomate", "shotstack", "json2video"]);

/** Verbindungstest gegen den gewählten Render-Provider. */
export const testRenderProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ provider: ProviderId.optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { renderProvider } = await import("@/lib/render-providers.server");
    const p = renderProvider(data.provider ?? "creatomate");
    const res = await p.ping();
    return { ...res, provider: p.id, label: p.label };
  });

/** Wechselt den Provider aller noch nicht gestarteten Renders eines Jobs. */
export const setQueueRenderProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ jobId: z.string().uuid(), provider: ProviderId }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("render_jobs")
      .update({ provider: data.provider, provider_render_id: null, error: null })
      .eq("job_id", data.jobId)
      .eq("user_id", context.userId)
      .in("status", ["queued", "failed"])
      .select("id");
    if (error) throw new Error(error.message);
    return { updated: rows?.length ?? 0, provider: data.provider };
  });

const StartInput = z.object({
  jobId: z.string().uuid(),
  clipIndexes: z.array(z.number().int().min(0)).max(500).nullable().optional(),
  provider: ProviderId.optional(),
});

/** Legt für alle (oder ausgewählte) Clips des Jobs Render-Aufträge an und startet die erste Welle. */
export const startBulkRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StartInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { enqueueBulkRender, processRenderQueue } = await import("@/lib/bulk-render.server");
    const queued = await enqueueBulkRender(supabase, {
      jobId: data.jobId,
      userId,
      clipIndexes: data.clipIndexes ?? null,
      provider: data.provider ?? null,
    });
    const run = await processRenderQueue(supabase, { userId });
    return { ...queued, ...run };
  });

/** Ein Durchlauf der Render-Queue des eingeloggten Nutzers (UI-Polling). */
export const pollBulkRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processRenderQueue } = await import("@/lib/bulk-render.server");
    return processRenderQueue(context.supabase, { userId: context.userId });
  });

const RetryInput = z.object({ jobId: z.string().uuid() });

/** Setzt fehlgeschlagene Renders eines Jobs zurück in die Warteschlange. */
export const retryFailedRenders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RetryInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("render_jobs")
      .update({ status: "queued", attempts: 0, error: null, provider_render_id: null, progress: 0 })
      .eq("job_id", data.jobId)
      .eq("user_id", userId)
      .eq("status", "failed")
      .select("id");
    if (error) throw new Error(error.message);
    const { processRenderQueue } = await import("@/lib/bulk-render.server");
    return processRenderQueue(supabase, { userId });
  });

const JobInput = z.object({ jobId: z.string().uuid() });

/** Kosten-, Laufzeit- und Fehler-Kennzahlen eines Bulk-Jobs. */
export const getBulkRenderStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { renderConcurrency, estimateCostUsd, webhookConfigured } = await import(
      "@/lib/creatomate.server"
    );
    const { data: rows, error } = await supabase
      .from("render_jobs")
      .select(
        "id, clip_index, status, progress, error, title, start_s, end_s, cost_usd, render_seconds, submitted_at, finished_at, storage_path, thumbnail_path",
      )
      .eq("job_id", data.jobId)
      .eq("user_id", userId)
      .order("clip_index", { ascending: true });
    if (error) throw new Error(error.message);

    const list = rows ?? [];
    const by = (s: string) => list.filter((r) => r.status === s).length;
    const done = list.filter((r) => r.status === "done");
    const outputSeconds = list.reduce((a, r) => a + Math.max(0, Number(r.end_s) - Number(r.start_s)), 0);
    const spent = done.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
    const times = done.map((r) => Number(r.render_seconds ?? 0)).filter((n) => n > 0);
    const firstStart = list
      .map((r) => (r.submitted_at ? new Date(r.submitted_at).getTime() : null))
      .filter((n): n is number => !!n);
    const lastEnd = list
      .map((r) => (r.finished_at ? new Date(r.finished_at).getTime() : null))
      .filter((n): n is number => !!n);

    return {
      total: list.length,
      queued: by("queued"),
      active: by("submitted") + by("rendering"),
      done: done.length,
      failed: by("failed"),
      concurrency: renderConcurrency(),
      webhook: webhookConfigured(),
      costSpentUsd: Number(spent.toFixed(3)),
      costEstimateUsd: Number(estimateCostUsd(outputSeconds).toFixed(3)),
      avgRenderSeconds: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
      wallClockSeconds:
        firstStart.length && lastEnd.length
          ? Math.max(0, Math.round((Math.max(...lastEnd) - Math.min(...firstStart)) / 1000))
          : null,
      errors: list
        .filter((r) => r.status === "failed")
        .map((r) => ({ clipIndex: r.clip_index, title: r.title, error: r.error })),
      rows: list.map((r) => ({
        id: r.id,
        clipIndex: r.clip_index,
        title: r.title,
        status: r.status,
        progress: r.progress,
        costUsd: Number(r.cost_usd ?? 0),
        renderSeconds: r.render_seconds,
      })),
    };
  });

/** Signierte Download-Links aller fertigen Assets eines Jobs (Bulk-Download). */
export const getJobExportAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("render_jobs")
      .select("clip_index, title, storage_path, thumbnail_path, audio_path")
      .eq("job_id", data.jobId)
      .eq("user_id", userId)
      .eq("status", "done")
      .order("clip_index", { ascending: true });
    if (error) throw new Error(error.message);

    const sign = async (path?: string | null) => {
      if (!path) return null;
      const { data: s } = await supabase.storage.from("rendered-clips").createSignedUrl(path, 60 * 60 * 6);
      return s?.signedUrl ?? null;
    };

    const assets = await Promise.all(
      (rows ?? []).map(async (r) => ({
        clipIndex: r.clip_index,
        title: r.title ?? `Clip ${r.clip_index + 1}`,
        fileName: `clip-${String(r.clip_index + 1).padStart(3, "0")}.mp4`,
        video: await sign(r.storage_path),
        thumbnail: await sign(r.thumbnail_path),
        audio: await sign(r.audio_path),
      })),
    );

    return { folder: `${userId}/${data.jobId}`, assets };
  });

// ---------- Template-Editor: eigene Vorlagen ----------

const PresetConfig = z
  .object({
    captionStyle: z.enum(["karaoke", "block", "highlight", "none"]).optional(),
    captionY: z.string().optional(),
    captionSizePct: z.number().min(2).max(14).optional(),
    captionActiveColor: z.string().optional(),
    musicVolumePct: z.number().min(0).max(100).optional(),
    musicDuck: z.boolean().optional(),
    transitionIn: z.enum(["fade", "slide-up", "scale-up", "wipe-right", "none"]).optional(),
    transitionOut: z.enum(["fade", "scale-down", "none"]).optional(),
    transitionDurationS: z.number().min(0).max(2).optional(),
    motionKind: z.enum(["none", "slow-zoom", "punch-in"]).optional(),
    motionAmountPct: z.number().min(0).max(30).optional(),
  })
  .strict();

export const listTemplatePresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("render_template_presets")
      .select("id, name, base_template_id, config, updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const SavePreset = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(80),
  baseTemplateId: z.string().min(1).max(40),
  config: PresetConfig,
});

export const saveTemplatePreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SavePreset.parse(input))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name,
      base_template_id: data.baseTemplateId,
      config: data.config,
      updated_at: new Date().toISOString(),
    };
    const q = data.id
      ? context.supabase.from("render_template_presets").update(row).eq("id", data.id).eq("user_id", context.userId)
      : context.supabase.from("render_template_presets").insert(row);
    const { data: saved, error } = await q.select("id").single();
    if (error) throw new Error(error.message);
    return { id: saved.id };
  });

export const deleteTemplatePreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("render_template_presets")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
