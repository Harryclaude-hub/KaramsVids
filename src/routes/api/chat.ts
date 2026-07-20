import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json()) as { messages: UIMessage[]; jobId?: string };
        if (!body.jobId || !Array.isArray(body.messages)) {
          return new Response("Bad request", { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabasePub = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const isSbKey = supabasePub.startsWith("sb_");
        const supabase = createClient(supabaseUrl, supabasePub, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) => {
              const h = new Headers(init?.headers);
              h.set("Authorization", `Bearer ${token}`);
              if (isSbKey) h.set("apikey", supabasePub);
              return fetch(input, { ...init, headers: h });
            },
          },
        });

        const { data: userData } = await supabase.auth.getUser(token);
        if (!userData.user) return new Response("Unauthorized", { status: 401 });

        const { data: job, error: jobErr } = await supabase
          .from("edit_jobs")
          .select("id, analysis, options, style_reference, raw_videos(title, duration_s, source_url)")
          .eq("id", body.jobId)
          .single();
        if (jobErr || !job) return new Response("Job not found", { status: 404 });

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        const gateway = createLovableAiGatewayProvider(key);

        const analysis = ((job.analysis as unknown) ?? { segments: [] }) as {
          segments: Array<{ start_s: number; end_s: number; title: string; hook?: string; captions?: string }>;
          [k: string]: unknown;
        };
        if (!Array.isArray(analysis.segments)) analysis.segments = [];
        let options = ((job.options as Record<string, unknown>) ?? {}) as Record<string, unknown>;

        async function persistAnalysis() {
          await supabase.from("edit_jobs").update({ analysis: analysis as unknown as never }).eq("id", body.jobId!);
        }
        async function persistOptions() {
          await supabase.from("edit_jobs").update({ options: options as unknown as never }).eq("id", body.jobId!);
        }

        const tools = {
          list_clips: tool({
            description: "Zeigt die aktuellen Clips (Segmente) mit Index, Start/Ende, Titel, Hook.",
            inputSchema: z.object({}),
            execute: async () => ({ segments: analysis.segments }),
          }),
          add_clip: tool({
            description: "Fügt einen neuen Clip hinzu.",
            inputSchema: z.object({
              start_s: z.number(),
              end_s: z.number(),
              title: z.string(),
              hook: z.string().optional(),
              captions: z.string().optional(),
            }),
            execute: async (args) => {
              analysis.segments.push(args);
              await persistAnalysis();
              return { ok: true, count: analysis.segments.length };
            },
          }),
          update_clip: tool({
            description: "Aktualisiert Felder eines Clips per Index (0-basiert).",
            inputSchema: z.object({
              index: z.number().int().min(0),
              start_s: z.number().optional(),
              end_s: z.number().optional(),
              title: z.string().optional(),
              hook: z.string().optional(),
              captions: z.string().optional(),
            }),
            execute: async ({ index, ...patch }) => {
              const seg = analysis.segments[index];
              if (!seg) return { ok: false, error: "Index out of range" };
              const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
              analysis.segments[index] = { ...seg, ...cleaned };
              await persistAnalysis();
              return { ok: true, clip: analysis.segments[index] };
            },
          }),
          delete_clip: tool({
            description: "Löscht einen Clip per Index.",
            inputSchema: z.object({ index: z.number().int().min(0) }),
            execute: async ({ index }) => {
              if (!analysis.segments[index]) return { ok: false };
              analysis.segments.splice(index, 1);
              await persistAnalysis();
              return { ok: true, count: analysis.segments.length };
            },
          }),
          reorder_clips: tool({
            description: "Ordnet Clips neu — 'order' ist ein Array alter Indizes in neuer Reihenfolge.",
            inputSchema: z.object({ order: z.array(z.number().int().min(0)) }),
            execute: async ({ order }) => {
              const next = order.map((i) => analysis.segments[i]).filter(Boolean);
              if (next.length === 0) return { ok: false };
              analysis.segments = next;
              await persistAnalysis();
              return { ok: true, count: analysis.segments.length };
            },
          }),
          set_aspect: tool({
            description: "Setzt das Ausgabeformat (9:16 vertikal, 16:9 landscape, 1:1 quadratisch).",
            inputSchema: z.object({ aspect: z.enum(["9:16", "16:9", "1:1"]) }),
            execute: async ({ aspect }) => {
              options = { ...options, aspect };
              await persistOptions();
              return { ok: true, aspect };
            },
          }),
          set_captions_style: tool({
            description: "Setzt den Untertitel-Stil (none, burned_bottom, burned_center, karaoke).",
            inputSchema: z.object({ style: z.enum(["none", "burned_bottom", "burned_center", "karaoke"]) }),
            execute: async ({ style }) => {
              options = { ...options, caption_style: style };
              await persistOptions();
              return { ok: true, style };
            },
          }),
          generate_captions_for_all: tool({
            description: "Setzt Untertitel-Vorschläge für alle Clips (nutzt Hook/Titel als Basis).",
            inputSchema: z.object({ language: z.string().optional() }),
            execute: async ({ language }) => {
              const lang = language ?? (analysis as { language?: string }).language ?? "de";
              analysis.segments = analysis.segments.map((s) => ({
                ...s,
                captions: s.captions ?? `[${lang}] ${s.hook ?? s.title}`,
              }));
              await persistAnalysis();
              return { ok: true, count: analysis.segments.length };
            },
          }),
          trim_all_to_length: tool({
            description: "Kürzt alle Clips, die länger als max_seconds sind, auf max_seconds ab dem Startpunkt.",
            inputSchema: z.object({ max_seconds: z.number().min(1).max(120) }),
            execute: async ({ max_seconds }) => {
              let trimmed = 0;
              analysis.segments = analysis.segments.map((s) => {
                if (s.end_s - s.start_s > max_seconds) {
                  trimmed++;
                  return { ...s, end_s: s.start_s + max_seconds };
                }
                return s;
              });
              await persistAnalysis();
              return { ok: true, trimmed };
            },
          }),
          split_clip: tool({
            description: "Teilt einen Clip an einem Zeitpunkt in zwei.",
            inputSchema: z.object({ index: z.number().int().min(0), at_s: z.number() }),
            execute: async ({ index, at_s }) => {
              const seg = analysis.segments[index];
              if (!seg || at_s <= seg.start_s || at_s >= seg.end_s) return { ok: false };
              const a = { ...seg, end_s: at_s, title: `${seg.title} (1)` };
              const b = { ...seg, start_s: at_s, title: `${seg.title} (2)` };
              analysis.segments.splice(index, 1, a, b);
              await persistAnalysis();
              return { ok: true };
            },
          }),
          apply_style_reference: tool({
            description: "Wendet den zuletzt analysierten Referenz-Stil auf alle Clips an. Vorher muss ein Referenzvideo analysiert worden sein.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data: fresh } = await supabase
                .from("edit_jobs").select("style_reference").eq("id", body.jobId!).single();
              const style = fresh?.style_reference as Record<string, unknown> | null;
              if (!style) return { ok: false, error: "Kein Referenz-Stil vorhanden. Bitte zuerst ein Referenzvideo hochladen und analysieren." };
              const target = Math.max(5, Math.min(60, Number(style.avg_clip_length_s ?? 20)));
              analysis.segments = analysis.segments.map((s) => {
                const dur = s.end_s - s.start_s;
                const end_s = dur > target * 1.5 ? s.start_s + target : s.end_s;
                return {
                  ...s,
                  end_s,
                  captions: s.captions ?? (typeof style.caption_style_example === "string" ? style.caption_style_example : undefined),
                };
              });
              if (typeof style.aspect === "string") {
                options = { ...options, aspect: style.aspect };
                await persistOptions();
              }
              await persistAnalysis();
              return { ok: true, applied: style };
            },
          }),
        };

        const raw = job.raw_videos as { title?: string; duration_s?: number | null } | null;
        const system = `Du bist der KI-Video-Editor von VideoCraft. Der Nutzer bearbeitet gerade das Video "${raw?.title ?? "Video"}" (Dauer ${raw?.duration_s ?? "?"}s).
Aktuelle Clips: ${JSON.stringify(analysis.segments)}
Optionen: ${JSON.stringify(options)}
Referenz-Stil vorhanden: ${job.style_reference ? "ja" : "nein"}

Arbeitsweise:
- Antworte auf Deutsch, kurz und konkret.
- Für jede Änderung: sag in einem Satz was du tust, dann rufe das passende Tool.
- Nach jeder Änderung: nenne kurz die Auswirkung ("Clip 2 auf 12s gekürzt").
- Nutze Tools, statt nur zu beschreiben. Der Nutzer will Ergebnisse.
- Rendering-Grenzen (ehrlich sagen): möglich sind Cuts, Trim/Split, Reorder, Aspect-Crop, eingebrannte Untertitel. Nicht möglich (rendert nicht): 3D-Übergänge, Farbkorrektur-LUTs, Motion Graphics. Plane die trotzdem, damit später ein Render-Backend sie ausführen kann.
- Wenn nach Style-Copy gefragt: prüfe ob ein Referenzvideo vorhanden ist, sonst bitte um Upload/Link, dann rufe apply_style_reference.`;

        const result = streamText({
          model: gateway("openai/gpt-5.5"),
          system,
          messages: await convertToModelMessages(body.messages),
          tools,
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages,
          onFinish: async ({ messages }) => {
            try {
              await supabase.from("edit_jobs").update({ chat_messages: messages as unknown as never }).eq("id", body.jobId!);
            } catch (e) {
              console.error("chat persist failed", e);
            }
          },
        });
      },
    },
  },
});
