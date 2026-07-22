import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Layers,
  Link2,
  UploadCloud,
  Sparkles,
  Scissors,
  Captions,
  Music2,
  MessageSquareText,
  Loader2,
  Clock,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useActiveBrandId, useBrands } from "@/lib/use-active-brand";
import { detectRestrictedHost, isDirectVideoUrl } from "@/lib/editor-types";
import { YouTubeImportDialog } from "@/components/editor/YouTubeImportDialog";

export const Route = createFileRoute("/_authenticated/app/clipping")({
  component: MassClipping,
});

type AudioFxPreset = "none" | "punchy" | "cinematic" | "podcast";

function MassClipping() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [activeBrandId] = useActiveBrandId();
  const brandsQ = useBrands(user.id);
  const activeBrand = (brandsQ.data ?? []).find((b) => b.id === activeBrandId) ?? null;

  const [urlInput, setUrlInput] = useState("");
  const [clipCount, setClipCount] = useState(10);
  const [captions, setCaptions] = useState(true);
  const [aiExplain, setAiExplain] = useState(false);
  const [audioFx, setAudioFx] = useState<AudioFxPreset>("none");
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [ytDialog, setYtDialog] = useState<{ host: string; original: string } | null>(null);

  const jobsQ = useQuery({
    queryKey: ["clipping_jobs", user.id, activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("edit_jobs")
        .select("*, raw_videos(title)")
        .eq("brand_id", activeBrandId!)
        .eq("mode", "long_to_many")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function startClipping(sourceUrl: string | null, file: File | null) {
    if (!activeBrand) return toast.error("Bitte zuerst links einen Brand wählen");
    setBusy(true);
    try {
      let storagePath: string | null = null;
      let duration: number | null = null;
      let title = "";

      if (file) {
        const key = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("raw-videos").upload(key, file, {
          contentType: file.type || "video/mp4",
          upsert: false,
        });
        if (upErr) throw upErr;
        storagePath = key;
        title = file.name;
        duration = await probeDuration(file).catch(() => null);
      } else if (sourceUrl) {
        title = sourceUrl;
      } else {
        return;
      }

      const { data: raw, error: rawErr } = await supabase
        .from("raw_videos")
        .insert({
          user_id: user.id,
          brand_id: activeBrand.id,
          title,
          source_url: sourceUrl,
          storage_path: storagePath,
          duration_s: duration,
          size_bytes: file?.size ?? null,
        })
        .select()
        .single();
      if (rawErr) throw rawErr;

      const { data: job, error: jobErr } = await supabase
        .from("edit_jobs")
        .insert({
          user_id: user.id,
          raw_video_id: raw.id,
          brand_id: activeBrand.id,
          mode: "long_to_many",
          options: { captions, aspect, ai_explain: aiExplain, audio_fx: audioFx },
          desired_clip_count: clipCount,
        })
        .select()
        .single();
      if (jobErr) throw jobErr;

      const { analyzeVideo } = await import("@/lib/ai.functions");
      analyzeVideo({ data: { jobId: job.id, desiredClipCount: clipCount } }).catch((e) =>
        toast.error(e instanceof Error ? e.message : "KI-Fehler"),
      );

      toast.success(`Clipping gestartet — ${clipCount} Clips werden vorbereitet`);
      setUrlInput("");
      navigate({ to: "/app/job/$id", params: { id: job.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clipping konnte nicht starten");
    } finally {
      setBusy(false);
    }
  }

  function handleUrl() {
    const url = urlInput.trim();
    if (!url) return;
    const host = detectRestrictedHost(url);
    if (host && !isDirectVideoUrl(url)) {
      setYtDialog({ host, original: url });
      return;
    }
    startClipping(url, null);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
          <Layers className="h-3 w-3" /> Massen-Clipping
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Ein Video → viele Clips</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          YouTube-Link oder Datei rein, bis zu 20 Szenen-Clips raus — mit Untertiteln, Audioeffekten
          und KI-Erklärungen.
        </p>
      </div>

      {!activeBrand && (
        <div className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs text-primary">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Wähle links in der Seitenleiste einen Brand — jedes Clipping gehört zu einem Brand.
          </span>
        </div>
      )}

      <div
        className={`grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,1fr)] ${activeBrand ? "" : "pointer-events-none opacity-50"}`}
      >
        {/* Quelle */}
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="h-4 w-4 text-accent" /> Quelle
          </div>
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && handleUrl()}
            placeholder="https://youtube.com/watch?v=…"
            className="w-full rounded-md border border-border bg-input px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleUrl}
              disabled={busy || !urlInput}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Scissors className="h-4 w-4" />
              )}
              In {clipCount} Clips schneiden
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm hover:bg-secondary"
              title="Datei hochladen"
            >
              <UploadCloud className="h-4 w-4" /> Datei
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && startClipping(null, e.target.files[0])}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Für YouTube/TikTok-Links läuft der Download beim ersten Öffnen im Editor. Direkte
            MP4-Links und Uploads funktionieren sofort.
          </p>
        </div>

        {/* Optionen */}
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" /> Clip-Optionen
          </div>

          <label className="block text-xs">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Anzahl Clips
              </span>
              <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary">
                {clipCount}
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={20}
              value={clipCount}
              onChange={(e) => setClipCount(parseInt(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
          </label>

          <label className="block text-xs">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Format
            </span>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(["9:16", "16:9", "1:1"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAspect(a)}
                  className={`rounded-md border px-2 py-1.5 text-xs ${aspect === a ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </label>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background/40 p-2.5 text-xs">
            <input
              type="checkbox"
              checked={captions}
              onChange={(e) => setCaptions(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <Captions className="h-4 w-4 text-primary" />
            <span className="flex-1">
              <span className="font-medium">Untertitel</span>{" "}
              <span className="text-muted-foreground">— automatisch pro Clip</span>
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background/40 p-2.5 text-xs">
            <input
              type="checkbox"
              checked={aiExplain}
              onChange={(e) => setAiExplain(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <MessageSquareText className="h-4 w-4 text-accent" />
            <span className="flex-1">
              <span className="font-medium">KI-Erklärungen</span>{" "}
              <span className="text-muted-foreground">— Kontext-Overlays je Szene</span>
            </span>
          </label>

          <label className="block text-xs">
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <Music2 className="h-3 w-3" /> Audioeffekt
            </span>
            <select
              value={audioFx}
              onChange={(e) => setAudioFx(e.target.value as AudioFxPreset)}
              className="mt-1 w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="none">Keiner</option>
              <option value="punchy">Punchy (Shorts/TikTok)</option>
              <option value="cinematic">Cinematic</option>
              <option value="podcast">Podcast / Sprache klar</option>
            </select>
          </label>
        </div>
      </div>

      {/* Bisherige Clipping-Jobs */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-muted-foreground" /> Letzte Clippings{" "}
          {activeBrand ? `· ${activeBrand.name}` : ""}
        </div>
        {(jobsQ.data ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Noch keine Massen-Clippings für diesen Brand.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {(jobsQ.data ?? []).map((j: any) => (
              <Link
                key={j.id}
                to="/app/job/$id"
                params={{ id: j.id }}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-xs hover:border-primary/40"
              >
                <Layers className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{j.raw_videos?.title ?? "Video"}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {j.desired_clip_count ?? "?"} Clips ·{" "}
                    {new Date(j.created_at).toLocaleDateString()} · {j.status}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {ytDialog && (
        <YouTubeImportDialog
          open
          host={ytDialog.host}
          onClose={() => setYtDialog(null)}
          onUseDirectUrl={(u) => {
            setYtDialog(null);
            startClipping(u, null);
          }}
          onUploadFile={() => {
            setYtDialog(null);
            fileRef.current?.click();
          }}
        />
      )}
    </div>
  );
}

function probeDuration(file: File): Promise<number> {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => {
      res(v.duration);
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("probe failed"));
    };
    v.src = url;
  });
}
