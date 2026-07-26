import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  jobId: z.string().uuid(),
  desiredClipCount: z.number().int().min(1).max(100).nullable().optional(),
});


type Segment = {
  start_s: number;
  end_s: number;
  title: string;
  hook: string;
  captions?: string;
};

type Analysis = {
  transcript_summary: string;
  language: string;
  segments: Segment[];
};

/**
 * Analysiert das Video anhand von Titel + Dauer (Rohmaterial-Metadaten).
 * Für einen echten Audio-Transcript-Modus müsste die Datei zunächst zu
 * einem STT-Provider hochgeladen werden — hier nutzen wir Lovable AI
 * (Gemini) mit den vorhandenen Metadaten, um eine Schnitt-Skizze zu erzeugen.
 */
export const analyzeVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: job, error: jobErr } = await supabase
      .from("edit_jobs")
      .select("*, raw_videos(*)")
      .eq("id", data.jobId)
      .eq("user_id", userId)
      .single();
    if (jobErr || !job) throw new Error("Job nicht gefunden");

    await supabase.from("edit_jobs").update({ status: "analyzing", progress: 10 }).eq("id", job.id);

    const raw = (
      job as { raw_videos: { title: string; duration_s: number | null; source_url: string | null } }
    ).raw_videos;
    const dur = raw.duration_s ?? 60;
    const mode = job.mode;

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY fehlt");

    if (data.desiredClipCount) {
      await supabase
        .from("edit_jobs")
        .update({ desired_clip_count: data.desiredClipCount })
        .eq("id", job.id);
    }
    const countHint = data.desiredClipCount
      ? `WICHTIG: Der Nutzer möchte GENAU ${data.desiredClipCount} Clips — halte dich exakt an diese Anzahl.`
      : "Wähle die Anzahl passend zur Länge (kurz → wenige, lang → viele).";

    const jobOptions = (job.options ?? {}) as {
      ai_explain?: boolean;
      audio_fx?: string;
      captions?: boolean;
    };
    const explainHint = jobOptions.ai_explain
      ? "\nZUSATZ: Der Nutzer möchte KI-Erklärungen — schreibe für jedes Segment in 'hook' eine kurze Kontext-Erklärung (1 Satz), die als Overlay eingeblendet wird und dem Zuschauer erklärt, was in der Szene passiert."
      : "";
    const audioFxHint =
      jobOptions.audio_fx && jobOptions.audio_fx !== "none"
        ? `\nAudio-Stil des Projekts: "${jobOptions.audio_fx}" — wähle Schnittpunkte, die zu diesem Stil passen (punchy = schnelle Cuts, cinematic = ruhiger, podcast = an Sprechpausen).`
        : "";

    const prompt = `Du bist ein Profi-Video-Editor. Ein Nutzer hat ein Video hochgeladen:
Titel: "${raw.title}"
Dauer: ${Math.round(dur)}s
Quelle: ${raw.source_url ?? "Upload"}
Schnitt-Modus: ${mode}
${countHint}${explainHint}${audioFxHint}

Erzeuge einen Schnittplan als JSON. Modus-Regeln:
- auto_cut: 1 durchgehender Clip, straffe Cuts, Länge ≈ 70% Original.
- ugc_shorts: vertikale Shorts (je 15-45s) mit starken Hooks.
- long_to_many: Shorts, jeder ein eigenes Thema.
- manual: 3 vernünftige Vorschläge.

Antworte NUR mit JSON, das dieser Struktur folgt:
{
  "transcript_summary": "kurze Zusammenfassung",
  "language": "de" | "en",
  "segments": [{"start_s": 0, "end_s": 15, "title": "Hook", "hook": "…", "captions": "SRT-Text"}]
}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const msg = await res.text();
      await supabase.from("edit_jobs").update({ status: "failed", error: msg }).eq("id", job.id);
      if (res.status === 429) throw new Error("Rate limit — bitte gleich nochmal.");
      if (res.status === 402) throw new Error("KI-Credits aufgebraucht.");
      throw new Error("KI-Analyse fehlgeschlagen: " + msg);
    }
    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content ?? "{}";
    let analysis: Analysis;
    try {
      analysis = JSON.parse(text) as Analysis;
    } catch {
      throw new Error("KI-Antwort war kein gültiges JSON");
    }

    await supabase
      .from("edit_jobs")
      .update({
        status: "ready",
        progress: 100,
        analysis: JSON.parse(JSON.stringify(analysis)),
      })
      .eq("id", job.id);

    return { analysis };
  });
