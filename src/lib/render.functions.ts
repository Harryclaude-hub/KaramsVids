import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Ist der Creatomate-Key hinterlegt? (für UI-Banner) */
export const getRenderProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { creatomateConfigured, renderConcurrency } = await import("@/lib/creatomate.server");
    return { creatomate: creatomateConfigured(), concurrency: renderConcurrency() };
  });

const StartInput = z.object({
  jobId: z.string().uuid(),
  clipIndexes: z.array(z.number().int().min(0)).max(500).nullable().optional(),
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
    const { error, count } = await supabase
      .from("render_jobs")
      .update({ status: "queued", attempts: 0, error: null, provider_render_id: null, progress: 0 })
      .eq("job_id", data.jobId)
      .eq("user_id", userId)
      .eq("status", "failed")
      .select("id", { count: "exact" });
    if (error) throw new Error(error.message);
    const { processRenderQueue } = await import("@/lib/bulk-render.server");
    const run = await processRenderQueue(supabase, { userId });
    return { requeued: count ?? 0, ...run };
  });
