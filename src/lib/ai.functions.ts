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

type JobRow = {
  id: string;
  mode: string;
  options: unknown;
  raw_videos: { title: string; duration_s: number | null; source_url: string | null };
};

type SupabaseLike = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * Übergibt den Auftrag an den lokalen Worker (worker/, siehe docs/WORKER.md).
 *
 * Die Web-App läuft auf Cloudflare Workers ohne ffmpeg und ohne Python. Das
 * echte Schneiden (Transkript mit Wort-Zeitmarken, Auswahl der Stellen,
 * Hochformat-Render mit Untertiteln) macht deshalb ein Worker auf dem Rechner
 * des Besitzers. Hier wird nur der Auftrag markiert:
 *   status = analyzing, progress = 0, options.engine = worker, options.worker_id = null
 * Der Worker holt sich Aufträge mit engine=worker und leerem worker_id, setzt
 * worker_id (beansprucht), schreibt progress 5/20/50/70/95/100, analysis und
 * generated_clips, am Ende status = done (oder failed + error).
 *
 * Der alte Ratemodus (Gemini rät Schnittpunkte nur aus Titel und Dauer, ohne
 * das Video je gesehen zu haben) bleibt als Notnagel hinter
 * CLIPPING_ENGINE=guess erhalten, z. B. wenn der Worker-Rechner länger aus ist.
 * Standard ist worker.
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

    if (process.env.CLIPPING_ENGINE === "guess") {
      return guessAnalysisWithoutAudio(supabase, job as unknown as JobRow, data.desiredClipCount ?? null);
    }

    const options = ((job.options ?? {}) as Record<string, unknown>) ?? {};
    const desired = data.desiredClipCount ?? (job.desired_clip_count as number | null) ?? null;

    const { error: updErr } = await supabase
      .from("edit_jobs")
      .update({
        status: "analyzing",
        progress: 0,
        error: null,
        analysis: null,
        desired_clip_count: desired,
        options: {
          ...options,
          engine: "worker",
          desired_clip_count: desired,
          // leer = noch von keinem Worker beansprucht (auch bei erneutem Anstoßen)
          worker_id: null,
          worker_phase: "queued",
          queued_at: new Date().toISOString(),
        },
      })
      .eq("id", job.id);
    if (updErr) throw new Error("Auftrag konnte nicht an den Worker übergeben werden: " + updErr.message);

    return { analysis: null as Analysis | null, engine: "worker" as const, queued: true };
  });

/**
 * NOTNAGEL, nur aktiv mit CLIPPING_ENGINE=guess.
 *
 * Rät einen Schnittplan allein aus Titel, Dauer und Modus per Lovable AI
 * (Gemini), ohne Audio, ohne Transkript. Die Schnittpunkte treffen deshalb
 * keine Satzgrenzen und die "Untertitel" sind erfunden. Brauchbar nur, um
 * dem Editor überhaupt Segmente zu geben, wenn kein Worker erreichbar ist.
 * Der Worker-Pfad oben ist der Normalfall.
 */
async function guessAnalysisWithoutAudio(
  supabase: SupabaseLike,
  job: JobRow,
  desiredClipCount: number | null,
): Promise<{ analysis: Analysis | null; engine: "guess"; queued: boolean }> {
  await supabase.from("edit_jobs").update({ status: "analyzing", progress: 10 }).eq("id", job.id);

  const raw = job.raw_videos;
  const dur = raw.duration_s ?? 60;
  const mode = job.mode;

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY fehlt");

  if (desiredClipCount) {
    await supabase
      .from("edit_jobs")
      .update({ desired_clip_count: desiredClipCount })
      .eq("id", job.id);
  }
  const countHint = desiredClipCount
    ? `WICHTIG: Der Nutzer möchte GENAU ${desiredClipCount} Clips, halte dich exakt an diese Anzahl.`
    : "Wähle die Anzahl passend zur Länge (kurz: wenige, lang: viele).";

  const jobOptions = (job.options ?? {}) as {
    ai_explain?: boolean;
    audio_fx?: string;
    captions?: boolean;
  };
  const explainHint = jobOptions.ai_explain
    ? "\nZUSATZ: Der Nutzer möchte KI-Erklärungen. Schreibe für jedes Segment in 'hook' eine kurze Kontext-Erklärung (1 Satz), die als Overlay eingeblendet wird und dem Zuschauer erklärt, was in der Szene passiert."
    : "";
  const audioFxHint =
    jobOptions.audio_fx && jobOptions.audio_fx !== "none"
      ? `\nAudio-Stil des Projekts: "${jobOptions.audio_fx}". Wähle Schnittpunkte, die zu diesem Stil passen (punchy = schnelle Cuts, cinematic = ruhiger, podcast = an Sprechpausen).`
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
    if (res.status === 429) throw new Error("Rate limit, bitte gleich nochmal.");
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

  // Massen-Clipping: bei hohen Stückzahlen liefert das Modell oft weniger
  // Segmente als gewünscht. Auf die exakte Anzahl auffüllen bzw. kürzen,
  // damit aus einem Link garantiert 10/50/100 Clips entstehen.
  const want = desiredClipCount ?? 0;
  const segs = Array.isArray(analysis.segments) ? analysis.segments : [];
  if (want > 0) {
    const clean = segs
      .filter((s) => Number.isFinite(s?.start_s) && Number.isFinite(s?.end_s) && s.end_s > s.start_s)
      .slice(0, want);
    if (clean.length < want) {
      const missing = want - clean.length;
      const slot = Math.max(8, Math.min(60, dur / want));
      for (let i = 0; i < missing; i++) {
        const start = Math.min(dur - slot, ((clean.length + i) * slot) % Math.max(slot, dur - slot));
        const src = segs[i % Math.max(1, segs.length)];
        clean.push({
          start_s: Math.max(0, Number(start.toFixed(2))),
          end_s: Number(Math.min(dur, start + slot).toFixed(2)),
          title: `${raw.title}: Clip ${clean.length + i + 1}`,
          hook: src?.hook ?? "Automatisch gesetzter Clip",
        });
      }
    }
    analysis.segments = clean;
  }

  await supabase
    .from("edit_jobs")
    .update({
      status: "ready",
      progress: 100,
      analysis: JSON.parse(JSON.stringify(analysis)),
    })
    .eq("id", job.id);

  return { analysis, engine: "guess", queued: false };
}
