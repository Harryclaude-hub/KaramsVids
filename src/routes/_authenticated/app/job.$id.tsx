import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft,
  Download,
  Play,
  Pause,
  Loader2,
  Plus,
  Trash2,
  RotateCcw,
  Sparkles,
  ListPlus,
  CheckCircle2,
  Type,
  Music,
  Film,
  Scissors as ScissorsIcon,
  ZoomIn,
  ZoomOut,
  UploadCloud,
  Volume2,
  VolumeX,
  ChevronRight,
  Wand2,
  Maximize,
  Minimize,
  Library,
  Sliders,
  MessageSquare,
  LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";
import { EditorChat } from "@/components/editor-chat";
import type { UIMessage } from "ai";
import type {
  Segment,
  Transition,
  TextOverlay,
  AudioTrack,
  TransitionType,
} from "@/lib/editor-types";
import { MUSIC_LIBRARY, type ViralTrack } from "@/lib/music-library";
import { templateById } from "@/lib/clip-templates";

type Analysis = { transcript_summary?: string; language?: string; segments: Segment[] };

export const Route = createFileRoute("/_authenticated/app/job/$id")({
  component: JobEditor,
});

const TRACK_H = 56;
const PX_PER_S_MIN = 8;
const PX_PER_S_MAX = 80;

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(1);
  return `${m}:${sec.padStart(4, "0")}`;
}

function uid() {
  return crypto.randomUUID();
}

function JobEditor() {
  const { id } = Route.useParams();
  const { user } = Route.useRouteContext();

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [audioSignedUrls, setAudioSignedUrls] = useState<Record<string, string>>({});

  const originalSegsRef = useRef<Segment[] | null>(null);
  const [selectedClip, setSelectedClip] = useState<number>(0);
  const [zoom, setZoom] = useState(20); // px per s
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [rendering, setRendering] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  // KI-Autopilot: KI übernimmt den ganzen Prozess (analysieren → alle Clips rendern),
  // der Mensch kann davor/danach jederzeit manuell eingreifen.
  const [autopilot, setAutopilot] = useState<"idle" | "analyzing" | "rendering" | "done">("idle");
  const [apProgress, setApProgress] = useState({ current: 0, total: 0 });
  const outputBlobs = useRef<Record<string, Blob>>({});
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<Record<string, string>>({});
  const [queuing, setQueuing] = useState<string | null>(null);
  const [targetPlatform, setTargetPlatform] = useState<string>("");
  const [ytImporting, setYtImporting] = useState(false);
  const [ytImportError, setYtImportError] = useState<string | null>(null);

  // Layout: jedes Feature einzeln ein-/ausklappbar (in localStorage gemerkt)
  type PanelKey = "library" | "media" | "effects" | "inspector" | "chat" | "clipStrip" | "timeline";
  const PANEL_LS_KEY = "vc:editorPanels";
  const [panels, setPanels] = useState<Record<PanelKey, boolean>>(() => {
    const defaults: Record<PanelKey, boolean> = {
      library: false,
      media: true,
      effects: true,
      inspector: true,
      chat: true,
      clipStrip: true,
      timeline: true,
    };
    if (typeof window === "undefined") return defaults;
    try {
      const saved = window.localStorage.getItem(PANEL_LS_KEY);
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  });
  function togglePanel(key: PanelKey) {
    setPanels((p) => {
      const next = { ...p, [key]: !p[key] };
      try {
        window.localStorage.setItem(PANEL_LS_KEY, JSON.stringify(next));
      } catch {
        /* localStorage nicht verfügbar — Einstellung gilt nur für diese Sitzung */
      }
      return next;
    });
  }
  const showLeft = panels.library || panels.media || panels.effects;
  const showRight = panels.inspector || panels.chat;
  const [fullscreen, setFullscreen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await shellRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* Browser verweigert Vollbild — Panels-Toggle bleibt als Fallback */
    }
  }
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const ffmpegRef = useRef<any>(null);
  const inputLoadedRef = useRef<string | null>(null); // signedUrl, deren Datei bereits in ffmpeg liegt
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const jobQ = useQuery({
    queryKey: ["edit_job", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("edit_jobs")
        .select("*, raw_videos(*)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => (q.state.data?.status === "analyzing" ? 2000 : false),
  });

  const job = jobQ.data;
  const raw = job?.raw_videos as
    | {
        title: string;
        storage_path: string | null;
        duration_s: number | null;
        brand_id: string | null;
        platform: string | null;
      }
    | undefined;
  const brandId = raw?.brand_id ?? null;
  const analysis = (job?.analysis as unknown as Analysis | null) ?? null;
  const options = (job?.options ?? {}) as {
    aspect?: string;
    captions?: boolean;
    template_id?: string;
  };
  const aspect = (options.aspect ?? "9:16") as "9:16" | "16:9" | "1:1";

  // Brand-Wasserzeichen (Logo im Video-Eck) — pro Video ein-/ausschaltbar
  const brandWmQ = useQuery({
    queryKey: ["brand_watermark", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("*")
        .eq("id", brandId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as {
        watermark_path?: string | null;
        watermark_enabled?: boolean;
        watermark_position?: string;
      } | null;
    },
  });
  const brandWm = brandWmQ.data ?? null;
  const [wmOverride, setWmOverride] = useState<boolean | null>(null);
  const useWm = !!brandWm?.watermark_path && (wmOverride ?? !!brandWm?.watermark_enabled);
  const wmLoadedRef = useRef<string | null>(null);

  async function ensureWatermarkFile(
    ff: { writeFile: (n: string, d: unknown) => Promise<void> },
    fetchFile: (u: string) => Promise<unknown>,
  ): Promise<boolean> {
    const path = brandWm?.watermark_path;
    if (!path) return false;
    if (wmLoadedRef.current === path) return true;
    const { data } = await supabase.storage.from("raw-videos").createSignedUrl(path, 3600);
    if (!data?.signedUrl) return false;
    await ff.writeFile("wm.png", await fetchFile(data.signedUrl));
    wmLoadedRef.current = path;
    return true;
  }

  // Bibliothek: alle Videos & Schnitte dieses Brands — direkt im Editor
  const libraryQ = useQuery({
    queryKey: ["editor_library", brandId],
    enabled: !!brandId && panels.library,
    queryFn: async () => {
      const [videos, jobs] = await Promise.all([
        supabase
          .from("raw_videos")
          .select("id,title,duration_s,created_at")
          .eq("brand_id", brandId!)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("edit_jobs")
          .select("id,mode,status,created_at,raw_videos(title)")
          .eq("brand_id", brandId!)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      return { videos: videos.data ?? [], jobs: jobs.data ?? [] };
    },
  });

  function wmOverlayPos(): string {
    const pos = brandWm?.watermark_position ?? "br";
    if (pos === "tl") return "24:24";
    if (pos === "tr") return "W-w-24:24";
    if (pos === "bl") return "24:H-h-24";
    return "W-w-24:H-h-24";
  }

  useEffect(() => {
    if (raw?.platform && !targetPlatform) setTargetPlatform(raw.platform);
  }, [raw?.platform, targetPlatform]);

  useEffect(() => {
    if (!analysis?.segments || originalSegsRef.current) return;
    setSegments(analysis.segments.map((s) => ({ ...s })));
    originalSegsRef.current = analysis.segments.map((s) => ({ ...s }));
  }, [analysis]);

  // Hydrate saved arrays from db (first non-empty clip carries the doc)
  useEffect(() => {
    if (!job) return;
    const firstClip = (job.analysis as any)?.segments?.[0];
    // Try meta on job itself
    const savedT = (job as any).timeline_state?.transitions;
    const savedO = (job as any).timeline_state?.overlays;
    const savedA = (job as any).timeline_state?.audio_tracks;
    if (savedT && Array.isArray(savedT) && transitions.length === 0) setTransitions(savedT);
    if (savedO && Array.isArray(savedO) && overlays.length === 0) setOverlays(savedO);
    if (savedA && Array.isArray(savedA) && audioTracks.length === 0) setAudioTracks(savedA);
    // eslint-disable-next-line
  }, [job]);

  useEffect(() => {
    if (!raw?.storage_path) return;
    supabase.storage
      .from("raw-videos")
      .createSignedUrl(raw.storage_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setSignedUrl(data.signedUrl);
      });
  }, [raw?.storage_path]);

  useEffect(() => {
    (async () => {
      const next: Record<string, string> = { ...audioSignedUrls };
      for (const a of audioTracks) {
        if (next[a.id]) continue;
        if (a.source_url) {
          next[a.id] = a.source_url;
          continue;
        }
        if (!a.storage_path) continue;
        const { data } = await supabase.storage
          .from("raw-videos")
          .createSignedUrl(a.storage_path, 3600);
        if (data?.signedUrl) next[a.id] = data.signedUrl;
      }
      setAudioSignedUrls(next);
    })();
    // eslint-disable-next-line
  }, [audioTracks]);

  const totalDur = useMemo(
    () => segments.reduce((a, s) => a + Math.max(0, s.end_s - s.start_s), 0),
    [segments],
  );
  const rawDur = raw?.duration_s ? Number(raw.duration_s) : 300;

  // Timeline layout: horizontal cumulative offsets per clip
  const clipOffsets = useMemo(() => {
    const arr: number[] = [];
    let cur = 0;
    for (const s of segments) {
      arr.push(cur);
      cur += Math.max(0, s.end_s - s.start_s);
    }
    return arr;
  }, [segments]);

  async function saveTimelineState(next?: {
    transitions?: Transition[];
    overlays?: TextOverlay[];
    audio_tracks?: AudioTrack[];
  }) {
    const payload = {
      transitions: next?.transitions ?? transitions,
      overlays: next?.overlays ?? overlays,
      audio_tracks: next?.audio_tracks ?? audioTracks,
      zoom,
      playhead,
    };
    await supabase
      .from("edit_jobs")
      .update({ timeline_state: payload as any })
      .eq("id", id);
  }

  function updateSeg(idx: number, patch: Partial<Segment>) {
    setSegments((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function deleteSeg(idx: number) {
    setSegments((prev) => prev.filter((_, i) => i !== idx));
    setOverlays((prev) =>
      prev
        .filter((o) => o.clip_index !== idx)
        .map((o) => (o.clip_index > idx ? { ...o, clip_index: o.clip_index - 1 } : o)),
    );
    setTransitions((prev) =>
      prev
        .filter((t) => t.after_index !== idx && t.after_index !== idx - 1)
        .map((t) => (t.after_index > idx ? { ...t, after_index: t.after_index - 1 } : t)),
    );
    setSelectedClip(Math.max(0, selectedClip - (idx <= selectedClip ? 1 : 0)));
  }
  function addSeg() {
    const last = segments[segments.length - 1];
    const start = last ? Math.min(last.end_s, rawDur - 5) : 0;
    setSegments((prev) => [
      ...prev,
      { start_s: start, end_s: Math.min(start + 10, rawDur), title: `Clip ${prev.length + 1}` },
    ]);
  }
  function splitAtPlayhead() {
    const seg = segments[selectedClip];
    if (!seg) return;
    const off = clipOffsets[selectedClip] ?? 0;
    const rel = playhead - off;
    const cut = seg.start_s + rel;
    if (cut <= seg.start_s + 0.1 || cut >= seg.end_s - 0.1)
      return toast.error("Playhead ist außerhalb des Clips");
    const a = { ...seg, end_s: cut };
    const b = { ...seg, start_s: cut, title: `${seg.title} (2)` };
    setSegments((prev) => [...prev.slice(0, selectedClip), a, b, ...prev.slice(selectedClip + 1)]);
    toast.success("Clip gesplittet");
  }
  function resetSeg(idx: number) {
    const o = originalSegsRef.current?.[idx];
    if (o) updateSeg(idx, o);
    else toast.info("Kein KI-Original");
  }

  function setTransition(afterIdx: number, type: TransitionType, duration = 0.5) {
    setTransitions((prev) => {
      const others = prev.filter((t) => t.after_index !== afterIdx);
      if (type === "cut") return others;
      return [...others, { after_index: afterIdx, type, duration_s: duration }];
    });
  }
  function getTransition(afterIdx: number): Transition | null {
    return transitions.find((t) => t.after_index === afterIdx) ?? null;
  }

  function addOverlay(clipIdx: number) {
    const seg = segments[clipIdx];
    if (!seg) return;
    const dur = seg.end_s - seg.start_s;
    setOverlays((prev) => [
      ...prev,
      {
        id: uid(),
        clip_index: clipIdx,
        start_s: 0,
        end_s: Math.min(3, dur),
        text: "Text-Overlay",
        position: "bottom",
        font_size: 42,
        color: "#ffffff",
        bg: true,
      },
    ]);
  }
  function updateOverlay(id: string, patch: Partial<TextOverlay>) {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }
  function deleteOverlay(id: string) {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  }

  async function uploadAudio(file: File) {
    try {
      const key = `${user.id}/${brandId}/audio/${uid()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage
        .from("raw-videos")
        .upload(key, file, { contentType: file.type || "audio/mpeg" });
      if (error) throw error;
      setAudioTracks((prev) => [
        ...prev,
        { id: uid(), storage_path: key, name: file.name, volume: 0.6, duck: true },
      ]);
      toast.success("Audio hinzugefügt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    }
  }
  function updateAudio(id: string, patch: Partial<AudioTrack>) {
    setAudioTracks((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  function deleteAudio(id: string) {
    setAudioTracks((prev) => prev.filter((a) => a.id !== id));
  }

  // Persist on any change (debounced-ish)
  useEffect(() => {
    if (!job) return;
    const t = setTimeout(() => {
      saveTimelineState();
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [transitions, overlays, audioTracks, zoom]);

  useEffect(() => {
    if (!job || !segments.length) return;
    const t = setTimeout(() => {
      supabase
        .from("edit_jobs")
        .update({ analysis: { ...(analysis ?? {}), segments } as any })
        .eq("id", id);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [segments]);

  // Preview: play original video with playhead sync + seek to clip start on select
  function jumpToClip(idx: number) {
    setSelectedClip(idx);
    const off = clipOffsets[idx] ?? 0;
    setPlayhead(off);
    const seg = segments[idx];
    if (videoRef.current && seg) {
      videoRef.current.currentTime = seg.start_s;
      videoRef.current.play().catch(() => {});
      setPlaying(true);
    }
  }
  function togglePlay() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setPlaying(true);
    } else {
      videoRef.current.pause();
      setPlaying(false);
    }
  }

  // YouTube → MP4: Server lädt die Datei und legt sie in den Storage
  async function runYtImport() {
    if (!job?.raw_video_id) return;
    setYtImporting(true);
    setYtImportError(null);
    try {
      const { importYouTubeVideo } = await import("@/lib/youtube.functions");
      await importYouTubeVideo({ data: { rawVideoId: job.raw_video_id } });
      toast.success("MP4 importiert — Editor lädt jetzt die echte Datei");
      await jobQ.refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import fehlgeschlagen";
      setYtImportError(msg);
      toast.error(msg, { duration: 10000 });
    } finally {
      setYtImporting(false);
    }
  }

  async function getFFmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ff = new FFmpeg();
      const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
      ff.on("progress", ({ progress }: { progress: number }) =>
        setProgress(Math.round(progress * 100)),
      );
      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegRef.current = ff;
      return ff;
    } catch (e) {
      throw new Error(
        "Rendering-Engine konnte nicht geladen werden — bitte Seite neu laden oder anderen Browser probieren. Detail: " +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  }

  function aspectFilter() {
    if (aspect === "9:16") return "crop=ih*9/16:ih,scale=1080:1920";
    if (aspect === "1:1") return "crop=ih:ih,scale=1080:1080";
    return "scale=1920:1080";
  }

  function drawtextForClip(clipIdx: number, clipStartInOut: number) {
    // clipStartInOut: offset within the output where this clip begins (0 for single-clip render)
    const clipOverlays = overlays.filter((o) => o.clip_index === clipIdx);
    return clipOverlays
      .map((o) => {
        const t1 = (clipStartInOut + o.start_s).toFixed(2);
        const t2 = (clipStartInOut + o.end_s).toFixed(2);
        const y =
          o.position === "top" ? "h*0.08" : o.position === "center" ? "(h-text_h)/2" : "h*0.82";
        const box = o.bg ? ":box=1:boxcolor=black@0.55:boxborderw=18" : "";
        const safe = o.text.replace(/[':\\%]/g, "").replace(/,/g, "\\,");
        return `drawtext=text='${safe}':fontsize=${o.font_size}:fontcolor=${o.color}${box}:x=(w-text_w)/2:y=${y}:enable='between(t,${t1},${t2})'`;
      })
      .join(",");
  }

  async function renderSegment(seg: Segment, idx: number) {
    if (!signedUrl) {
      toast.error("Video-URL fehlt");
      return;
    }
    if (seg.end_s <= seg.start_s) {
      toast.error("Endzeit nach Startzeit setzen");
      return;
    }
    setRendering(String(idx));
    setProgress(0);
    try {
      const ff = await getFFmpeg();
      const { fetchFile } = await import("@ffmpeg/util");
      // Quelle nur einmal laden — bei 20 Clips spart das 19 Downloads
      if (inputLoadedRef.current !== signedUrl) {
        await ff.writeFile("in.mp4", await fetchFile(signedUrl));
        inputLoadedRef.current = signedUrl;
      }

      const duration = Math.max(0.5, seg.end_s - seg.start_s);
      const vFilterChain = [aspectFilter(), drawtextForClip(idx, 0)].filter(Boolean).join(",");

      // Optional: Musik-Spur + Brand-Wasserzeichen
      const audio = audioTracks[0];
      const hasAudio = !!(audio && audioSignedUrls[audio.id]);
      const hasWm = useWm && (await ensureWatermarkFile(ff, fetchFile));

      const inputs = ["-ss", String(seg.start_s), "-i", "in.mp4", "-t", String(duration)];
      if (hasAudio) {
        await ff.writeFile("bg.audio", await fetchFile(audioSignedUrls[audio.id]));
        inputs.push("-i", "bg.audio");
      }
      if (hasWm) inputs.push("-i", "wm.png");

      // -vf und -filter_complex dürfen nicht gemischt werden → bei Musik
      // oder Wasserzeichen läuft alles über EINEN filter_complex-Graphen.
      let filterArgs: string[];
      if (hasAudio || hasWm) {
        const parts: string[] = [`[0:v]${vFilterChain}[v1]`];
        let vOut = "[v1]";
        if (hasWm) {
          const wmIdx = hasAudio ? 2 : 1;
          parts.push(`[${wmIdx}:v]scale=200:-1[wm]`);
          parts.push(`${vOut}[wm]overlay=${wmOverlayPos()}[v2]`);
          vOut = "[v2]";
        }
        const maps = ["-map", vOut];
        if (hasAudio) {
          parts.push(
            `[0:a]volume=1.0[a0];[1:a]volume=${audio.volume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
          );
          maps.push("-map", "[aout]");
        } else {
          maps.push("-map", "0:a?");
        }
        filterArgs = ["-filter_complex", parts.join(";"), ...maps];
      } else {
        filterArgs = ["-vf", vFilterChain];
      }

      const args = [
        ...inputs,
        ...filterArgs,
        "-c:a",
        "aac",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "out.mp4",
      ];
      await ff.exec(args);
      const dataArr = await ff.readFile("out.mp4");
      const blob = new Blob([dataArr as BlobPart], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      outputBlobs.current[idx] = blob;
      setOutputs((o) => ({ ...o, [idx]: url }));
      toast.success(`Clip ${idx + 1} fertig`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Render fehlgeschlagen");
    } finally {
      setRendering(null);
      setProgress(0);
    }
  }

  /**
   * KI-Autopilot: kompletter Prozess ohne Eingreifen.
   * 1) Falls noch keine Clips: KI-Analyse anstoßen und auf Ergebnis warten
   * 2) Alle Clips nacheinander rendern
   * Danach kann der Mensch jeden Clip manuell nachbearbeiten und neu rendern.
   */
  async function runAutopilot() {
    if (autopilot === "analyzing" || autopilot === "rendering") return;
    try {
      let segs = segments;
      if (!segs.length) {
        setAutopilot("analyzing");
        if (job?.status === "pending" || job?.status === "failed") {
          const { analyzeVideo } = await import("@/lib/ai.functions");
          analyzeVideo({ data: { jobId: id } }).catch(() => {});
        }
        for (let i = 0; i < 60 && !segs.length; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const { data } = await supabase
            .from("edit_jobs")
            .select("analysis,status")
            .eq("id", id)
            .single();
          const a = data?.analysis as unknown as Analysis | null;
          if (a?.segments?.length) segs = a.segments;
          if (data?.status === "failed") throw new Error("KI-Analyse fehlgeschlagen");
        }
        if (!segs.length) throw new Error("KI-Analyse dauert zu lange — bitte gleich nochmal");
        jobQ.refetch();
      }
      setAutopilot("rendering");
      setApProgress({ current: 0, total: segs.length });
      for (let i = 0; i < segs.length; i++) {
        setApProgress({ current: i + 1, total: segs.length });
        await renderSegment(segs[i], i);
      }
      setAutopilot("done");
      toast.success(`Autopilot fertig — ${segs.length} Clips gerendert. Galerie rechts →`);
    } catch (e) {
      setAutopilot("idle");
      toast.error(e instanceof Error ? e.message : "Autopilot-Fehler");
    }
  }

  async function renderMaster() {
    if (!signedUrl || segments.length === 0) return;
    setRendering("master");
    setProgress(0);
    try {
      const ff = await getFFmpeg();
      const { fetchFile } = await import("@ffmpeg/util");
      if (inputLoadedRef.current !== signedUrl) {
        await ff.writeFile("in.mp4", await fetchFile(signedUrl));
        inputLoadedRef.current = signedUrl;
      }

      // Extract each clip first with aspect crop, then concat
      const clipFiles: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const dur = Math.max(0.5, s.end_s - s.start_s);
        const name = `c${i}.mp4`;
        await ff.exec([
          "-ss",
          String(s.start_s),
          "-i",
          "in.mp4",
          "-t",
          String(dur),
          "-vf",
          aspectFilter(),
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          name,
        ]);
        clipFiles.push(name);
      }

      // Build concat list (simple concat — transitions are approximated with fade envelopes as V1)
      const list = clipFiles.map((n) => `file '${n}'`).join("\n");
      await ff.writeFile("list.txt", new TextEncoder().encode(list));
      await ff.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "concat.mp4"]);

      // Optional overlay pass with drawtext (using absolute time across master)
      const dtParts: string[] = [];
      segments.forEach((_, i) => {
        const off = clipOffsets[i] ?? 0;
        const p = drawtextForClip(i, off);
        if (p) dtParts.push(p);
      });

      const audio = audioTracks[0];
      const hasAudioM = !!(audio && audioSignedUrls[audio.id]);
      const hasWmM = useWm && (await ensureWatermarkFile(ff, fetchFile));
      let finalName = "concat.mp4";
      if (dtParts.length || hasAudioM || hasWmM) {
        const inputs = ["-i", "concat.mp4"];
        if (hasAudioM) {
          await ff.writeFile("bg.audio", await fetchFile(audioSignedUrls[audio.id]));
          inputs.push("-i", "bg.audio");
        }
        if (hasWmM) inputs.push("-i", "wm.png");

        let filter = dtParts.length ? `[0:v]${dtParts.join(",")}[v1]` : "[0:v]null[v1]";
        let vOut = "[v1]";
        if (hasWmM) {
          const wmIdx = hasAudioM ? 2 : 1;
          filter += `;[${wmIdx}:v]scale=200:-1[wm];${vOut}[wm]overlay=${wmOverlayPos()}[v2]`;
          vOut = "[v2]";
        }
        let map = ["-map", vOut, "-map", "0:a?"];
        if (hasAudioM) {
          filter += `;[0:a]volume=1.0[a0];[1:a]volume=${audio.volume}[a1];[a0][a1]amix=inputs=2:duration=first[aout]`;
          map = ["-map", vOut, "-map", "[aout]"];
        }
        await ff.exec([
          ...inputs,
          "-filter_complex",
          filter,
          ...map,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "22",
          "-c:a",
          "aac",
          "master.mp4",
        ]);
        finalName = "master.mp4";
      }

      const dataArr = await ff.readFile(finalName);
      const blob = new Blob([dataArr as BlobPart], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      setMasterUrl(url);
      toast.success("Master-Export fertig");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Master-Export fehlgeschlagen");
    } finally {
      setRendering(null);
      setProgress(0);
    }
  }

  async function pushToQueue(idx: number, seg: Segment) {
    if (!brandId) {
      toast.error("Video hat keinen Brand");
      return;
    }
    if (!targetPlatform) {
      toast.error("Bitte Plattform wählen");
      return;
    }
    const blob = outputBlobs.current[idx];
    if (!blob) {
      toast.error("Bitte erst rendern");
      return;
    }
    setQueuing(String(idx));
    try {
      const key = `${user.id}/${brandId}/${uid()}.mp4`;
      const up = await supabase.storage
        .from("rendered-clips")
        .upload(key, blob, { contentType: "video/mp4" });
      if (up.error) throw up.error;
      const { data: maxRow } = await supabase
        .from("generated_clips")
        .select("queue_position")
        .eq("brand_id", brandId)
        .eq("platform", targetPlatform as any)
        .order("queue_position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextPos = (maxRow?.queue_position ?? 0) + 1;
      const { data: row, error } = await supabase
        .from("generated_clips")
        .insert({
          user_id: user.id,
          job_id: id,
          brand_id: brandId,
          platform: targetPlatform,
          storage_path: key,
          aspect,
          duration_s: Math.max(0.1, seg.end_s - seg.start_s),
          title: seg.title,
          caption_srt: seg.captions ?? null,
          status: "queued",
          queue_position: nextPos,
          meta: { hook: seg.hook ?? null } as any,
          overlays: overlays.filter((o) => o.clip_index === idx) as any,
          transitions: [] as any,
          audio_tracks: audioTracks as any,
        })
        .select()
        .single();
      if (error) throw error;
      setQueuedIds((q) => ({ ...q, [idx]: row.id }));
      toast.success(`Clip ${idx + 1} in Warteschlange`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Queue-Fehler");
    } finally {
      setQueuing(null);
    }
  }

  const selectedSeg = segments[selectedClip];
  const selectedOverlays = overlays.filter((o) => o.clip_index === selectedClip);

  if (jobQ.isLoading || !job) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-8">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <div className="text-sm font-medium">Editor wird geladen …</div>
          <div className="text-xs text-muted-foreground">
            Job-Daten, Video-URL und Timeline werden vorbereitet. Bei langen Videos oder frisch importierten YouTube-Links kann das einen Moment dauern.
          </div>
        </div>
      </div>
    );
  }

  if (jobQ.isError) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-8">
        <div className="max-w-md space-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm">
          <div className="font-semibold text-destructive">Job konnte nicht geladen werden</div>
          <div className="text-xs text-muted-foreground">{jobQ.error instanceof Error ? jobQ.error.message : "Unbekannter Fehler"}</div>
          <div className="flex gap-2">
            <button onClick={() => jobQ.refetch()} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">Erneut versuchen</button>
            <Link to="/app" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary">Zurück</Link>
          </div>
        </div>
      </div>
    );
  }

  const jobError = (job as { error?: string | null }).error ?? null;
  const isYouTubeSource =
    !raw?.storage_path && !!(raw as { source_url?: string | null } | undefined)?.source_url;

  return (
    <div ref={shellRef} className="fixed inset-0 flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
        >
          <ArrowLeft className="h-3 w-3" /> Editor
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{raw?.title ?? "Projekt"}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {job.mode} · {aspect} · {segments.length} Clips · {totalDur.toFixed(1)}s Output
          </div>
        </div>
        <select
          value={aspect}
          onChange={async (e) => {
            await supabase
              .from("edit_jobs")
              .update({ options: { ...options, aspect: e.target.value } as any })
              .eq("id", id);
            jobQ.refetch();
          }}
          className="rounded-md border border-border bg-input px-2 py-1 text-xs outline-none focus:border-primary"
        >
          <option value="9:16">9:16</option>
          <option value="16:9">16:9</option>
          <option value="1:1">1:1</option>
        </select>
        <select
          value={targetPlatform}
          onChange={(e) => setTargetPlatform(e.target.value)}
          className="rounded-md border border-border bg-input px-2 py-1 text-xs outline-none focus:border-primary"
        >
          <option value="">Plattform…</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="x">X</option>
        </select>
        {brandWm?.watermark_path && (
          <label
            className="hidden cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs sm:flex"
            title="Brand-Wasserzeichen (Logo) in den Export einblenden"
          >
            <input
              type="checkbox"
              checked={useWm}
              onChange={(e) => setWmOverride(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Logo
          </label>
        )}

        <button
          onClick={runAutopilot}
          disabled={
            autopilot === "analyzing" ||
            autopilot === "rendering" ||
            rendering !== null ||
            isYouTubeSource
          }
          className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          title="KI übernimmt: analysieren + alle Clips rendern — danach kannst du manuell nacharbeiten"
        >
          {autopilot === "analyzing" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> KI analysiert…
            </>
          ) : autopilot === "rendering" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Clip {apProgress.current}/
              {apProgress.total} · {progress}%
            </>
          ) : (
            <>
              <Wand2 className="h-3 w-3" /> KI-Autopilot
            </>
          )}
        </button>
        <button
          onClick={renderMaster}
          disabled={rendering !== null || segments.length === 0 || isYouTubeSource}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" />{" "}
          {rendering === "master" ? `Master ${progress}%` : "Master exportieren"}
        </button>
      </div>

      {/* Werkzeugleiste — jedes Feature einzeln ein-/ausklappbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card/60 px-3 py-1.5">
        <span className="mr-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          Ansicht
        </span>
        <PanelChip
          active={panels.library}
          onClick={() => togglePanel("library")}
          icon={<Library className="h-3.5 w-3.5" />}
          label="Bibliothek"
        />
        <PanelChip
          active={panels.media}
          onClick={() => togglePanel("media")}
          icon={<Film className="h-3.5 w-3.5" />}
          label="Medien"
        />
        <PanelChip
          active={panels.effects}
          onClick={() => togglePanel("effects")}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Werkzeuge"
        />
        <span className="mx-1 h-4 w-px bg-border" />
        <PanelChip
          active={panels.inspector}
          onClick={() => togglePanel("inspector")}
          icon={<Sliders className="h-3.5 w-3.5" />}
          label="Inspector"
        />
        <PanelChip
          active={panels.chat}
          onClick={() => togglePanel("chat")}
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label="KI-Chat"
        />
        <span className="mx-1 h-4 w-px bg-border" />
        <PanelChip
          active={panels.clipStrip}
          onClick={() => togglePanel("clipStrip")}
          icon={<LayoutGrid className="h-3.5 w-3.5" />}
          label="Clip-Übersicht"
        />
        <PanelChip
          active={panels.timeline}
          onClick={() => togglePanel("timeline")}
          icon={<ScissorsIcon className="h-3.5 w-3.5" />}
          label="Timeline"
        />

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() =>
              setPanels({
                library: false,
                media: false,
                effects: false,
                inspector: false,
                chat: false,
                clipStrip: true,
                timeline: true,
              })
            }
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
            title="Nur Player, Clips und Timeline — maximaler Platz"
          >
            Fokus-Modus
          </button>
          <button
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-secondary"
            title={fullscreen ? "Vollbild verlassen (Esc)" : "Vollbildmodus"}
          >
            {fullscreen ? (
              <>
                <Minimize className="h-3.5 w-3.5" /> Vollbild aus
              </>
            ) : (
              <>
                <Maximize className="h-3.5 w-3.5" /> Vollbild
              </>
            )}
          </button>
        </div>
      </div>

      {job.status === "analyzing" && (
        <div className="flex items-center gap-2 border-b border-border bg-accent/10 px-4 py-2 text-xs text-accent">
          <Loader2 className="h-3 w-3 animate-spin" /> KI analysiert Inhalt & schlägt Clips vor … (bei langen Videos 1–3 Min)
        </div>
      )}

      {job.status === "failed" && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <div className="font-semibold">KI-Analyse fehlgeschlagen</div>
          <div className="mt-0.5 text-[11px] opacity-90">{jobError ?? "Unbekannter Fehler — bitte erneut versuchen oder Video neu hochladen."}</div>
        </div>
      )}

      {isYouTubeSource && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">YouTube-Quelle — MP4 noch nicht importiert</div>
            <div className="mt-0.5 text-[11px] opacity-90">
              {ytImportError ??
                "Der Server kann das Video als MP4 importieren — danach laufen Preview, Schnitt & Export mit der echten Datei."}
            </div>
          </div>
          <button
            onClick={runYtImport}
            disabled={ytImporting}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {ytImporting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Import läuft… (1–3 Min)
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" /> MP4 jetzt importieren
              </>
            )}
          </button>
        </div>
      )}

      {rendering && !isYouTubeSource && (
        <div className="border-b border-border bg-primary/5 px-4 py-2 text-xs text-primary">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="font-semibold">
              {rendering === "master" ? "Master-Export läuft …" : `Clip ${Number(rendering) + 1} wird gerendert …`}
            </span>
            <span className="ml-auto font-mono text-[10px]">{progress}%</span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded bg-background">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Rendering läuft im Browser (ffmpeg.wasm) — Tab bitte offen lassen. Erstes Laden der Engine dauert 5–15 Sek.
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* LEFT: Media Bin */}
        <aside
          className={`${showLeft ? "w-64" : "hidden"} shrink-0 space-y-4 overflow-y-auto border-r border-border bg-card/40 p-3`}
        >
          {/* Bibliothek — andere Videos & Schnitte dieses Brands */}
          {panels.library && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Library className="h-3 w-3" /> Bibliothek
              </div>
              {libraryQ.isLoading ? (
                <div className="space-y-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-9 animate-pulse rounded-md bg-background" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      Schnitte ({libraryQ.data?.jobs.length ?? 0})
                    </div>
                    <div className="space-y-1">
                      {(libraryQ.data?.jobs ?? []).map((j: any) => (
                        <Link
                          key={j.id}
                          to="/app/job/$id"
                          params={{ id: j.id }}
                          className={`flex items-center gap-1.5 rounded-md border p-1.5 text-[11px] ${j.id === id ? "border-primary bg-primary/10" : "border-transparent hover:border-primary/40 hover:bg-background"}`}
                        >
                          <Wand2 className="h-3 w-3 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate">
                            {j.raw_videos?.title ?? "Video"}
                          </span>
                          <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                            {j.status}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      Videos ({libraryQ.data?.videos.length ?? 0})
                    </div>
                    <div className="space-y-1">
                      {(libraryQ.data?.videos ?? []).map((v: any) => (
                        <Link
                          key={v.id}
                          to="/app/video/$id"
                          params={{ id: v.id }}
                          className="flex items-center gap-1.5 rounded-md border border-transparent p-1.5 text-[11px] hover:border-primary/40 hover:bg-background"
                        >
                          <Film className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{v.title}</span>
                          <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                            {v.duration_s ? `${Math.round(Number(v.duration_s))}s` : "—"}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {panels.media && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Film className="h-3 w-3" /> Media Bin
            </div>
            <div className="space-y-2">
              <div className="rounded-md border border-border bg-background p-2 text-xs">
                <div className="truncate font-medium">{raw?.title}</div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {Math.round(rawDur)}s Quelle
                </div>
              </div>
              {audioTracks.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-background p-2 text-xs"
                >
                  <Music className="h-3 w-3 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1 truncate">{a.name}</div>
                  <button
                    onClick={() => deleteAudio(a.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground hover:border-primary hover:text-primary">
                <UploadCloud className="h-3 w-3" /> Audio hinzufügen
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadAudio(e.target.files[0])}
                />
              </label>
            </div>
          </div>
          )}

          {/* Viral Sound Library */}
          {panels.media && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Music className="h-3 w-3 text-accent" /> Viral Sounds
            </div>
            <ViralMusicPicker
              template={templateById(options.template_id as string | undefined)}
              onPick={(t) => {
                setAudioTracks((prev) => [
                  ...prev,
                  {
                    id: uid(),
                    storage_path: "",
                    source_url: t.url,
                    name: `${t.title} · ${t.bpm}BPM`,
                    volume: 0.35,
                    duck: true,
                  },
                ]);
                toast.success(`„${t.title}" hinzugefügt`);
              }}
            />
          </div>
          )}

          {panels.effects && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3 w-3" /> Werkzeuge
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => addOverlay(selectedClip)}
                className="rounded-md border border-border bg-background p-2 text-[11px] hover:border-primary/50"
              >
                <Type className="mx-auto h-4 w-4" />
                <div className="mt-1">Text</div>
              </button>
              <button
                onClick={splitAtPlayhead}
                className="rounded-md border border-border bg-background p-2 text-[11px] hover:border-primary/50"
              >
                <ScissorsIcon className="mx-auto h-4 w-4" />
                <div className="mt-1">Split</div>
              </button>
              <button
                onClick={addSeg}
                className="rounded-md border border-border bg-background p-2 text-[11px] hover:border-primary/50"
              >
                <Plus className="mx-auto h-4 w-4" />
                <div className="mt-1">Neuer Clip</div>
              </button>
              <button
                onClick={() => resetSeg(selectedClip)}
                className="rounded-md border border-border bg-background p-2 text-[11px] hover:border-primary/50"
              >
                <RotateCcw className="mx-auto h-4 w-4" />
                <div className="mt-1">KI-Original</div>
              </button>
            </div>
          </div>
          )}

          {panels.effects && analysis?.transcript_summary && (
            <div className="rounded-md border border-border bg-background p-2 text-[11px] text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">KI-Analyse</div>
              {analysis.transcript_summary}
            </div>
          )}
        </aside>

        {/* CENTER: Preview + Timeline */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-4">
            <div className="relative">
              {signedUrl ? (
                <video
                  ref={videoRef}
                  src={signedUrl}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={() => {
                    if (!videoRef.current || !selectedSeg) return;
                    const rel = videoRef.current.currentTime - selectedSeg.start_s;
                    setPlayhead((clipOffsets[selectedClip] ?? 0) + Math.max(0, rel));
                  }}
                  className={`max-h-full max-w-full ${aspect === "9:16" ? "aspect-[9/16]" : aspect === "1:1" ? "aspect-square" : "aspect-video"}`}
                />
              ) : isYouTubeSource ? (
                <div className="grid h-64 w-96 max-w-full place-items-center rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-6 text-center text-xs text-amber-600 dark:text-amber-400">
                  <div>
                    <div className="font-semibold">Kein Preview verfügbar</div>
                    <div className="mt-1 text-[11px] opacity-80">YouTube-Video ist verlinkt, aber nicht als Datei vorhanden. Bitte MP4 hochladen, um Preview & Export zu aktivieren.</div>
                  </div>
                </div>
              ) : (
                <div className="grid h-64 w-96 place-items-center rounded-xl bg-black/40 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <div className="text-xs">Video wird geladen …</div>
                  </div>
                </div>
              )}
              {/* Live text overlay preview */}
              {selectedSeg &&
                videoRef.current &&
                selectedOverlays.map((o) => {
                  const rel = videoRef.current!.currentTime - selectedSeg.start_s;
                  if (rel < o.start_s || rel > o.end_s) return null;
                  const posClass =
                    o.position === "top"
                      ? "top-[8%]"
                      : o.position === "center"
                        ? "top-1/2 -translate-y-1/2"
                        : "bottom-[10%]";
                  return (
                    <div
                      key={o.id}
                      className={`pointer-events-none absolute inset-x-0 flex justify-center px-4 ${posClass}`}
                    >
                      <div
                        style={{
                          color: o.color,
                          fontSize: Math.max(14, o.font_size / 3),
                          background: o.bg ? "rgba(0,0,0,.55)" : "transparent",
                          padding: o.bg ? "6px 14px" : 0,
                        }}
                        className="rounded-md font-semibold"
                      >
                        {o.text}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Clip-Übersicht — alle Clips als Streifen unter dem Player (CapCut/Adobe-Stil) */}
          {panels.clipStrip && segments.length > 0 && (
            <div className="shrink-0 border-t border-border bg-card/60 px-3 py-2">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Clips ({segments.length})
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {Object.keys(outputs).length} gerendert
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {segments.map((s, i) => {
                  const dur = Math.max(0, s.end_s - s.start_s);
                  const isSel = selectedClip === i;
                  const done = !!outputs[i];
                  return (
                    <button
                      key={i}
                      onClick={() => jumpToClip(i)}
                      className={`group relative w-32 shrink-0 rounded-lg border p-2 text-left transition ${
                        isSel
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border bg-background hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className={`grid h-4 w-4 shrink-0 place-items-center rounded font-mono text-[9px] ${isSel ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
                        >
                          {i + 1}
                        </span>
                        {done && <CheckCircle2 className="h-3 w-3 shrink-0 text-primary" />}
                        {queuedIds[i] && <ListPlus className="h-3 w-3 shrink-0 text-accent" />}
                      </div>
                      <div className="mt-1 truncate text-[11px] font-medium leading-tight">
                        {s.title}
                      </div>
                      <div className="font-mono text-[9px] text-muted-foreground">
                        {dur.toFixed(1)}s · ab {fmt(s.start_s)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Transport */}
          <div className="flex items-center gap-3 border-y border-border bg-card px-3 py-2 text-xs">
            <button
              onClick={togglePlay}
              className="rounded-md border border-border p-1.5 hover:bg-secondary"
            >
              {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {fmt(playhead)} / {fmt(totalDur)}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <ZoomOut className="h-3 w-3 text-muted-foreground" />
              <input
                type="range"
                min={PX_PER_S_MIN}
                max={PX_PER_S_MAX}
                value={zoom}
                onChange={(e) => setZoom(parseInt(e.target.value))}
                className="w-32"
              />
              <ZoomIn className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>

          {/* Timeline */}
          <div
            className={`${panels.timeline ? "max-h-[45%]" : "hidden"} overflow-auto border-t border-border bg-background p-3`}
          >
            {segments.length === 0 ? (
              <div className="grid h-32 place-items-center text-xs text-muted-foreground">
                Noch keine Clips — warte auf KI oder füge manuell hinzu.
              </div>
            ) : (
              <div style={{ width: Math.max(600, totalDur * zoom + 60) }} className="relative">
                {/* Ruler — adaptive Ticks, damit auch 1h-Videos flüssig bleiben */}
                <div className="mb-1 h-4 border-b border-border">
                  {(() => {
                    // Tick-Abstand so wählen, dass Ticks ≥ 60px auseinander liegen
                    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
                    const step = steps.find((st) => st * zoom >= 60) ?? 600;
                    const count = Math.floor(totalDur / step) + 1;
                    return Array.from({ length: count }).map((_, i) => {
                      const s = i * step;
                      return (
                        <div
                          key={s}
                          style={{ left: s * zoom }}
                          className="absolute -top-0.5 h-3 border-l border-border/60 pl-1 font-mono text-[9px] text-muted-foreground"
                        >
                          {s >= 60
                            ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
                            : `${s}s`}
                        </div>
                      );
                    });
                  })()}
                  {/* Playhead */}
                  <div
                    style={{ left: playhead * zoom }}
                    className="pointer-events-none absolute -top-0.5 bottom-0 z-10 w-px bg-primary shadow-[0_0_6px_hsl(var(--primary))]"
                  />
                </div>

                {/* Track: Video */}
                <TrackRow label="V" icon={<Film className="h-3 w-3" />}>
                  {segments.map((s, i) => {
                    const dur = Math.max(0.1, s.end_s - s.start_s);
                    const off = clipOffsets[i] ?? 0;
                    const tr = getTransition(i);
                    return (
                      <div
                        key={i}
                        className="absolute top-1 bottom-1"
                        style={{ left: off * zoom, width: dur * zoom }}
                      >
                        <button
                          onClick={() => jumpToClip(i)}
                          className={`h-full w-full rounded-md border px-2 text-left text-[10px] font-mono leading-tight overflow-hidden ${selectedClip === i ? "border-primary bg-primary/30 text-primary-foreground" : "border-primary/40 bg-primary/15 hover:bg-primary/25"}`}
                        >
                          <div className="truncate">
                            {i + 1}. {s.title}
                          </div>
                          <div className="text-[9px] opacity-70">{dur.toFixed(1)}s</div>
                        </button>
                        {i < segments.length - 1 && (
                          <div className="absolute -right-3 top-1/2 z-20 -translate-y-1/2">
                            <TransitionPicker value={tr} onChange={(t) => setTransition(i, t)} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </TrackRow>

                {/* Track: Overlays */}
                <TrackRow label="T" icon={<Type className="h-3 w-3" />}>
                  {overlays.map((o) => {
                    const clipOff = clipOffsets[o.clip_index] ?? 0;
                    const left = (clipOff + o.start_s) * zoom;
                    const width = Math.max(6, (o.end_s - o.start_s) * zoom);
                    return (
                      <div
                        key={o.id}
                        style={{ left, width }}
                        className="absolute top-1 bottom-1 rounded-md border border-accent/50 bg-accent/20 px-2 text-[10px] text-accent overflow-hidden"
                      >
                        <div className="truncate leading-6">{o.text}</div>
                      </div>
                    );
                  })}
                </TrackRow>

                {/* Track: Audio */}
                <TrackRow label="A" icon={<Music className="h-3 w-3" />}>
                  {audioTracks.map((a, i) => (
                    <div
                      key={a.id}
                      style={{ left: 0, width: totalDur * zoom }}
                      className={`absolute rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 text-[10px] text-emerald-600 overflow-hidden ${i === 0 ? "top-1 bottom-1" : "hidden"}`}
                    >
                      <div className="truncate leading-6">
                        {a.name} · vol {Math.round(a.volume * 100)}%{a.duck ? " · ducking" : ""}
                      </div>
                    </div>
                  ))}
                </TrackRow>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT: Inspector + Chat */}
        <aside
          className={`${showRight ? "w-[380px]" : "hidden"} shrink-0 overflow-y-auto border-l border-border bg-card/40`}
        >
          {/* Inspector */}
          <div className={`${panels.inspector ? "" : "hidden"} border-b border-border p-3`}>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Inspector — Clip {selectedClip + 1}
            </div>
            {selectedSeg ? (
              <div className="space-y-2 text-xs">
                <label className="block">
                  <span className="text-muted-foreground">Titel</span>
                  <input
                    value={selectedSeg.title}
                    onChange={(e) => updateSeg(selectedClip, { title: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1 text-sm outline-none focus:border-primary"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-muted-foreground">Start (s)</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={rawDur}
                      value={selectedSeg.start_s}
                      onChange={(e) =>
                        updateSeg(selectedClip, { start_s: Math.max(0, +e.target.value) })
                      }
                      className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1 outline-none focus:border-primary"
                    />
                  </label>
                  <label className="block">
                    <span className="text-muted-foreground">Ende (s)</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={rawDur}
                      value={selectedSeg.end_s}
                      onChange={(e) =>
                        updateSeg(selectedClip, { end_s: Math.max(0, +e.target.value) })
                      }
                      className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1 outline-none focus:border-primary"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-muted-foreground">Hook</span>
                  <input
                    value={selectedSeg.hook ?? ""}
                    onChange={(e) => updateSeg(selectedClip, { hook: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1 outline-none focus:border-primary"
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground">Untertitel</span>
                  <textarea
                    rows={2}
                    value={selectedSeg.captions ?? ""}
                    onChange={(e) => updateSeg(selectedClip, { captions: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1 outline-none focus:border-primary"
                  />
                </label>

                {/* Overlays for this clip */}
                <div className="rounded-md border border-border bg-background p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[11px] font-medium">
                      Text-Overlays ({selectedOverlays.length})
                    </div>
                    <button
                      onClick={() => addOverlay(selectedClip)}
                      className="text-primary hover:underline"
                    >
                      <Plus className="inline h-3 w-3" /> Add
                    </button>
                  </div>
                  {selectedOverlays.map((o) => (
                    <div key={o.id} className="mt-1 space-y-1 rounded border border-border p-2">
                      <div className="flex gap-1">
                        <input
                          value={o.text}
                          onChange={(e) => updateOverlay(o.id, { text: e.target.value })}
                          className="flex-1 rounded border border-border bg-input px-1.5 py-1 text-[11px] outline-none focus:border-primary"
                        />
                        <button onClick={() => deleteOverlay(o.id)} className="text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <input
                          type="number"
                          step={0.1}
                          value={o.start_s}
                          onChange={(e) => updateOverlay(o.id, { start_s: +e.target.value })}
                          title="Start"
                          className="rounded border border-border bg-input px-1 py-0.5 text-[10px]"
                        />
                        <input
                          type="number"
                          step={0.1}
                          value={o.end_s}
                          onChange={(e) => updateOverlay(o.id, { end_s: +e.target.value })}
                          title="Ende"
                          className="rounded border border-border bg-input px-1 py-0.5 text-[10px]"
                        />
                        <select
                          value={o.position}
                          onChange={(e) => updateOverlay(o.id, { position: e.target.value as any })}
                          className="rounded border border-border bg-input px-1 py-0.5 text-[10px]"
                        >
                          <option value="top">oben</option>
                          <option value="center">mitte</option>
                          <option value="bottom">unten</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2 text-[10px]">
                        <input
                          type="number"
                          min={12}
                          max={120}
                          value={o.font_size}
                          onChange={(e) => updateOverlay(o.id, { font_size: +e.target.value })}
                          className="w-14 rounded border border-border bg-input px-1 py-0.5"
                        />{" "}
                        px
                        <input
                          type="color"
                          value={o.color}
                          onChange={(e) => updateOverlay(o.id, { color: e.target.value })}
                          className="h-5 w-6 rounded border border-border"
                        />
                        <label className="ml-auto inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={o.bg}
                            onChange={(e) => updateOverlay(o.id, { bg: e.target.checked })}
                          />{" "}
                          BG
                        </label>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Audio inspector */}
                {audioTracks[0] && (
                  <div className="rounded-md border border-border bg-background p-2">
                    <div className="mb-1 flex items-center gap-2 text-[11px] font-medium">
                      <Music className="h-3 w-3 text-emerald-600" /> Musik: {audioTracks[0].name}
                    </div>
                    <label className="flex items-center gap-2 text-[10px]">
                      <Volume2 className="h-3 w-3" />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={audioTracks[0].volume}
                        onChange={(e) =>
                          updateAudio(audioTracks[0].id, { volume: +e.target.value })
                        }
                        className="flex-1"
                      />
                      <span className="tabular-nums">
                        {Math.round(audioTracks[0].volume * 100)}%
                      </span>
                    </label>
                    <label className="mt-1 flex items-center gap-2 text-[10px]">
                      <input
                        type="checkbox"
                        checked={audioTracks[0].duck}
                        onChange={(e) => updateAudio(audioTracks[0].id, { duck: e.target.checked })}
                      />
                      <VolumeX className="h-3 w-3" /> Ducking bei Sprache
                    </label>
                  </div>
                )}

                {/* Render + queue */}
                <div className="flex gap-1 pt-1">
                  <button
                    onClick={() => renderSegment(selectedSeg, selectedClip)}
                    disabled={rendering !== null}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {rendering === String(selectedClip) ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" /> {progress}%
                      </>
                    ) : (
                      <>
                        <Download className="h-3 w-3" /> Rendern
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => deleteSeg(selectedClip)}
                    className="rounded-md border border-destructive/50 px-2 py-1.5 text-[11px] text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {outputs[selectedClip] && (
                  <div className="space-y-1 rounded-md border border-border bg-background p-2">
                    <video src={outputs[selectedClip]} controls className="w-full rounded-md" />
                    <div className="flex gap-1">
                      <a
                        href={outputs[selectedClip]}
                        download={`clip-${selectedClip + 1}.mp4`}
                        className="flex-1 rounded-md border border-border p-1.5 text-center text-[10px] hover:bg-secondary"
                      >
                        MP4 laden
                      </a>
                      {queuedIds[selectedClip] ? (
                        <span className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-primary/10 p-1.5 text-[10px] text-primary">
                          <CheckCircle2 className="h-3 w-3" /> In Queue
                        </span>
                      ) : (
                        <button
                          onClick={() => pushToQueue(selectedClip, selectedSeg)}
                          disabled={queuing === String(selectedClip) || !targetPlatform}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-primary p-1.5 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-50"
                        >
                          {queuing === String(selectedClip) ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              <ListPlus className="h-3 w-3" /> Queue
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Kein Clip gewählt.</div>
            )}
          </div>

          {/* Clip-Galerie: alle gerenderten Clips ansehen & herunterladen */}
          {Object.keys(outputs).length > 0 && (
            <div className="border-b border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  Clip-Galerie ({Object.keys(outputs).length}/{segments.length})
                </span>
                {Object.keys(outputs).length < segments.length && (
                  <button
                    onClick={runAutopilot}
                    disabled={autopilot === "rendering" || rendering !== null}
                    className="text-[10px] text-primary hover:underline disabled:opacity-50"
                  >
                    Restliche rendern
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {segments.map((s, i) =>
                  outputs[i] ? (
                    <div key={i} className="space-y-1">
                      <video
                        src={outputs[i]}
                        controls
                        preload="metadata"
                        className="w-full rounded-md bg-black"
                      />
                      <a
                        href={outputs[i]}
                        download={`clip-${i + 1}.mp4`}
                        className="block truncate rounded border border-border px-1.5 py-1 text-center text-[10px] hover:bg-secondary"
                        title={s.title}
                      >
                        ⬇ {i + 1}. {s.title}
                      </a>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          )}

          {masterUrl && (
            <div className="border-b border-border p-3">
              <div className="mb-2 text-xs font-medium">Master-Export</div>
              <video src={masterUrl} controls className="w-full rounded-md bg-black" />
              <a
                href={masterUrl}
                download="master.mp4"
                className="mt-1 block rounded-md border border-border p-1.5 text-center text-[11px] hover:bg-secondary"
              >
                Master herunterladen
              </a>
            </div>
          )}

          {/* KI-Chat */}
          <div className={`${panels.chat ? "" : "hidden"} p-3`}>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <MessageSquare className="h-3 w-3 text-accent" /> KI-Chat — sag, was geändert werden soll
            </div>
            <EditorChat
              jobId={id}
              userId={user.id}
              initialMessages={(job?.chat_messages ?? []) as unknown as UIMessage[]}
              styleReference={(job?.style_reference ?? null) as Record<string, unknown> | null}
              onChanged={() => jobQ.refetch()}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Ein-/Ausklapp-Schalter in der Editor-Werkzeugleiste */
function PanelChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={active ? `${label} ausblenden` : `${label} einblenden`}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-secondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function TrackRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative mb-1 flex" style={{ height: TRACK_H }}>
      <div className="absolute left-[-32px] top-0 flex h-full w-7 items-center justify-center rounded-l-md border border-border bg-card font-mono text-[10px] text-muted-foreground">
        <div className="flex flex-col items-center gap-0.5">
          {icon}
          <span>{label}</span>
        </div>
      </div>
      <div className="relative flex-1 rounded-md border border-border bg-card">{children}</div>
    </div>
  );
}

function TransitionPicker({
  value,
  onChange,
}: {
  value: Transition | null;
  onChange: (t: TransitionType) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = value?.type ?? "cut";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Übergang: ${label}`}
        className={`grid h-5 w-5 place-items-center rounded-sm border text-[9px] rotate-45 ${value ? "border-accent bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground"}`}
      >
        <span className="-rotate-45">{label === "cut" ? "|" : label === "fade" ? "F" : "X"}</span>
      </button>
      {open && (
        <div className="absolute left-1/2 top-6 z-30 -translate-x-1/2 rounded-md border border-border bg-card p-1 shadow-lg">
          {(["cut", "fade", "crossfade"] as TransitionType[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                onChange(t);
                setOpen(false);
              }}
              className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-[11px] hover:bg-secondary"
            >
              <ChevronRight className="mr-1 inline h-3 w-3" /> {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViralMusicPicker({
  template,
  onPick,
}: {
  template: ReturnType<typeof templateById>;
  onPick: (t: ViralTrack) => void;
}) {
  const mood = template?.musicMood ?? null;
  const suggested = mood && mood !== "none" ? MUSIC_LIBRARY.filter((t) => t.mood === mood) : [];
  const rest = MUSIC_LIBRARY.filter((t) => !suggested.includes(t));
  const [preview, setPreview] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggle(url: string) {
    if (!audioRef.current) return;
    if (preview === url) {
      audioRef.current.pause();
      setPreview(null);
      return;
    }
    audioRef.current.src = url;
    audioRef.current
      .play()
      .then(() => setPreview(url))
      .catch(() => setPreview(null));
  }

  const Row = ({ t }: { t: ViralTrack }) => (
    <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1.5 text-[11px]">
      <button
        onClick={() => toggle(t.url)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-primary hover:bg-primary/10"
        title={preview === t.url ? "Stop" : "Preview"}
      >
        {preview === t.url ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{t.title}</div>
        <div className="truncate text-[9px] text-muted-foreground">
          {t.mood} · {t.bpm}BPM · {t.duration_s}s
        </div>
      </div>
      <button
        onClick={() => onPick(t)}
        className="rounded border border-primary/50 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
      >
        Add
      </button>
    </div>
  );

  return (
    <div className="space-y-2">
      <audio ref={audioRef} onEnded={() => setPreview(null)} className="hidden" />
      {suggested.length > 0 && (
        <div className="space-y-1">
          <div className="font-mono text-[9px] uppercase tracking-widest text-primary">
            Passend zu „{template?.label}"
          </div>
          {suggested.map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </div>
      )}
      <details className="rounded-md border border-border bg-background/60">
        <summary className="cursor-pointer px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground">
          Alle {rest.length} weiteren Sounds
        </summary>
        <div className="space-y-1 border-t border-border p-1.5">
          {rest.map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </div>
      </details>
      <div className="text-[9px] leading-tight text-muted-foreground">
        Pixabay Content License · CC0 · sofort kommerziell nutzbar.
      </div>
    </div>
  );
}
