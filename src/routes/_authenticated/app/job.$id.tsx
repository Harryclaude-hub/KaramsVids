import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Download, Play, Scissors, Loader2, Plus, Trash2, RotateCcw, Sparkles, Languages } from "lucide-react";
import { toast } from "sonner";

type Segment = { start_s: number; end_s: number; title: string; hook?: string; captions?: string };
type Analysis = { transcript_summary?: string; language?: string; segments: Segment[] };

export const Route = createFileRoute("/_authenticated/app/job/$id")({
  component: JobEditor,
});

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(1);
  return `${m}:${sec.padStart(4, "0")}`;
}

function JobEditor() {
  const { id } = Route.useParams();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [selected, setSelected] = useState<number>(0);
  const originalRef = useRef<Segment[] | null>(null);
  const ffmpegRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
  const raw = job?.raw_videos as { title: string; storage_path: string | null; duration_s: number | null } | undefined;
  const analysis = (job?.analysis as unknown as Analysis | null) ?? null;
  const options = (job?.options ?? {}) as { aspect?: string; captions?: boolean };
  const vertical = options.aspect === "9:16";

  useEffect(() => {
    if (analysis?.segments && !segments) {
      setSegments(analysis.segments.map((s) => ({ ...s })));
      originalRef.current = analysis.segments.map((s) => ({ ...s }));
    }
  }, [analysis, segments]);

  useEffect(() => {
    if (!raw?.storage_path) return;
    supabase.storage.from("raw-videos").createSignedUrl(raw.storage_path, 3600).then(({ data }) => {
      if (data?.signedUrl) setSignedUrl(data.signedUrl);
    });
  }, [raw?.storage_path]);

  const totalDur = raw?.duration_s ? Number(raw.duration_s) : 300;

  function updateSeg(idx: number, patch: Partial<Segment>) {
    setSegments((prev) => prev?.map((s, i) => (i === idx ? { ...s, ...patch } : s)) ?? null);
  }
  function deleteSeg(idx: number) {
    setSegments((prev) => prev?.filter((_, i) => i !== idx) ?? null);
    setOutputs((o) => { const c = { ...o }; delete c[idx]; return c; });
    if (selected >= idx) setSelected(Math.max(0, selected - 1));
  }
  function addSeg() {
    const last = segments?.[segments.length - 1];
    const start = last ? Math.min(last.end_s, totalDur - 5) : 0;
    const end = Math.min(start + 15, totalDur);
    setSegments((prev) => [...(prev ?? []), { start_s: start, end_s: end, title: "Neuer Clip", hook: "" }]);
  }
  function resetSeg(idx: number) {
    const orig = originalRef.current?.[idx];
    if (orig) updateSeg(idx, orig);
    else toast.info("Kein KI-Original für diesen Clip");
  }

  async function getFFmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ff = new FFmpeg();
    const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    ff.on("progress", ({ progress }: { progress: number }) => setProgress(Math.round(progress * 100)));
    await ff.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegRef.current = ff;
    return ff;
  }

  async function renderSegment(seg: Segment, idx: number) {
    if (!signedUrl) { toast.error("Video-URL fehlt"); return; }
    if (seg.end_s <= seg.start_s) { toast.error("Endzeit muss nach Startzeit liegen"); return; }
    setRendering(String(idx));
    setProgress(0);
    try {
      const ff = await getFFmpeg();
      const { fetchFile } = await import("@ffmpeg/util");
      await ff.writeFile("in.mp4", await fetchFile(signedUrl));
      const duration = Math.max(0.5, seg.end_s - seg.start_s);
      const args = [
        "-ss", String(seg.start_s),
        "-i", "in.mp4",
        "-t", String(duration),
      ];
      if (vertical) {
        args.push("-vf", "crop=ih*9/16:ih,scale=1080:1920");
      }
      args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac", "out.mp4");
      await ff.exec(args);
      const data = await ff.readFile("out.mp4");
      const blob = new Blob([data as BlobPart], { type: "video/mp4" });
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

  async function renderAll() {
    if (!segments) return;
    for (let i = 0; i < segments.length; i++) {
      if (!outputs[i]) await renderSegment(segments[i], i);
    }
  }

  function jumpTo(t: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      videoRef.current.play().catch(() => {});
    }
  }

  const selectedSeg = segments?.[selected];
  const dirty = useMemo(() => {
    if (!segments || !originalRef.current) return false;
    return JSON.stringify(segments) !== JSON.stringify(originalRef.current);
  }, [segments]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to="/app" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> Dashboard</Link>

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Editor</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{raw?.title ?? "Job"}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Modus: {job?.mode} · Status: {job?.status} · Format: {vertical ? "9:16 Vertical" : "16:9"} {dirty && <span className="ml-2 text-primary">· manuell bearbeitet</span>}
          </p>
        </div>
        {analysis && segments && segments.length > 0 && (
          <button onClick={renderAll} disabled={rendering !== null} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            <Sparkles className="h-4 w-4" /> Alle rendern
          </button>
        )}
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

      {analysis && segments && (
        <>
          {/* KI-Transparenz */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Was die KI gemacht hat</div>
              {analysis.language && (
                <div className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground">
                  <Languages className="h-3 w-3" /> {analysis.language}
                </div>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{analysis.transcript_summary}</p>
            <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-foreground font-medium">{originalRef.current?.length ?? 0} Segmente erkannt</div>
                <div className="mt-1">basierend auf Titel, Dauer & Modus</div>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-foreground font-medium">Hooks generiert</div>
                <div className="mt-1">für jeden Clip ein Aufhänger</div>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-foreground font-medium">{vertical ? "Vertical Crop 9:16" : "Landscape 16:9"}</div>
                <div className="mt-1">Ausgabeformat beim Rendern</div>
              </div>
            </div>
          </div>

          {/* Player + Timeline */}
          <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
            <div className="space-y-3">
              <div className="overflow-hidden rounded-2xl border border-border bg-black">
                {signedUrl ? (
                  <video ref={videoRef} src={signedUrl} controls className="aspect-video w-full" />
                ) : (
                  <div className="grid aspect-video place-items-center"><Play className="h-10 w-10 text-muted-foreground" /></div>
                )}
              </div>

              {/* Timeline */}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Timeline · {fmt(totalDur)}</span>
                  <button onClick={addSeg} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-secondary">
                    <Plus className="h-3 w-3" /> Segment
                  </button>
                </div>
                <div className="relative h-10 rounded-md bg-background border border-border overflow-hidden">
                  {segments.map((s, i) => {
                    const left = (s.start_s / totalDur) * 100;
                    const width = Math.max(0.5, ((s.end_s - s.start_s) / totalDur) * 100);
                    return (
                      <button
                        key={i}
                        onClick={() => { setSelected(i); jumpTo(s.start_s); }}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        className={`absolute top-1 bottom-1 rounded-sm border transition ${
                          selected === i
                            ? "bg-primary/70 border-primary text-primary-foreground"
                            : "bg-primary/20 border-primary/40 hover:bg-primary/30"
                        }`}
                        title={s.title}
                      >
                        <span className="block truncate px-1 text-[10px] font-mono leading-8">{i + 1}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected segment editor */}
              {selectedSeg && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Clip {selected + 1} bearbeiten</div>
                    <div className="flex gap-2">
                      <button onClick={() => resetSeg(selected)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary">
                        <RotateCcw className="h-3 w-3" /> KI-Original
                      </button>
                      <button onClick={() => deleteSeg(selected)} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-3 w-3" /> Löschen
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs">
                      <span className="text-muted-foreground">Titel</span>
                      <input value={selectedSeg.title} onChange={(e) => updateSeg(selected, { title: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary" />
                    </label>
                    <label className="block text-xs">
                      <span className="text-muted-foreground">Hook</span>
                      <input value={selectedSeg.hook ?? ""} onChange={(e) => updateSeg(selected, { hook: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary" />
                    </label>
                    <label className="block text-xs">
                      <span className="text-muted-foreground">Start (s)</span>
                      <div className="mt-1 flex gap-1">
                        <input type="number" min={0} max={totalDur} step={0.1} value={selectedSeg.start_s} onChange={(e) => updateSeg(selected, { start_s: Math.max(0, Number(e.target.value)) })} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary" />
                        <button onClick={() => updateSeg(selected, { start_s: videoRef.current?.currentTime ?? selectedSeg.start_s })} className="rounded-md border border-border px-2 text-xs hover:bg-secondary" title="Aktuellen Zeitpunkt als Start setzen">jetzt</button>
                      </div>
                    </label>
                    <label className="block text-xs">
                      <span className="text-muted-foreground">Ende (s)</span>
                      <div className="mt-1 flex gap-1">
                        <input type="number" min={0} max={totalDur} step={0.1} value={selectedSeg.end_s} onChange={(e) => updateSeg(selected, { end_s: Math.max(0, Number(e.target.value)) })} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary" />
                        <button onClick={() => updateSeg(selected, { end_s: videoRef.current?.currentTime ?? selectedSeg.end_s })} className="rounded-md border border-border px-2 text-xs hover:bg-secondary" title="Aktuellen Zeitpunkt als Ende setzen">jetzt</button>
                      </div>
                    </label>
                  </div>
                  <label className="block text-xs">
                    <span className="text-muted-foreground">Untertitel / Notizen</span>
                    <textarea rows={3} value={selectedSeg.captions ?? ""} onChange={(e) => updateSeg(selected, { captions: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary" />
                  </label>
                  <div className="flex items-center justify-between pt-2">
                    <div className="font-mono text-[10px] text-muted-foreground">Dauer: {(selectedSeg.end_s - selectedSeg.start_s).toFixed(1)}s</div>
                    <button onClick={() => renderSegment(selectedSeg, selected)} disabled={rendering !== null} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                      {rendering === String(selected) ? <><Loader2 className="h-3 w-3 animate-spin" /> Rendere… {progress}%</> : <><Play className="h-3 w-3" /> Diesen Clip rendern</>}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Segment list / ready to publish */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Scissors className="h-4 w-4 text-primary" /> Clips ({segments.length})</div>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {segments.map((s, i) => (
                  <div
                    key={i}
                    onClick={() => { setSelected(i); jumpTo(s.start_s); }}
                    className={`cursor-pointer rounded-xl border p-3 transition ${selected === i ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{i + 1}. {s.title}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{fmt(s.start_s)} → {fmt(s.end_s)} · {(s.end_s - s.start_s).toFixed(1)}s</div>
                        {s.hook && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">"{s.hook}"</div>}
                      </div>
                      {outputs[i] && (
                        <a onClick={(e) => e.stopPropagation()} href={outputs[i]} download={`clip-${i + 1}.mp4`} className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-secondary">
                          <Download className="h-3 w-3" /> MP4
                        </a>
                      )}
                    </div>
                    {outputs[i] && <video src={outputs[i]} controls className="mt-2 w-full rounded-md bg-black" />}
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                Rendering läuft im Browser (ffmpeg.wasm). Fertige Clips kannst du direkt herunterladen und auf TikTok, YouTube, Reels & Co. hochladen — offizielle API-Uploads folgen, sobald deine Developer-Keys vorliegen.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
