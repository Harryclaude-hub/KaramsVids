import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Download, Play, Scissors, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Segment = { start_s: number; end_s: number; title: string; hook?: string; captions?: string };
type Analysis = { transcript_summary?: string; language?: string; segments: Segment[] };

export const Route = createFileRoute("/_authenticated/app/job/$id")({
  component: JobEditor,
});

function JobEditor() {
  const { id } = Route.useParams();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const ffmpegRef = useRef<any>(null);

  const jobQ = useQuery({
    queryKey: ["edit_job", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("edit_jobs").select("*, raw_videos(*)").eq("id", id).single();
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => (q.state.data?.status === "analyzing" ? 2000 : false),
  });

  const job = jobQ.data;
  const raw = job?.raw_videos as { title: string; storage_path: string | null } | undefined;
  const analysis = (job?.analysis as unknown as Analysis | null) ?? null;

  useEffect(() => {
    if (!raw?.storage_path) return;
    supabase.storage.from("raw-videos").createSignedUrl(raw.storage_path, 3600).then(({ data }) => {
      if (data?.signedUrl) setSignedUrl(data.signedUrl);
    });
  }, [raw?.storage_path]);

  async function getFFmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ff = new FFmpeg();
    const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    ff.on("progress", ({ progress }) => setProgress(Math.round(progress * 100)));
    await ff.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegRef.current = ff;
    return ff;
  }

  async function renderSegment(seg: Segment, idx: number) {
    if (!signedUrl) { toast.error("Video-URL fehlt"); return; }
    setRendering(String(idx));
    setProgress(0);
    try {
      const ff = await getFFmpeg();
      const { fetchFile } = await import("@ffmpeg/util");
      await ff.writeFile("in.mp4", await fetchFile(signedUrl));
      const duration = Math.max(1, seg.end_s - seg.start_s);
      await ff.exec([
        "-ss", String(seg.start_s),
        "-i", "in.mp4",
        "-t", String(duration),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-c:a", "aac",
        "out.mp4",
      ]);
      const data = await ff.readFile("out.mp4");
      const blob = new Blob([data], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      setOutputs((o) => ({ ...o, [idx]: url }));
      toast.success(`Clip ${idx + 1} fertig`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Render fehlgeschlagen");
    } finally {
      setRendering(null);
      setProgress(0);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Link to="/app" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> Dashboard</Link>

      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Editor</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{raw?.title ?? "Job"}</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">Modus: {job?.mode} · Status: {job?.status}</p>
      </div>

      {job?.status === "analyzing" && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> KI analysiert dein Video…
        </div>
      )}
      {job?.status === "failed" && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Analyse fehlgeschlagen: {job.error}
        </div>
      )}

      {analysis && (
        <>
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="text-sm font-medium">Zusammenfassung</div>
            <p className="mt-2 text-sm text-muted-foreground">{analysis.transcript_summary}</p>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Scissors className="h-4 w-4 text-primary" /> Vorgeschlagene Clips ({analysis.segments?.length ?? 0})</div>
            <div className="space-y-3">
              {analysis.segments?.map((s, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{s.title}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{s.start_s.toFixed(1)}s → {s.end_s.toFixed(1)}s</div>
                      {s.hook && <div className="mt-2 text-xs text-muted-foreground">"{s.hook}"</div>}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <button onClick={() => renderSegment(s, i)} disabled={rendering !== null} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                        {rendering === String(i) ? <><Loader2 className="h-3 w-3 animate-spin" /> {progress}%</> : <><Play className="h-3 w-3" /> Rendern</>}
                      </button>
                      {outputs[i] && (
                        <a href={outputs[i]} download={`clip-${i + 1}.mp4`} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary">
                          <Download className="h-3 w-3" /> Download
                        </a>
                      )}
                    </div>
                  </div>
                  {outputs[i] && <video src={outputs[i]} controls className="mt-3 aspect-video w-full rounded-lg bg-black" />}
                </div>
              ))}
            </div>
            <p className="mt-4 font-mono text-[10px] text-muted-foreground">Der Schnitt läuft im Browser (ffmpeg.wasm). Für lange Videos kann das Rendern etwas dauern.</p>
          </div>
        </>
      )}
    </div>
  );
}
