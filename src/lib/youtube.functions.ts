import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Welche YouTube-Download-Provider sind konfiguriert? (für UI) */
export const getDownloadProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { downloadProviders } = await import("@/lib/youtube-download.server");
    return downloadProviders();
  });

const ImportInput = z.object({ rawVideoId: z.string().uuid() });

/**
 * Lädt das verlinkte YouTube-Video serverseitig als MP4 herunter,
 * speichert es im Storage und aktualisiert raw_videos.
 * Danach funktionieren Analyse, Schnitt & Export mit der echten Datei.
 */
export const importYouTubeVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ImportInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { importYouTubeToStorage } = await import("@/lib/youtube-download.server");

    const { data: raw, error } = await supabase
      .from("raw_videos")
      .select("id, user_id, source_url, title, storage_path")
      .eq("id", data.rawVideoId)
      .eq("user_id", userId)
      .single();
    if (error || !raw) throw new Error("Video nicht gefunden");
    if (raw.storage_path) {
      return { ok: true, alreadyImported: true as const, storagePath: raw.storage_path };
    }
    if (!raw.source_url) throw new Error("Video hat keine Quell-URL");

    const result = await importYouTubeToStorage(supabase, {
      id: raw.id,
      user_id: raw.user_id,
      source_url: raw.source_url,
      title: raw.title,
    });
    return { ok: true, alreadyImported: false as const, ...result };
  });
