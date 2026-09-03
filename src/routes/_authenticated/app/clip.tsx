import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Wand2,
  UploadCloud,
  Link2,
  Sparkles,
  ChevronRight,
  AlertTriangle,
  Music2,
  Play,
} from "lucide-react";
import { useActiveBrandId, useBrands } from "@/lib/use-active-brand";
import { CLIP_TEMPLATES, templateById, type ClipTemplateId } from "@/lib/clip-templates";
import { MUSIC_LIBRARY, type MusicMood } from "@/lib/music-library";
import { YouTubeImportDialog } from "@/components/editor/YouTubeImportDialog";
import { detectRestrictedHost, isDirectVideoUrl } from "@/lib/editor-types";

export const Route = createFileRoute("/_authenticated/app/clip")({
  component: ClipPage,
});

type Aspect = "9:16" | "16:9" | "1:1";

function ClipPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [activeBrandId] = useActiveBrandId();
  const brandsQ = useBrands(user.id);
  const brands = brandsQ.data ?? [];
  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;

  const [templateId, setTemplateId] = useState<ClipTemplateId>("ugc_hook");
  const tpl = templateById(templateId)!;
  const [count, setCount] = useState<number>(tpl.defaultCount ?? 10);
  const [aspect, setAspect] = useState<Aspect>(tpl.aspect);
  const [captions, setCaptions] = useState<boolean>(tpl.captions);
  const [aiExplain, setAiExplain] = useState(false);
  const [minLen, setMinLen] = useState<number>(tpl.targetLenS[0]);
  const [maxLen, setMaxLen] = useState<number>(tpl.targetLenS[1]);
  const [duration, setDuration] = useState<number | null>(null);

  const [urlInput, setUrlInput] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [ytDialog, setYtDialog] = useState<{ host: string; original: string } | null>(null);

  function pickTemplate(id: ClipTemplateId) {
    const t = templateById(id)!;
    setTemplateId(id);
    setAspect(t.aspect);
    setCaptions(t.captions);
    setMinLen(t.targetLenS[0]);
    setMaxLen(t.targetLenS[1]);
    setCount(recommendedCount(duration, t.targetLenS, t.defaultCount));
  }

  useEffect(() => {
    setCount(recommendedCount(duration, tpl.targetLenS, tpl.defaultCount));
  }, [duration, templateId]); // eslint-disable-line

  const recentQ = useQuery({
    queryKey: ["clip-recent", user.id, activeBrandId ?? "none"],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("edit_jobs")
        .select("id, mode, status, created_at, desired_clip_count, raw_videos(title)")
        .eq("brand_id", activeBrandId!)
        .in("mode", ["ugc_shorts", "long_to_many"])
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function handleFile(file: File) {
    if (!activeBrand) return toast.error("Bitte oben links einen Brand wählen");
    setBusy(true);
    setProgress(5);
    setBusyLabel("Upload läuft …");
    try {
      const key = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("raw-videos")
        .upload(key, file, { contentType: file.type || "video/mp4", upsert: false });
      if (upErr) throw new Error("Upload fehlgeschlagen: " + upErr.message);
      setProgress(70);
      setBusyLabel("Metadaten werden gelesen …");
      const dur = await probeDuration(file).catch(() => null);
      setBusyLabel("Job wird erstellt …");
      const { data: row, error: dbErr } = await supabase
        .from("raw_videos")
        .insert({
          user_id: user.id,
          brand_id: activeBrand.id,
          title: title || file.name,
          storage_path: key,
          size_bytes: file.size,
          duration_s: dur,
        })
        .select()
        .single();
      if (dbErr) throw new Error("Datenbank-Fehler: " + dbErr.message);
      setProgress(100);
      await startClipping(row.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen", { duration: 8000 });
    } finally {
      setBusy(false);
      setProgress(0);
      setBusyLabel("");
    }
  }

  const providersQ = useQuery({
    queryKey: ["yt_download_providers"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { getDownloadProviders } = await import("@/lib/youtube.functions");
      return getDownloadProviders();
    },
  });

  async function handleUrl() {
    if (!activeBrand) return toast.error("Bitte oben links einen Brand wählen");
    const url = urlInput.trim();
    if (!url) return;
    const host = detectRestrictedHost(url);
    if (host && !isDirectVideoUrl(url)) {
      // Mit konfiguriertem Download-Provider: direkt importieren, kein Dialog
      if (providersQ.data?.any) {
        await commitUrl(url);
        return;
      }
      setYtDialog({ host, original: url });
      return;
    }
    await commitUrl(url);
  }

  async function commitUrl(url: string) {
    if (!activeBrand) return;
    setBusy(true);
    setBusyLabel("Link wird gespeichert …");
    try {
      const { data: row, error } = await supabase
        .from("raw_videos")
        .insert({
          user_id: user.id,
          brand_id: activeBrand.id,
          title: title || url,
          source_url: url,
        })
        .select()
        .single();
      if (error) throw new Error("Speichern fehlgeschlagen: " + error.message);

      // YouTube & Co.: MP4-Import läuft im Hintergrund, während die KI plant
      if (detectRestrictedHost(url) && providersQ.data?.any) {
        toast.info("MP4-Download gestartet — läuft im Hintergrund (1–3 Min)");
        import("@/lib/youtube.functions").then(({ importYouTubeVideo }) =>
          importYouTubeVideo({ data: { rawVideoId: row.id } })
            .then(() => toast.success("YouTube-Video als MP4 importiert"))
            .catch((e) =>
              toast.error("MP4-Import: " + (e instanceof Error ? e.message : "fehlgeschlagen"), {
                duration: 10000,
              }),
            ),
        );
      }

      await startClipping(row.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen", { duration: 8000 });
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  async function startClipping(rawVideoId: string) {
    if (!activeBrand) return;
    setBusyLabel("KI-Schnittplan wird erstellt … (10-60 Sek)");
    const { data: job, error } = await supabase
      .from("edit_jobs")
      .insert({
        user_id: user.id,
        raw_video_id: rawVideoId,
        brand_id: activeBrand.id,
        mode: tpl.mode,
        options: {
          captions,
          aspect,
          ai_explain: aiExplain,
          template_id: templateId,
          min_len_s: minLen,
          max_len_s: maxLen,
          music_mood: tpl.musicMood,
        },
        desired_clip_count: count,
      })
      .select()
      .single();
    if (error) {
      toast.error("Job-Erstellung fehlgeschlagen: " + error.message, { duration: 8000 });
      return;
    }
    toast.success(`KI plant ${count} Clips — du wirst weitergeleitet …`);
    const { analyzeVideo } = await import("@/lib/ai.functions");
    analyzeVideo({ data: { jobId: job.id, desiredClipCount: count } }).catch((e) =>
      toast.error(e instanceof Error ? e.message : "KI-Analyse fehlgeschlagen", {
        duration: 10000,
      }),
    );
    navigate({ to: "/app/job/$id", params: { id: job.id } });
  }

  const suggestedByTpl = recommendedCount(duration, tpl.targetLenS, tpl.defaultCount);
  const soundsForMood = MUSIC_LIBRARY.filter((t) => t.mood === tpl.musicMood).slice(0, 4);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
            <Wand2 className="h-3 w-3" /> Clipping
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Aus einem Video viele Clips machen
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            YouTube-Link oder Datei → wähle Vorlage, Anzahl, Länge & Format. KI empfiehlt die beste
            Anzahl passend zum Inhalt.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Brand ·{" "}
          </span>
          <span className="font-medium">{activeBrand?.name ?? "— keiner —"}</span>
        </div>
      </div>

      {!activeBrand && (
        <div className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs text-primary">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Bitte links in der Sidebar einen Brand wählen — jedes Clipping-Ergebnis wird diesem
            Brand zugeordnet.
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
        {/* Konfiguration */}
        <div
          className={`space-y-5 rounded-2xl border border-border bg-card p-5 ${activeBrand ? "" : "pointer-events-none opacity-60"}`}
        >
          {/* Templates */}
          <div>
            <div className="mb-2 text-xs font-medium">1 · Virale Vorlage</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CLIP_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickTemplate(t.id)}
                  className={`rounded-lg border p-3 text-left transition ${templateId === t.id ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"}`}
                >
                  <div className="text-sm">
                    {t.emoji} <span className="font-semibold">{t.label}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{t.short}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Quelle */}
          <div>
            <div className="mb-2 text-xs font-medium">2 · Rohvideo</div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="group relative flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-background/40 p-6 text-center transition hover:border-primary/60"
              >
                <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
                  <UploadCloud className="h-5 w-5" />
                </div>
                <div className="text-sm font-medium">Datei ablegen</div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  MP4 · MOV · WEBM · MKV
                </div>
                {busy && progress > 0 && (
                  <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/*"
                  disabled={busy}
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const d = await probeDuration(f).catch(() => null);
                    setDuration(d);
                    handleFile(f);
                  }}
                />
              </button>
              <div className="flex flex-col justify-center gap-2 rounded-xl border border-border bg-background/40 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Link2 className="h-4 w-4 text-accent" /> YouTube / Video-URL
                </div>
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && handleUrl()}
                  placeholder="https://youtube.com/watch?v=…"
                  className="rounded-md border border-border bg-input px-2.5 py-2 text-sm outline-none focus:border-primary"
                />
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Titel (optional)"
                  className="rounded-md border border-border bg-input px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* Parameter */}
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium">3 · Anzahl & Länge</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                KI empfiehlt: {suggestedByTpl} Clips
              </span>
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-background/40 p-4">
              <label className="block text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Clips</span>
                  <span className="font-mono">{count}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="mt-1 flex gap-1">
                  {[3, 5, 10, 20, 30].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      className={`flex-1 rounded border px-2 py-1 text-[11px] ${count === n ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary"}`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    onClick={() => setCount(suggestedByTpl)}
                    className="flex-1 rounded border border-accent/60 bg-accent/10 px-2 py-1 text-[11px] text-accent"
                  >
                    Auto
                  </button>
                </div>
              </label>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">Min Länge (s)</span>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={minLen}
                    onChange={(e) => setMinLen(parseInt(e.target.value) || 5)}
                    className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1 outline-none focus:border-primary"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">Max Länge (s)</span>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={maxLen}
                    onChange={(e) => setMaxLen(parseInt(e.target.value) || 60)}
                    className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1 outline-none focus:border-primary"
                  />
                </label>
                <div>
                  <span className="text-[10px] text-muted-foreground">Format</span>
                  <div className="mt-1 flex gap-1">
                    {(["9:16", "16:9", "1:1"] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => setAspect(a)}
                        className={`flex-1 rounded-md border px-1 py-1 text-[11px] ${aspect === a ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary"}`}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={captions}
                  onChange={(e) => setCaptions(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Untertitel automatisch generieren (Karaoke-Style bei UGC-Vorlagen)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={aiExplain}
                  onChange={(e) => setAiExplain(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                KI-Erklärungen — Kontext-Overlay je Szene (was passiert gerade?)
              </label>
            </div>
          </div>

          {busy && (
            <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs text-primary">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <div className="flex-1">
                <div className="font-semibold">{busyLabel || "Wird verarbeitet …"}</div>
                <div className="text-[11px] text-muted-foreground">
                  Die KI liest den Inhalt und wählt die besten Momente. Bei langen Videos bitte
                  etwas Geduld — du wirst automatisch zum Editor weitergeleitet.
                </div>
              </div>
              {progress > 0 && <div className="font-mono text-[10px]">{progress}%</div>}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-[11px] text-muted-foreground">
              Ergebnis landet im Editor · Brand{" "}
              <span className="font-medium text-foreground">{activeBrand?.name ?? "—"}</span>
            </div>
            <button
              onClick={handleUrl}
              disabled={busy || !urlInput || !activeBrand}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" /> {busy ? "Läuft …" : `${count} Clips generieren`}{" "}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Rechte Seite: Sounds + zuletzt */}
        <aside className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Music2 className="h-4 w-4 text-accent" /> Virale Sounds · {moodLabel(tpl.musicMood)}
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">
              Werden automatisch unter deine Clips gelegt (im Editor austauschbar).
            </p>
            <ul className="space-y-2">
              {soundsForMood.length === 0 && (
                <li className="text-[11px] text-muted-foreground">
                  Diese Vorlage nutzt Original-Ton.
                </li>
              )}
              {soundsForMood.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-2 text-xs"
                >
                  <PreviewButton url={s.url} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {s.bpm} BPM · {Math.round(s.duration_s)}s
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-2 text-sm font-medium">Zuletzt geclippt</div>
            {!activeBrand ? (
              <p className="text-[11px] text-muted-foreground">
                Brand wählen, um vergangene Clipping-Jobs zu sehen.
              </p>
            ) : recentQ.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-background" />
                ))}
              </div>
            ) : (recentQ.data ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Noch keine Clipping-Jobs in diesem Brand.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {(recentQ.data ?? []).map((j) => {
                  const rv = j.raw_videos as { title?: string } | null;
                  return (
                    <li key={j.id}>
                      <button
                        onClick={() => navigate({ to: "/app/job/$id", params: { id: j.id } })}
                        className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs hover:border-border hover:bg-background/60"
                      >
                        <span className="flex-1 truncate">{rv?.title ?? "Video"}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {j.desired_clip_count ?? "?"}×
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${j.status === "ready" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}
                        >
                          {j.status}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {ytDialog && (
        <YouTubeImportDialog
          open
          host={ytDialog.host}
          onClose={() => setYtDialog(null)}
          onUseDirectUrl={(u) => {
            setYtDialog(null);
            setUrlInput(u);
            commitUrl(u);
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

function PreviewButton({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLAudioElement | null>(null);
  return (
    <>
      <button
        onClick={() => {
          if (!ref.current) return;
          if (playing) {
            ref.current.pause();
            setPlaying(false);
          } else {
            ref.current.play().catch(() => {});
            setPlaying(true);
          }
        }}
        className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
      >
        <Play className="h-3 w-3" />
      </button>
      <audio ref={ref} src={url} onEnded={() => setPlaying(false)} preload="none" />
    </>
  );
}

function moodLabel(m: MusicMood) {
  return (
    {
      hype: "Hype",
      chill: "Chill",
      cinematic: "Cinematic",
      energetic: "Energetic",
      emotional: "Emotional",
      none: "Kein Sound",
    } as const
  )[m];
}

function recommendedCount(
  duration: number | null,
  range: [number, number],
  fallback: number | null,
): number {
  const avg = (range[0] + range[1]) / 2;
  if (!duration || duration < range[0]) return Math.max(1, fallback ?? 5);
  const raw = Math.floor((duration * 0.55) / avg);
  return Math.max(1, Math.min(30, raw || fallback || 5));
}

function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v.duration) ? v.duration : null);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
}
