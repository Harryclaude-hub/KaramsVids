import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Welche Provider-Keys sind hinterlegt? (für UI-Banner) */
export const getProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { providerStatus } = await import("@/lib/generation-core.server");
    return providerStatus();
  });

/**
 * Verarbeitet die Generierungs-Queue des eingeloggten Nutzers:
 * - schreibt Skripte + pflegt das Storyline-Gedächtnis (läuft sofort)
 * - startet/pollt fal.ai-Jobs, sobald FAL_KEY hinterlegt ist
 */
export const runGenerationQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { processJobs, providerStatus } = await import("@/lib/generation-core.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: jobs, error } = await (supabase as any)
      .from("generation_jobs")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["pending", "waiting_provider", "running"])
      .order("created_at", { ascending: true })
      .limit(10);
    if (error) throw new Error(error.message);
    const results = await processJobs(supabase, jobs ?? []);
    return { processed: results.length, results, providers: providerStatus() };
  });
