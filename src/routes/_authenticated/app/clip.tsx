import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wand2, UploadCloud, Link2, Sparkles, ChevronRight, AlertTriangle, Music2, Play } from "lucide-react";
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
    if (!activeBrand) return toast.error("Bitte oben links ein Profil wählen");
    setBusy(true); setProgress(5); setBusyLabel("Upload läuft …");
    try {
      const key = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("raw-videos").upload(key, file, { contentType: file.type || "video/mp4", upsert: false });
      if (upErr) throw new Error("Upload fehlgeschlagen: " + upErr.message);
      setProgress(70); setBusyLabel("Metadaten werden gelesen …");
      const dur = await probeDuration(file).catch(() => null);
      setBusyLabel("Job wird erstellt …");
      const { data: row, error: dbErr } = await supabase.from("raw_videos").insert({
        user_id: user.id, brand_id: activeBrand.id,
        title: title || file.name, storage_path: key, size_bytes: file.size, duration_s: dur,
      }).select().single();
      if (dbErr) throw new Error("Datenbank-Fehler: " + dbErr.message);
      setProgress(100);
      await startClipping(row.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen", { duration: 8000 });
    } finally { setBusy(false); setProgress(0); setBusyLabel(""); }
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
    if (!activeBrand) return toast.error("Bitte oben links ein Profil wählen");
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
    setBusy(true); setBusyLabel("Link wird gespeichert …");
    try {
      const { data: row, error } = await supabase.from("raw_videos").insert({
        user_id: user.id, brand_id: activeBrand.id,
        title: title || url, source_url: url,
      }).select().single();
      if (error) throw new Error("Speichern fehlgeschlagen: " + error.message);

      // YouTube & Co.: MP4-Import läuft im Hintergrund, während die KI plant
      if (detectRestrictedHost(url) && providersQ.data?.any) {
        toast.info("MP4-Download gestartet, läuft im Hintergrund (1 bis 3 Min)");
        import("@/lib/youtube.functions").then(({ importYouTubeVideo }) =>
          importYouTubeVideo({ data: { rawVideoId: row.id } })
            .then(() => toast.success("YouTube-Video als MP4 importiert"))
            .catch((e) =>
              toast.error(
                "MP4-Import: " + (e instanceof Error ? e.message : "fehlgeschlagen"),
                { duration: 10000 },
              ),
            ),
        );
      }

      await startClipping(row.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen", { duration: 8000 });
    } finally { setBusy(false); setBusyLabel(""); }
  }

  async function startClipping(rawVideoId: string) {
    if (!activeBrand) return;
    setBusyLabel("Auftrag an den Worker übergeben …");
    const { data: job, error } = await supabase.from("edit_jobs").insert({
      user_id: user.id, raw_video_id: rawVideoId, brand_id: activeBrand.id,
      mode: tpl.mode, options: { captions, aspect, ai_explain: aiExplain, template_id: templateId, min_len_s: minLen, max_len_s: maxLen, music_mood: tpl.musicMood },
      desired_clip_count: count,
    }).select().single();
    if (error) { toast.error("Job-Erstellung fehlgeschlagen: " + error.message, { duration: 8000 }); return; }
    toast.success(`${count} Clips beim Worker eingereiht, Fortschritt im Editor`);
    const { analyzeVideo } = await import("@/lib/ai.functions");
    analyzeVideo({ data: { jobId: job.id, desiredClipCount: count } })
      .catch((e) => toast.error(e instanceof Error ? e.message : "KI-Analyse fehlgeschlagen", { duration: 10000 }));
    navigate({ to: "/app/job/$id", params: { id: job.id } });
  }

  const suggestedByTpl = recommendedCount(duration, tpl.targetLenS, tpl.defaultCount);
  const soundsForMood = MUSIC_LIBRARY.filter((t) => t.mood === tpl.musicMood).slice(0, 4);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <Wand2 className="h-3.5 w-3.5 text-primary" /> Clipping
          </p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-tight">Aus einem Video viele Clips machen</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            YouTube-Link oder Datei, dann Vorlage, Anzahl, Länge und Format wählen. Die KI empfiehlt die beste Anzahl passend zum Inhalt.
          </p>
        </div>
        <div className="rounded-[11px] border border-border bg-card px-3 py-2 text-[13px]">
          <span className="font-semibold text-muted-foreground">Profil · </span>
          <span className="font-semibold">{activeBrand?.name ?? "keins"}</span>
        </div>
      </div>

      {!activeBrand && (
        <div className="flex items-start gap-2 rounded-[11px] border border-warning/30 bg-warning/15 p-3 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>Bitte links in der Seitenleiste ein Profil wählen: jedes Clipping-Ergebnis wird diesem Profil zugeordnet.</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
        {/* Konfiguration */}
        <div className={`space-y-5 rounded-[18px] border border-border bg-card p-6 ${activeBrand ? "" : "pointer-events-none opacity-60"}`}>
          {/* Templates */}
          <div>
            <div className="mb-2 text-[13px] font-semibold text-muted-foreground">1 · Virale Vorlage</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CLIP_TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => pickTemplate(t.id)}
                  className={`rounded-[11px] border p-3 text-left transition-colors ${templateId === t.id ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-secondary/60"}`}>
                  <div className="text-[15px]">{t.emoji} <span className="font-semibold">{t.label}</span></div>
                  <div className="mt-1 text-[13px] text-muted-foreground">{t.short}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Quelle */}
          <div>
            <div className="mb-2 text-[13px] font-semibold text-muted-foreground">2 · Rohvideo</div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="group relative flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-background p-6 text-center transition-colors hover:border-primary/60">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-primary"><UploadCloud className="h-5 w-5" /></div>
                <div className="text-[15px] font-semibold">Datei ablegen</div>
                <div className="text-[13px] text-muted-foreground">MP4 · MOV · WEBM · MKV</div>
                {busy && progress > 0 && (
                  <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                )}
                <input ref={fileRef} type="file" accept="video/*" disabled={busy} className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const d = await probeDuration(f).catch(() => null); setDuration(d);
                    handleFile(f);
                  }} />
              </button>
              <div className="flex flex-col justify-center gap-2 rounded-[14px] border border-border bg-background p-4">
                <div className="flex items-center gap-2 text-[15px] font-semibold"><Link2 className="h-4 w-4 text-primary" /> YouTube / Video-URL</div>
                <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && handleUrl()}
                  placeholder="https://youtube.com/watch?v=…"
                  className="h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel (optional)"
                  className="h-9 w-full rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />
              </div>
            </div>
          </div>

          {/* Parameter */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-muted-foreground">3 · Anzahl & Länge</span>
              <span className="text-[13px] text-muted-foreground">KI empfiehlt: {suggestedByTpl} Clips</span>
            </div>
            <div className="space-y-3 rounded-[14px] border border-border bg-background p-4">
              <label className="block text-[13px]">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Clips</span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </div>
                <input type="range" min={1} max={100} value={count} onChange={(e) => setCount(parseInt(e.target.value))} className="w-full accent-primary" />
                <div className="mt-1 flex gap-1">
                  {[3, 5, 10, 20, 30].map((n) => (
                    <button key={n} onClick={() => setCount(n)} className={`flex-1 rounded-full border px-2 py-1 text-[12px] font-semibold transition-colors ${count === n ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-secondary"}`}>{n}</button>
                  ))}
                  <button onClick={() => setCount(suggestedByTpl)} className="flex-1 rounded-full border border-primary/40 px-2 py-1 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/5">Auto</button>
                </div>
              </label>
              <div className="grid grid-cols-3 gap-2 text-[13px]">
                <label className="block">
                  <span className="text-[13px] text-muted-foreground">Min Länge (s)</span>
                  <input type="number" min={5} max={180} value={minLen} onChange={(e) => setMinLen(parseInt(e.target.value) || 5)}
                    className="mt-1 h-9 w-full rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/60" />
                </label>
                <label className="block">
                  <span className="text-[13px] text-muted-foreground">Max Länge (s)</span>
                  <input type="number" min={5} max={180} value={maxLen} onChange={(e) => setMaxLen(parseInt(e.target.value) || 60)}
                    className="mt-1 h-9 w-full rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/60" />
                </label>
                <div>
                  <span className="text-[13px] text-muted-foreground">Format</span>
                  <div className="mt-1 flex gap-1">
                    {(["9:16", "16:9", "1:1"] as const).map((a) => (
                      <button key={a} onClick={() => setAspect(a)} className={`h-9 flex-1 rounded-[9px] border px-1 text-[12px] font-semibold transition-colors ${aspect === a ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-secondary"}`}>{a}</button>
                    ))}
                  </div>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="h-4 w-4 accent-primary" />
                Untertitel automatisch generieren (Karaoke-Style bei UGC-Vorlagen)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" checked={aiExplain} onChange={(e) => setAiExplain(e.target.checked)} className="h-4 w-4 accent-primary" />
                KI-Erklärungen: Kontext-Overlay je Szene (was passiert gerade?)
              </label>
            </div>
          </div>

          {busy && (
            <div className="flex items-center gap-3 rounded-[11px] border border-border bg-secondary p-3 text-[13px]">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <div className="flex-1">
                <div className="font-semibold text-foreground">{busyLabel || "Wird verarbeitet …"}</div>
                <div className="text-[13px] text-muted-foreground">Die KI liest den Inhalt und wählt die besten Momente. Bei langen Videos bitte etwas Geduld, du wirst automatisch zum Editor weitergeleitet.</div>
              </div>
              {progress > 0 && <div className="text-[13px] font-semibold tabular-nums">{progress}%</div>}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-[13px] text-muted-foreground">
              Ergebnis landet im Editor · Profil <span className="font-semibold text-foreground">{activeBrand?.name ?? "keins"}</span>
            </div>
            <button
              onClick={handleUrl}
              disabled={busy || !urlInput || !activeBrand}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]">
              <Sparkles className="h-4 w-4" /> {busy ? "Läuft …" : `${count} Clips generieren`} <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Rechte Seite: Sounds + zuletzt */}
        <aside className="space-y-5">
          <div className="rounded-[18px] border border-border bg-card p-6">
            <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
              <Music2 className="h-4 w-4 text-primary" /> Virale Sounds · {moodLabel(tpl.musicMood)}
            </div>
            <p className="mb-3 text-[13px] text-muted-foreground">Werden automatisch unter deine Clips gelegt (im Editor austauschbar).</p>
            <ul className="space-y-2">
              {soundsForMood.length === 0 && <li className="text-[13px] text-muted-foreground">Diese Vorlage nutzt Original-Ton.</li>}
              {soundsForMood.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-[11px] border border-border bg-background px-2.5 py-2 text-[13px]">
                  <PreviewButton url={s.url} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{s.title}</div>
                    <div className="text-[12px] text-muted-foreground tabular-nums">{s.bpm} BPM · {Math.round(s.duration_s)}s</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[18px] border border-border bg-card p-6">
            <div className="mb-2 text-[15px] font-semibold">Zuletzt geclippt</div>
            {!activeBrand ? (
              <p className="text-[13px] text-muted-foreground">Profil wählen, um vergangene Clipping-Jobs zu sehen.</p>
            ) : recentQ.isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-[11px] bg-secondary" />)}</div>
            ) : (recentQ.data ?? []).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Noch keine Clipping-Jobs in diesem Profil.</p>
            ) : (
              <ul className="space-y-1.5">
                {(recentQ.data ?? []).map((j) => {
                  const rv = j.raw_videos as { title?: string } | null;
                  return (
                    <li key={j.id}>
                      <button
                        onClick={() => navigate({ to: "/app/job/$id", params: { id: j.id } })}
                        className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary/60">
                        <span className="flex-1 truncate">{rv?.title ?? "Video"}</span>
                        <span className="text-[12px] text-muted-foreground tabular-nums">{j.desired_clip_count ?? "?"}×</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${j.status === "ready" ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}>{j.status}</span>
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
          open host={ytDialog.host}
          onClose={() => setYtDialog(null)}
          onUseDirectUrl={(u) => { setYtDialog(null); setUrlInput(u); commitUrl(u); }}
          onUploadFile={() => { setYtDialog(null); fileRef.current?.click(); }}
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
      <button onClick={() => {
        if (!ref.current) return;
        if (playing) { ref.current.pause(); setPlaying(false); }
        else { ref.current.play().catch(() => {}); setPlaying(true); }
      }} className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-primary transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
        <Play className="h-3.5 w-3.5" />
      </button>
      <audio ref={ref} src={url} onEnded={() => setPlaying(false)} preload="none" />
    </>
  );
}

function moodLabel(m: MusicMood) {
  return ({ hype: "Hype", chill: "Chill", cinematic: "Cinematic", energetic: "Energetic", emotional: "Emotional", none: "Kein Sound" } as const)[m];
}

function recommendedCount(duration: number | null, range: [number, number], fallback: number | null): number {
  const avg = (range[0] + range[1]) / 2;
  if (!duration || duration < range[0]) return Math.max(1, fallback ?? 5);
  const raw = Math.floor((duration * 0.55) / avg);
  return Math.max(1, Math.min(30, raw || fallback || 5));
}

function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata"; v.src = url;
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(v.duration) ? v.duration : null); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  });
}
