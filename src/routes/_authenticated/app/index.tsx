import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  UploadCloud,
  Link2,
  FolderPlus,
  Sparkles,
  Film,
  Wand2,
  Layers,
  Clock,
  Play,
  Scissors,
  Scissors as ScissorsIcon,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useActiveBrandId, useBrands, useCreateBrand } from "@/lib/use-active-brand";
import { YouTubeImportDialog } from "@/components/editor/YouTubeImportDialog";
import { ClipsCountDialog } from "@/components/editor/ClipsCountDialog";
import { detectRestrictedHost, isDirectVideoUrl } from "@/lib/editor-types";
import { CLIP_TEMPLATES } from "@/lib/clip-templates";
import { MUSIC_LIBRARY } from "@/lib/music-library";
import { Music2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/")({
  component: EditorLanding,
});

function EditorLanding() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [activeBrandId, setActiveBrandId] = useActiveBrandId();
  const brandsQ = useBrands(user.id);
  const brands = brandsQ.data ?? [];
  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;
  const createBrand = useCreateBrand(user.id);

  const [creatingBrand, setCreatingBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  const [title, setTitle] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [ytDialog, setYtDialog] = useState<{ host: string; original: string } | null>(null);
  const [clipsDialog, setClipsDialog] = useState<{
    rawVideoId: string;
    duration: number | null;
  } | null>(null);

  useEffect(() => {
    setFolderId("");
  }, [activeBrandId]);

  const foldersQ = useQuery({
    queryKey: ["folders", user.id, activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("folders")
        .select("*")
        .eq("brand_id", activeBrandId!)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const libraryQ = useQuery({
    queryKey: ["library", user.id, activeBrandId ?? "none"],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const [videos, jobs] = await Promise.all([
        supabase
          .from("raw_videos")
          .select("*")
          .eq("brand_id", activeBrandId!)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("edit_jobs")
          .select("*, raw_videos(title)")
          .eq("brand_id", activeBrandId!)
          .order("created_at", { ascending: false })
          .limit(15),
      ]);
      if (videos.error) throw videos.error;
      if (jobs.error) throw jobs.error;
      return { videos: videos.data ?? [], jobs: jobs.data ?? [] };
    },
  });

  const brandReady = !!activeBrand;

  async function submitNewBrand() {
    const name = newBrandName.trim();
    if (!name) return;
    try {
      const b = await createBrand(name);
      setActiveBrandId(b.id);
      setNewBrandName("");
      setCreatingBrand(false);
      toast.success(`Brand „${b.name}" erstellt`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Konnte Brand nicht anlegen");
    }
  }

  async function newFolder() {
    if (!activeBrand) return;
    const name = window.prompt("Ordnername")?.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("folders")
      .insert({
        user_id: user.id,
        brand_id: activeBrand.id,
        name,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setFolderId(data.id);
    foldersQ.refetch();
  }

  async function afterInsertNavigate(rawVideoId: string, duration: number | null) {
    if (!autoAnalyze) {
      // Manuell schneiden: Editor-Projekt ohne KI anlegen — ein Clip über
      // die volle Länge, den man dann frei trimmen/splitten kann.
      await openManualEditor(rawVideoId, duration);
      return;
    }
    setClipsDialog({ rawVideoId, duration });
  }

  /** Legt ein Schnitt-Projekt ohne KI an und öffnet den Editor. */
  async function openManualEditor(rawVideoId: string, duration: number | null) {
    if (!activeBrand) return;
    try {
      const len = duration && duration > 0 ? duration : 60;
      const { data: job, error } = await supabase
        .from("edit_jobs")
        .insert({
          user_id: user.id,
          raw_video_id: rawVideoId,
          brand_id: activeBrand.id,
          mode: "manual",
          status: "ready",
          progress: 100,
          options: { captions: false, aspect: "9:16" },
          analysis: {
            transcript_summary: "",
            language: "de",
            segments: [{ start_s: 0, end_s: len, title: "Clip 1" }],
          },
        })
        .select()
        .single();
      if (error) throw error;
      navigate({ to: "/app/job/$id", params: { id: job.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Editor konnte nicht geöffnet werden");
      navigate({ to: "/app/video/$id", params: { id: rawVideoId } });
    }
  }

  async function startAnalysisWithConfig(cfg: {
    mode: "auto_cut" | "ugc_shorts" | "long_to_many" | "manual";
    desiredCount: number | null;
    captions: boolean;
    aspect: "9:16" | "16:9" | "1:1";
    templateId: string | null;
  }) {
    if (!clipsDialog || !activeBrand) return;
    const { rawVideoId } = clipsDialog;
    setClipsDialog(null);
    try {
      const { data: job, error } = await supabase
        .from("edit_jobs")
        .insert({
          user_id: user.id,
          raw_video_id: rawVideoId,
          brand_id: activeBrand.id,
          mode: cfg.mode,
          options: { captions: cfg.captions, aspect: cfg.aspect, template_id: cfg.templateId },
          desired_clip_count: cfg.desiredCount,
        })
        .select()
        .single();
      if (error) throw error;
      const { analyzeVideo } = await import("@/lib/ai.functions");
      analyzeVideo({
        data: { jobId: job.id, desiredClipCount: cfg.desiredCount ?? undefined },
      }).catch((e) => toast.error(e instanceof Error ? e.message : "KI-Fehler"));
      navigate({ to: "/app/job/$id", params: { id: job.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Konnte Editor nicht öffnen");
      navigate({ to: "/app/video/$id", params: { id: rawVideoId } });
    }
  }

  async function handleFile(file: File) {
    if (!activeBrand) return toast.error("Bitte zuerst einen Brand wählen");
    setBusy(true);
    setProgress(5);
    try {
      const key = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("raw-videos").upload(key, file, {
        contentType: file.type || "video/mp4",
        upsert: false,
      });
      if (upErr) throw upErr;
      setProgress(80);
      const duration = await probeDuration(file).catch(() => null);
      const { data: row, error: dbErr } = await supabase
        .from("raw_videos")
        .insert({
          user_id: user.id,
          brand_id: activeBrand.id,
          folder_id: folderId || null,
          platform: platform || null,
          title: title || file.name,
          storage_path: key,
          size_bytes: file.size,
          duration_s: duration,
        })
        .select()
        .single();
      if (dbErr) throw dbErr;
      setProgress(100);
      toast.success("Upload fertig — Editor öffnet");
      setTitle("");
      libraryQ.refetch();
      await afterInsertNavigate(row.id, duration);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  async function handleUrl() {
    if (!activeBrand) return toast.error("Bitte zuerst einen Brand wählen");
    const url = urlInput.trim();
    if (!url) return;
    const host = detectRestrictedHost(url);
    if (host && !isDirectVideoUrl(url)) {
      setYtDialog({ host, original: url });
      return;
    }
    await commitUrl(url);
  }

  async function commitUrl(url: string) {
    if (!activeBrand) return;
    setBusy(true);
    try {
      const { data: row, error } = await supabase
        .from("raw_videos")
        .insert({
          user_id: user.id,
          brand_id: activeBrand.id,
          folder_id: folderId || null,
          platform: platform || null,
          title: title || url,
          source_url: url,
        })
        .select()
        .single();
      if (error) throw error;
      toast.success("Video-Link gespeichert — Editor öffnet");
      setUrlInput("");
      setTitle("");
      libraryQ.refetch();
      await afterInsertNavigate(row.id, null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Kopfzeile — Editor-Identität + Brand/Folder inline */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
            <Scissors className="h-3 w-3" /> Editor
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Neues Video schneiden</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Datei oder Link einfügen — KI schlägt Cuts vor, Timeline & Chat lassen dich alles
            feintunen.
          </p>
        </div>
        <BrandHeader
          brands={brands}
          activeBrand={activeBrand}
          onPick={setActiveBrandId}
          creating={creatingBrand}
          onToggleCreate={() => setCreatingBrand((v) => !v)}
          newBrandName={newBrandName}
          setNewBrandName={setNewBrandName}
          onSubmitNew={submitNewBrand}
        />
      </div>

      {!brandReady && (
        <div className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs text-primary">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Bitte oben rechts einen Brand wählen oder neu anlegen — jedes Video gehört zu genau
            einem Brand.
          </span>
        </div>
      )}

      {/* Studio-Bereiche */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          to="/app/clip"
          className="group rounded-xl border border-border bg-card p-4 transition hover:border-primary/50"
        >
          <Layers className="h-5 w-5 text-primary" />
          <div className="mt-2 text-sm font-medium">Massen-Clipping</div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            YouTube-Link → bis zu 20 Szenen-Clips mit Untertiteln & Audioeffekten.
          </p>
        </Link>
        <Link
          to="/app/generate"
          className="group rounded-xl border border-border bg-card p-4 transition hover:border-primary/50"
        >
          <Wand2 className="h-5 w-5 text-accent" />
          <div className="mt-2 text-sm font-medium">KI-Studio</div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Komplette Videos generieren — Storylines mit Gedächtnis pro Brand.
          </p>
        </Link>
        <Link
          to="/app/avatars"
          className="group rounded-xl border border-border bg-card p-4 transition hover:border-primary/50"
        >
          <Film className="h-5 w-5 text-primary" />
          <div className="mt-2 text-sm font-medium">Avatare & Overlap</div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            KI-Models erzeugen und per Overlap über dein eigenes Video legen.
          </p>
        </Link>
      </div>

      {/* Editor-Aufnahme-Zone — volle Breite */}
      <div className="space-y-4">
        <div
          className={`space-y-4 rounded-2xl border border-border bg-card p-5 transition ${brandReady ? "" : "pointer-events-none opacity-50"}`}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={onDrop}
        >
          {/* Meta-Zeile */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Titel (optional)
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Kurzer Projekt-Titel"
                className="mt-1 w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block text-xs">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Ordner
              </span>
              <div className="mt-1 flex gap-1">
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="flex-1 rounded-md border border-border bg-input px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                >
                  <option value="">Kein Ordner</option>
                  {(foldersQ.data ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={newFolder}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-secondary"
                >
                  <FolderPlus className="h-3 w-3" />
                </button>
              </div>
            </label>
            <label className="block text-xs">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Ziel-Plattform
              </span>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm outline-none focus:border-primary"
              >
                <option value="">— Keine —</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="x">X (Twitter)</option>
              </select>
            </label>
          </div>

          {/* Aufnahme-Zonen: Drop + URL */}
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group relative flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-background/40 p-8 text-center transition hover:border-primary/60"
            >
              <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary transition group-hover:scale-105">
                <UploadCloud className="h-7 w-7" />
              </div>
              <div>
                <div className="text-sm font-medium">Datei ablegen oder klicken</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  MP4 · MOV · WEBM · MKV — bis 500 MB
                </div>
              </div>
              {busy && progress > 0 && (
                <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-background">
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
                disabled={busy || !brandReady}
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </button>

            <div className="flex flex-col justify-center gap-3 rounded-2xl border border-border bg-background/40 p-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Link2 className="h-4 w-4 text-accent" /> Video-Link
              </div>
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && handleUrl()}
                placeholder="https://youtube.com/…  ·  https://tiktok.com/…"
                className="rounded-md border border-border bg-input px-2.5 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={handleUrl}
                disabled={busy || !urlInput || !brandReady}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
              >
                <ChevronRight className="h-4 w-4" /> In Editor öffnen
              </button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Link wird gespeichert. Für YouTube/TikTok läuft der Download beim ersten Öffnen im
                Editor.
              </p>
            </div>
          </div>

          {/* Schnitt-Modus: manuell oder mit KI */}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setAutoAnalyze(false)}
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-left text-xs transition ${
                !autoAnalyze ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"
              }`}
            >
              <ScissorsIcon
                className={`mt-0.5 h-4 w-4 shrink-0 ${!autoAnalyze ? "text-primary" : "text-muted-foreground"}`}
              />
              <span>
                <span className="block font-medium text-foreground">Selbst schneiden</span>
                <span className="text-muted-foreground">
                  Video öffnet direkt im Editor — Timeline, Trimmen, Text, Musik, Export. Keine KI
                  nötig.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setAutoAnalyze(true)}
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-left text-xs transition ${
                autoAnalyze ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"
              }`}
            >
              <Sparkles
                className={`mt-0.5 h-4 w-4 shrink-0 ${autoAnalyze ? "text-primary" : "text-muted-foreground"}`}
              />
              <span>
                <span className="block font-medium text-foreground">KI schlägt Cuts vor</span>
                <span className="text-muted-foreground">
                  KI analysiert und setzt Clips — du kannst danach alles von Hand nachbessern.
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Bibliothek — unter dem Editor, volle Breite */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Layers className="h-4 w-4 text-primary" />
            {activeBrand ? `${activeBrand.name} · Bibliothek` : "Bibliothek"}
          </div>
          {activeBrand && (
            <Link
              to="/app/brand/$id"
              params={{ id: activeBrand.id }}
              className="ml-auto rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              Brand-Übersicht öffnen →
            </Link>
          )}
        </div>
        {!activeBrand ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Brand wählen, um Videos & laufende Schnitte anzuzeigen.
          </div>
        ) : libraryQ.isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-card" />
            ))}
          </div>
        ) : (
          <LibraryList jobs={libraryQ.data?.jobs ?? []} videos={libraryQ.data?.videos ?? []} />
        )}
      </section>

      {/* Immer sichtbar: Editor-Tools erkunden — auch ohne Video */}
      <section className="space-y-3 rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <Wand2 className="h-3 w-3 text-primary" /> Editor-Werkzeuge
            </div>
            <h2 className="mt-1 text-lg font-semibold">Vorlagen & virale Sounds — auch ohne Video erkunden</h2>
            <p className="text-xs text-muted-foreground">Der Editor selbst ist für ein einzelnes Video. Für Massen-Clipping aus einem Long-Video → <Link to="/app/clip" className="text-primary hover:underline">Clipping-Bereich</Link>.</p>
          </div>
          <Link to="/app/clip" className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15">
            <Wand2 className="h-3 w-3" /> Zum Clipping-Bereich
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CLIP_TEMPLATES.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-background/60 p-3">
              <div className="text-sm"><span className="mr-1">{t.emoji}</span><span className="font-semibold">{t.label}</span></div>
              <div className="mt-1 text-[10px] text-muted-foreground">{t.short}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">Mood: {t.musicMood} · Captions: {t.captions ? "an" : "aus"}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium"><Music2 className="h-3.5 w-3.5 text-accent" /> Virale Sounds — anhören</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {MUSIC_LIBRARY.slice(0, 8).map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-2 text-xs">
                <SoundPreview url={s.url} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.title}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{s.mood} · {s.bpm} BPM</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

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
      <ClipsCountDialog
        open={!!clipsDialog}
        duration={clipsDialog?.duration ?? null}
        onClose={() => {
          setClipsDialog(null);
          if (clipsDialog)
            navigate({ to: "/app/video/$id", params: { id: clipsDialog.rawVideoId } });
        }}
        onConfirm={startAnalysisWithConfig}
      />
    </div>
  );
}

function SoundPreview({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLAudioElement | null>(null);
  return (
    <>
      <button onClick={() => {
        if (!ref.current) return;
        if (playing) { ref.current.pause(); setPlaying(false); }
        else { ref.current.play().catch(() => {}); setPlaying(true); }
      }} className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary hover:bg-primary/20">
        <Play className="h-3 w-3" />
      </button>
      <audio ref={ref} src={url} onEnded={() => setPlaying(false)} preload="none" />
    </>
  );
}

function BrandHeader({
  brands,
  activeBrand,
  onPick,
  creating,
  onToggleCreate,
  newBrandName,
  setNewBrandName,
  onSubmitNew,
}: {
  brands: { id: string; name: string; color: string }[];
  activeBrand: { id: string; name: string; color: string } | null;
  onPick: (id: string | null) => void;
  creating: boolean;
  onToggleCreate: () => void;
  newBrandName: string;
  setNewBrandName: (v: string) => void;
  onSubmitNew: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Brand
      </span>
      <select
        value={activeBrand?.id ?? ""}
        onChange={(e) => onPick(e.target.value || null)}
        className="rounded-md border border-border bg-input px-2 py-1 text-sm outline-none focus:border-primary"
      >
        <option value="">— wählen —</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {activeBrand && (
        <span
          className="inline-block h-3 w-3 rounded-full border border-border"
          style={{ background: activeBrand.color }}
        />
      )}
      <button
        onClick={onToggleCreate}
        className="rounded-md border border-border p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        title="Neuer Brand"
      >
        +
      </button>
      {creating && (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={newBrandName}
            onChange={(e) => setNewBrandName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmitNew();
            }}
            placeholder="Brand-Name"
            className="w-36 rounded border border-border bg-input px-2 py-1 text-xs outline-none focus:border-primary"
          />
          <button
            onClick={onSubmitNew}
            className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}

function LibraryList({ jobs, videos }: { jobs: any[]; videos: any[] }) {
  const [tab, setTab] = useState<"jobs" | "videos">("jobs");
  const items = tab === "jobs" ? jobs : videos;
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex border-b border-border text-xs">
        <button
          onClick={() => setTab("jobs")}
          className={`flex-1 px-3 py-2 ${tab === "jobs" ? "text-foreground" : "text-muted-foreground"}`}
        >
          <span className="inline-flex items-center gap-1">
            <Wand2 className="h-3 w-3" /> Schnitte ({jobs.length})
          </span>
          {tab === "jobs" && <div className="mx-auto mt-1 h-0.5 w-8 bg-primary" />}
        </button>
        <button
          onClick={() => setTab("videos")}
          className={`flex-1 px-3 py-2 ${tab === "videos" ? "text-foreground" : "text-muted-foreground"}`}
        >
          <span className="inline-flex items-center gap-1">
            <Film className="h-3 w-3" /> Videos ({videos.length})
          </span>
          {tab === "videos" && <div className="mx-auto mt-1 h-0.5 w-8 bg-primary" />}
        </button>
      </div>
      <div className="p-3">
        {items.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Noch nichts hier.</div>
        ) : tab === "jobs" ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(items as any[]).map((j) => (
              <Link
                key={j.id}
                to="/app/job/$id"
                params={{ id: j.id }}
                className="flex items-start gap-2 rounded-lg border border-border bg-background/60 p-3 text-xs transition hover:border-primary/50 hover:bg-background"
              >
                {j.mode === "manual" ? (
                  <Scissors className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                ) : (
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{j.raw_videos?.title ?? "Video"}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    <Clock className="mr-1 inline h-2.5 w-2.5" />
                    {new Date(j.created_at).toLocaleDateString()}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                      {j.mode === "manual" ? "manuell" : j.mode}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${statusColor(j.status)}`}
                    >
                      {j.status}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(items as any[]).map((v) => (
              <Link
                key={v.id}
                to="/app/video/$id"
                params={{ id: v.id }}
                className="flex items-start gap-2 rounded-lg border border-border bg-background/60 p-3 text-xs transition hover:border-primary/50 hover:bg-background"
              >
                <Play className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{v.title}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {v.duration_s ? `${Math.round(Number(v.duration_s))}s` : "—"} ·{" "}
                    {new Date(v.created_at).toLocaleDateString()}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function statusColor(s: string) {
  return (
    (
      {
        pending: "bg-muted text-muted-foreground",
        analyzing: "bg-accent/20 text-accent",
        ready: "bg-primary/20 text-primary",
        rendering: "bg-accent/20 text-accent",
        done: "bg-primary/20 text-primary",
        failed: "bg-destructive/20 text-destructive",
      } as Record<string, string>
    )[s] ?? "bg-muted text-muted-foreground"
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
