import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  jobId: z.string().uuid(),
  sourceUrl: z.string().url().optional(),
  storagePath: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Analysiert ein Referenzvideo (Link oder Storage-Pfad) via Gemini und leitet
 * daraus einen strukturierten Edit-Stil ab. Wird auf edit_jobs.style_reference
 * gespeichert und kann per Chat-Tool apply_style_reference angewendet werden.
 */
export const analyzeStyleReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    let usedUrl = data.sourceUrl ?? null;
    if (!usedUrl && data.storagePath) {
      const { data: signed } = await supabase.storage.from("raw-videos").createSignedUrl(data.storagePath, 3600);
      usedUrl = signed?.signedUrl ?? null;
    }

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const prompt = `Du analysierst den Edit-Stil eines Referenzvideos.
Referenz-URL: ${usedUrl ?? "n/a"}
Notiz vom Nutzer: ${data.notes ?? "keine"}

Leite den wahrscheinlichen Edit-Stil ab (short-form UGC / long-form / cinematic / etc.), auch wenn du das Video nicht direkt öffnen kannst — nutze URL-Domain und Notiz als Hinweise und wähle vernünftige Defaults.
Antworte NUR mit gültigem JSON:
{
  "aspect": "9:16" | "16:9" | "1:1",
  "avg_clip_length_s": number,
  "cut_frequency": "slow" | "medium" | "fast" | "very_fast",
  "caption_style": "none" | "burned_bottom" | "burned_center" | "karaoke",
  "caption_style_example": "kurzer Beispieltext im Stil",
  "color_grade": "natural" | "warm" | "cool" | "high_contrast" | "vintage",
  "audio_style": "music_heavy" | "voiceover_only" | "raw" | "sfx_forward",
  "hook_style": "1 Satz Beschreibung",
  "notes": "1-2 Sätze Fazit"
}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Rate limit — bitte gleich nochmal.");
      if (res.status === 402) throw new Error("KI-Credits aufgebraucht.");
      throw new Error("Style-Analyse fehlgeschlagen: " + t);
    }
    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content ?? "{}";
    let style: Record<string, unknown>;
    try { style = JSON.parse(text) as Record<string, unknown>; }
    catch { throw new Error("KI-Antwort war kein gültiges JSON"); }
    style._source_url = data.sourceUrl ?? null;
    style._storage_path = data.storagePath ?? null;
    style._notes = data.notes ?? null;
    style._analyzed_at = new Date().toISOString();

    const { error } = await supabase.from("edit_jobs").update({ style_reference: style as unknown as never }).eq("id", data.jobId);
    if (error) throw new Error(error.message);
    return { style: style as Record<string, string | number | boolean | null> };
  });
