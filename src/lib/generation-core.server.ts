// ============================================================
// Kern-Logik der Generierungs-Queue (nur Server).
// Wird von der Server-Function (Nutzer-Kontext) UND vom
// pg_cron-Hook (Admin-Kontext) genutzt.
//
// Funktioniert in zwei Stufen:
//  1. Skript + Storyline-Gedächtnis: läuft SOFORT über Lovable AI
//  2. Video/Bild/Face-Swap: läuft automatisch, sobald FAL_KEY
//     als Secret hinterlegt ist (fal.ai Queue-API)
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

const FAL_BASE = "https://queue.fal.run";

// Modell-IDs — via Env überschreibbar, Defaults = günstige Standard-Modelle
function falModels() {
  return {
    video: process.env.FAL_VIDEO_MODEL ?? "fal-ai/kling-video/v2/master/text-to-video",
    image: process.env.FAL_IMAGE_MODEL ?? "fal-ai/flux/schnell",
    faceswap: process.env.FAL_FACESWAP_MODEL ?? "fal-ai/face-swap",
  };
}

export function providerStatus() {
  return {
    fal: !!process.env.FAL_KEY,
    groq: !!process.env.GROQ_API_KEY,
    lovable_ai: !!process.env.LOVABLE_API_KEY,
  };
}

type Script = {
  title: string;
  summary: string;
  video_prompt: string;
  scenes: Array<{ shot: string; description: string; dialog?: string; sound?: string }>;
};

async function callLovableAi(prompt: string): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY fehlt");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`Lovable AI: ${res.status} ${await res.text()}`);
  const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content ?? "{}";
}

// --- fal.ai Queue-API ---------------------------------------

async function falSubmit(model: string, input: Record<string, unknown>): Promise<string> {
  const key = process.env.FAL_KEY!;
  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${key}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`fal submit: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { request_id: string };
  return j.request_id;
}

async function falStatus(model: string, requestId: string): Promise<string> {
  const key = process.env.FAL_KEY!;
  const res = await fetch(`${FAL_BASE}/${model}/requests/${requestId}/status`, {
    headers: { Authorization: `Key ${key}` },
  });
  if (!res.ok) throw new Error(`fal status: ${res.status}`);
  const j = (await res.json()) as { status: string };
  return j.status; // IN_QUEUE | IN_PROGRESS | COMPLETED
}

async function falResult(model: string, requestId: string): Promise<any> {
  const key = process.env.FAL_KEY!;
  const res = await fetch(`${FAL_BASE}/${model}/requests/${requestId}`, {
    headers: { Authorization: `Key ${key}` },
  });
  if (!res.ok) throw new Error(`fal result: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Sucht in beliebigen fal-Ergebnis-Strukturen nach der Medien-URL. */
function extractMediaUrl(result: any): string | null {
  const cands = [
    result?.video?.url,
    result?.output?.video?.url,
    result?.image?.url,
    result?.images?.[0]?.url,
    result?.output?.url,
    result?.url,
  ];
  return cands.find((u) => typeof u === "string" && u.startsWith("http")) ?? null;
}

// --- Skript + Gedächtnis ------------------------------------

async function ensureScript(supabase: any, job: any): Promise<Script | null> {
  const opts = (job.options ?? {}) as Record<string, any>;
  if (opts.script) return opts.script as Script;

  let storylineCtx = "";
  let storyline: any = null;
  if (job.storyline_id) {
    const { data: s } = await supabase
      .from("storylines")
      .select("*")
      .eq("id", job.storyline_id)
      .single();
    storyline = s;
    if (s) {
      const { data: chars } = await supabase
        .from("storyline_characters")
        .select("name,description")
        .eq("storyline_id", s.id);
      const mem = (s.memory ?? {}) as { events?: string[]; facts?: string[] };
      storylineCtx = `
STORYLINE: "${s.title}"
Prämisse: ${s.premise ?? "—"}
Bisherige Episoden: ${s.episode_count}
Charaktere: ${(chars ?? []).map((c: any) => `${c.name} (${c.description ?? "?"})`).join("; ") || "keine"}
Bisherige Ereignisse (Gedächtnis):
${(mem.events ?? []).map((e) => `- ${e}`).join("\n") || "- noch keine"}
Fakten, die konsistent bleiben müssen:
${(mem.facts ?? []).map((f) => `- ${f}`).join("\n") || "- noch keine"}
WICHTIG: Die neue Episode muss zur bisherigen Geschichte passen und sie fortführen.`;
    }
  }

  const durS = opts.duration_s ?? 30;
  const raw = await callLovableAi(`Du bist ein Drehbuch-Autor für KI-generierte Videos.
${storylineCtx}

AUFGABE des Nutzers: ${job.prompt}
Ziel-Dauer: ${durS} Sekunden · Format: ${opts.aspect ?? "9:16"} · Sound: ${opts.sound === false ? "nein" : "ja"}

Erzeuge NUR JSON:
{
  "title": "Episoden-/Szenen-Titel",
  "summary": "2 Sätze: was passiert (für das Story-Gedächtnis)",
  "video_prompt": "Ein dichter englischer Prompt für ein Text-zu-Video-Modell (Kamera, Licht, Aktion, Stil)",
  "scenes": [{"shot": "Shot 1", "description": "…", "dialog": "…", "sound": "…"}],
  "new_facts": ["optional: neue Fakten, die künftig konsistent bleiben müssen"]
}`);

  let script: Script & { new_facts?: string[] };
  try {
    script = JSON.parse(raw);
  } catch {
    throw new Error("Skript-Antwort war kein JSON");
  }

  await supabase
    .from("generation_jobs")
    .update({ options: { ...opts, script } })
    .eq("id", job.id);

  // Story-Gedächtnis fortschreiben
  if (storyline) {
    const mem = (storyline.memory ?? {}) as { events?: string[]; facts?: string[] };
    const nextEp = (storyline.episode_count ?? 0) + 1;
    const events = [
      ...(mem.events ?? []),
      `Episode ${nextEp}: ${script.title} — ${script.summary}`,
    ];
    const facts = [...(mem.facts ?? []), ...(script.new_facts ?? [])];
    await supabase
      .from("storylines")
      .update({ memory: { events, facts }, episode_count: nextEp })
      .eq("id", storyline.id);
  }
  return script;
}

// --- Job-Verarbeitung ---------------------------------------

async function signedUrlFor(supabase: any, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("raw-videos").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

async function processOne(supabase: any, job: any): Promise<string> {
  const status = providerStatus();
  const models = falModels();
  const opts = (job.options ?? {}) as Record<string, any>;

  // ---------- VIDEO / SZENE ----------
  if (job.kind === "video" || job.kind === "scene") {
    // Stufe 1: Skript (läuft immer, sofern Lovable AI da ist)
    let script: Script | null = (opts.script as Script) ?? null;
    if (!script && status.lovable_ai) {
      script = await ensureScript(supabase, job);
    }

    if (!status.fal) {
      await supabase
        .from("generation_jobs")
        .update({ status: "waiting_provider", progress: script ? 40 : 10 })
        .eq("id", job.id);
      return script ? "script_ready" : "waiting";
    }

    // Stufe 2: fal.ai Video
    if (!job.provider_job_id) {
      const reqId = await falSubmit(models.video, {
        prompt: script?.video_prompt ?? job.prompt,
        aspect_ratio: opts.aspect ?? "9:16",
        duration: String(Math.min(10, opts.duration_s ?? 5)),
      });
      await supabase
        .from("generation_jobs")
        .update({ provider: "fal", provider_job_id: reqId, status: "running", progress: 60 })
        .eq("id", job.id);
      return "submitted";
    }

    const st = await falStatus(models.video, job.provider_job_id);
    if (st === "COMPLETED") {
      const result = await falResult(models.video, job.provider_job_id);
      const url = extractMediaUrl(result);
      await supabase
        .from("generation_jobs")
        .update({ status: "done", progress: 100, output_url: url })
        .eq("id", job.id);
      return "done";
    }
    return "running";
  }

  // ---------- MODEL (Mensch/Avatar-Bild) ----------
  if (job.kind === "model") {
    if (!status.fal) {
      await supabase
        .from("generation_jobs")
        .update({ status: "waiting_provider" })
        .eq("id", job.id);
      return "waiting";
    }
    if (!job.provider_job_id) {
      const reqId = await falSubmit(models.image, {
        prompt: `Professional photo of a person: ${job.prompt}. Photorealistic, high quality, neutral background.`,
        image_size: "portrait_4_3",
      });
      await supabase
        .from("generation_jobs")
        .update({ provider: "fal", provider_job_id: reqId, status: "running", progress: 50 })
        .eq("id", job.id);
      return "submitted";
    }
    const st = await falStatus(models.image, job.provider_job_id);
    if (st === "COMPLETED") {
      const result = await falResult(models.image, job.provider_job_id);
      const url = extractMediaUrl(result);
      let imagePath: string | null = null;
      if (url) {
        // Bild in eigenen Storage übernehmen (fal-URLs laufen ab)
        const imgRes = await fetch(url);
        const bytes = new Uint8Array(await imgRes.arrayBuffer());
        imagePath = `${job.user_id}/${job.brand_id}/avatars/gen-${job.id}.jpg`;
        await supabase.storage
          .from("raw-videos")
          .upload(imagePath, bytes, { contentType: "image/jpeg", upsert: true });
      }
      await supabase.from("avatar_models").insert({
        user_id: job.user_id,
        brand_id: job.brand_id,
        name: opts.name ?? job.prompt.slice(0, 40),
        kind: "generated",
        prompt: job.prompt,
        image_path: imagePath,
        meta: { source_url: url },
      });
      await supabase
        .from("generation_jobs")
        .update({ status: "done", progress: 100, output_url: url, output_path: imagePath })
        .eq("id", job.id);
      return "done";
    }
    return "running";
  }

  // ---------- OVERLAP (Face-/Body-Swap) ----------
  if (job.kind === "overlap") {
    if (!status.fal) {
      await supabase
        .from("generation_jobs")
        .update({ status: "waiting_provider" })
        .eq("id", job.id);
      return "waiting";
    }
    if (!job.provider_job_id) {
      const { data: video } = await supabase
        .from("raw_videos")
        .select("storage_path")
        .eq("id", job.raw_video_id)
        .single();
      const { data: avatar } = await supabase
        .from("avatar_models")
        .select("image_path,meta")
        .eq("id", job.avatar_model_id)
        .single();
      if (!video?.storage_path) throw new Error("Video hat keine Datei (erst hochladen)");
      const videoUrl = await signedUrlFor(supabase, video.storage_path);
      const imageUrl = avatar?.image_path
        ? await signedUrlFor(supabase, avatar.image_path)
        : ((avatar?.meta as any)?.source_url ?? null);
      if (!videoUrl || !imageUrl) throw new Error("Video- oder Model-Bild-URL fehlt");

      const reqId = await falSubmit(models.faceswap, {
        video_url: videoUrl,
        image_url: imageUrl,
      });
      await supabase
        .from("generation_jobs")
        .update({ provider: "fal", provider_job_id: reqId, status: "running", progress: 50 })
        .eq("id", job.id);
      return "submitted";
    }
    const st = await falStatus(models.faceswap, job.provider_job_id);
    if (st === "COMPLETED") {
      const result = await falResult(models.faceswap, job.provider_job_id);
      const url = extractMediaUrl(result);
      await supabase
        .from("generation_jobs")
        .update({ status: "done", progress: 100, output_url: url })
        .eq("id", job.id);
      return "done";
    }
    return "running";
  }

  return "skipped";
}

export async function processJobs(
  supabase: any,
  jobs: any[],
): Promise<Array<{ id: string; result: string }>> {
  const out: Array<{ id: string; result: string }> = [];
  for (const job of jobs) {
    try {
      out.push({ id: job.id, result: await processOne(supabase, job) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unbekannter Fehler";
      await supabase
        .from("generation_jobs")
        .update({ status: "failed", error: msg })
        .eq("id", job.id);
      out.push({ id: job.id, result: `failed: ${msg}` });
    }
  }
  return out;
}
