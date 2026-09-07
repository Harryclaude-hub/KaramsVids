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
      toast.success(`Profil „${b.name}“ erstellt`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Konnte Profil nicht anlegen");
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
      // Manuell schneiden: Editor-Projekt ohne KI anlegen, ein Clip über
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
    if (!activeBrand) return toast.error("Bitte zuerst ein Profil wählen");
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
      toast.success("Upload fertig, Editor öffnet");
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
    if (!activeBrand) return toast.error("Bitte zuerst ein Profil wählen");
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
      toast.success("Video-Link gespeichert, Editor öffnet");
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
      {/* Kopfzeile: Editor-Identität + Profil/Ordner inline */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <Scissors className="h-4 w-4" /> Editor
          </p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-tight">Neues Video schneiden</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Datei oder Link einfügen. KI schlägt Cuts vor, Timeline & Chat lassen dich alles
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
        <div className="flex items-start gap-3 rounded-[11px] border border-border bg-secondary/60 p-4 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Bitte oben rechts ein Profil wählen oder neu anlegen. Jedes Video gehört zu genau
            einem Profil.
          </span>
        </div>
      )}

      {/* Studio-Bereiche */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          to="/app/clip"
          className="group rounded-[18px] border border-border bg-card p-6 transition-colors hover:bg-secondary/40"
        >
          <Layers className="h-5 w-5 text-primary" />
          <div className="mt-3 text-[15px] font-semibold">Massen-Clipping</div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            YouTube-Link → bis zu 20 Szenen-Clips mit Untertiteln & Audioeffekten.
          </p>
        </Link>
        <Link
          to="/app/generate"
          className="group rounded-[18px] border border-border bg-card p-6 transition-colors hover:bg-secondary/40"
        >
          <Wand2 className="h-5 w-5 text-primary" />
          <div className="mt-3 text-[15px] font-semibold">KI-Studio</div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Komplette Videos generieren, Storylines mit Gedächtnis pro Profil.
          </p>
        </Link>
        <Link
          to="/app/avatars"
          className="group rounded-[18px] border border-border bg-card p-6 transition-colors hover:bg-secondary/40"
        >
          <Film className="h-5 w-5 text-primary" />
          <div className="mt-3 text-[15px] font-semibold">Avatare & Overlap</div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            KI-Models erzeugen und per Overlap über dein eigenes Video legen.
          </p>
        </Link>
      </div>

      {/* Editor-Aufnahme-Zone, volle Breite */}
      <div className="space-y-4">
        <div
          className={`space-y-5 rounded-[18px] border border-border bg-card p-6 transition-opacity ${brandReady ? "" : "pointer-events-none opacity-50"}`}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={onDrop}
        >
          {/* Meta-Zeile */}
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="block text-[13px] font-semibold text-foreground">
                Titel (optional)
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Kurzer Titel für das Video"
                className="mt-1.5 h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
              />
            </label>
            <label className="block">
              <span className="block text-[13px] font-semibold text-foreground">
                Ordner
              </span>
              <div className="mt-1.5 flex gap-2">
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="h-11 min-w-0 flex-1 rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
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
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Neuer Ordner"
                >
                  <FolderPlus className="h-4 w-4" />
                </button>
              </div>
            </label>
            <label className="block">
              <span className="block text-[13px] font-semibold text-foreground">
                Ziel-Plattform
              </span>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
              >
                <option value="">Keine</option>
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
              className="group relative flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[18px] border border-dashed border-border bg-background p-8 text-center transition-colors hover:bg-secondary/60"
            >
              <div className="grid h-14 w-14 place-items-center rounded-full border border-border bg-card text-primary">
                <UploadCloud className="h-7 w-7" />
              </div>
              <div>
                <div className="text-[15px] font-semibold">Datei ablegen oder klicken</div>
                <div className="mt-1 text-[13px] text-muted-foreground">
                  MP4 · MOV · WEBM · MKV · bis 500 MB
                </div>
              </div>
              {busy && progress > 0 && (
                <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-secondary">
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

            <div className="flex flex-col justify-center gap-3 rounded-[18px] border border-border bg-background p-6">
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <Link2 className="h-4 w-4 text-primary" /> Video-Link
              </div>
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && handleUrl()}
                placeholder="https://youtube.com/…  ·  https://tiktok.com/…"
                className="h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
              />
              <button
                onClick={handleUrl}
                disabled={busy || !urlInput || !brandReady}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
              >
                <ChevronRight className="h-4 w-4" /> In Editor öffnen
              </button>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Link wird gespeichert. Für YouTube/TikTok läuft der Download beim ersten Öffnen im
                Editor.
              </p>
            </div>
          </div>

          {/* Schnitt-Modus: manuell oder mit KI */}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setAutoAnalyze(false)}
              className={`flex items-start gap-3 rounded-[11px] border p-4 text-left text-[13px] transition-colors ${
                !autoAnalyze ? "border-primary bg-card ring-1 ring-primary" : "border-border bg-card hover:bg-secondary/60"
              }`}
            >
              <ScissorsIcon
                className={`mt-0.5 h-4 w-4 shrink-0 ${!autoAnalyze ? "text-primary" : "text-muted-foreground"}`}
              />
              <span>
                <span className="block text-[15px] font-semibold text-foreground">Selbst schneiden</span>
                <span className="text-muted-foreground">
                  Video öffnet direkt im Editor: Timeline, Trimmen, Text, Musik, Export. Keine KI
                  nötig.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setAutoAnalyze(true)}
              className={`flex items-start gap-3 rounded-[11px] border p-4 text-left text-[13px] transition-colors ${
                autoAnalyze ? "border-primary bg-card ring-1 ring-primary" : "border-border bg-card hover:bg-secondary/60"
              }`}
            >
              <Sparkles
                className={`mt-0.5 h-4 w-4 shrink-0 ${autoAnalyze ? "text-primary" : "text-muted-foreground"}`}
              />
              <span>
                <span className="block text-[15px] font-semibold text-foreground">KI schlägt Cuts vor</span>
                <span className="text-muted-foreground">
                  KI analysiert und setzt Clips, du kannst danach alles von Hand nachbessern.
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Bibliothek: unter dem Editor, volle Breite */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Layers className="h-4 w-4 text-primary" />
            {activeBrand ? `${activeBrand.name} · Bibliothek` : "Bibliothek"}
          </div>
          {activeBrand && (
            <Link
              to="/app/brand/$id"
              params={{ id: activeBrand.id }}
              className="ml-auto inline-flex h-9 items-center rounded-full bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"
            >
              Profil-Übersicht öffnen
            </Link>
          )}
        </div>
        {!activeBrand ? (
          <div className="rounded-[18px] border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
            Profil wählen, um Videos & laufende Schnitte anzuzeigen.
          </div>
        ) : libraryQ.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-[11px] bg-card" />
            ))}
          </div>
        ) : (
          <LibraryList jobs={libraryQ.data?.jobs ?? []} videos={libraryQ.data?.videos ?? []} />
        )}
      </section>

      {/* Immer sichtbar: Editor-Tools erkunden, auch ohne Video */}
      <section className="space-y-4 rounded-[18px] border border-border bg-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
              <Wand2 className="h-4 w-4 text-primary" /> Editor-Werkzeuge
            </div>
            <h2 className="mt-1 text-[19px] font-semibold tracking-tight">Vorlagen & virale Sounds, auch ohne Video erkunden</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Der Editor selbst ist für ein einzelnes Video. Für Massen-Clipping aus einem Long-Video → <Link to="/app/clip" className="text-accent hover:underline">Clipping-Bereich</Link>.</p>
          </div>
          <Link to="/app/clip" className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
            <Wand2 className="h-4 w-4" /> Zum Clipping-Bereich
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CLIP_TEMPLATES.map((t) => (
            <div key={t.id} className="rounded-[11px] border border-border bg-background p-4">
              <div className="text-[15px]"><span className="mr-1">{t.emoji}</span><span className="font-semibold">{t.label}</span></div>
              <div className="mt-1 text-[13px] text-muted-foreground">{t.short}</div>
              <div className="mt-1 text-[13px] text-muted-foreground">Mood: {t.musicMood} · Captions: {t.captions ? "an" : "aus"}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><Music2 className="h-4 w-4 text-primary" /> Virale Sounds anhören</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MUSIC_LIBRARY.slice(0, 8).map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-[11px] border border-border bg-background px-3 py-2.5 text-[13px]">
                <SoundPreview url={s.url} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{s.title}</div>
                  <div className="text-[12px] text-muted-foreground tabular-nums">{s.mood} · {s.bpm} BPM</div>
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
      }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
        <Play className="h-3.5 w-3.5" />
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
    <div className="flex items-center gap-2 rounded-[11px] border border-border bg-card px-3 py-2">
      <span className="text-[13px] font-semibold text-muted-foreground">
        Profil
      </span>
      <select
        value={activeBrand?.id ?? ""}
        onChange={(e) => onPick(e.target.value || null)}
        className="h-9 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
      >
        <option value="">Bitte wählen</option>
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
        className="grid h-8 w-8 place-items-center rounded-full text-[15px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        title="Neues Profil"
      >
        +
      </button>
      {creating && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newBrandName}
            onChange={(e) => setNewBrandName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmitNew();
            }}
            placeholder="Profilname"
            className="h-9 w-36 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
          />
          <button
            onClick={onSubmitNew}
            className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]"
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
    <div className="rounded-[18px] border border-border bg-card">
      <div className="flex border-b border-border text-[13px] font-semibold">
        <button
          onClick={() => setTab("jobs")}
          className={`flex-1 px-3 py-3 transition-colors ${tab === "jobs" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <span className="inline-flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Schnitte ({jobs.length})
          </span>
          {tab === "jobs" && <div className="mx-auto mt-1.5 h-0.5 w-8 rounded-full bg-primary" />}
        </button>
        <button
          onClick={() => setTab("videos")}
          className={`flex-1 px-3 py-3 transition-colors ${tab === "videos" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <span className="inline-flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5" /> Videos ({videos.length})
          </span>
          {tab === "videos" && <div className="mx-auto mt-1.5 h-0.5 w-8 rounded-full bg-primary" />}
        </button>
      </div>
      <div className="p-4">
        {items.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-muted-foreground">Noch nichts hier.</div>
        ) : tab === "jobs" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(items as any[]).map((j) => (
              <Link
                key={j.id}
                to="/app/job/$id"
                params={{ id: j.id }}
                className="flex items-start gap-3 rounded-[11px] border border-border bg-background p-4 text-[13px] transition-colors hover:bg-secondary/60"
              >
                {j.mode === "manual" ? (
                  <Scissors className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{j.raw_videos?.title ?? "Video"}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
                    <Clock className="mr-1 inline h-3 w-3" />
                    {new Date(j.created_at).toLocaleDateString()}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[12px] font-semibold text-foreground">
                      {j.mode === "manual" ? "manuell" : j.mode}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${statusColor(j.status)}`}
                    >
                      {j.status}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(items as any[]).map((v) => (
              <Link
                key={v.id}
                to="/app/video/$id"
                params={{ id: v.id }}
                className="flex items-start gap-3 rounded-[11px] border border-border bg-background p-4 text-[13px] transition-colors hover:bg-secondary/60"
              >
                <Play className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{v.title}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
                    {v.duration_s ? `${Math.round(Number(v.duration_s))}s` : "–"} ·{" "}
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
        pending: "bg-secondary text-muted-foreground",
        analyzing: "bg-warning/15 text-warning",
        ready: "bg-success/15 text-success",
        rendering: "bg-warning/15 text-warning",
        done: "bg-success/15 text-success",
        failed: "bg-destructive/15 text-destructive",
      } as Record<string, string>
    )[s] ?? "bg-secondary text-muted-foreground"
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
