import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Plus,
  Sparkles,
  UploadCloud,
  Trash2,
  Loader2,
  AlertTriangle,
  Clock,
  UserRoundPlus,
  Replace,
  Film,
  ImageIcon,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useActiveBrandId, useBrands } from "@/lib/use-active-brand";
import { getProviderStatus, runGenerationQueue } from "@/lib/generation.functions";

export const Route = createFileRoute("/_authenticated/app/avatars")({
  component: AvatarStudio,
});

function AvatarStudio() {
  const { user } = Route.useRouteContext();
  const [activeBrandId] = useActiveBrandId();
  const brandsQ = useBrands(user.id);
  const activeBrand = (brandsQ.data ?? []).find((b) => b.id === activeBrandId) ?? null;

  const [genPrompt, setGenPrompt] = useState("");
  const [genName, setGenName] = useState("");
  const [tablesMissing, setTablesMissing] = useState(false);
  const [uploadingRef, setUploadingRef] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Overlap-Sektion
  const [overlapVideoId, setOverlapVideoId] = useState("");
  const [overlapAvatarId, setOverlapAvatarId] = useState("");
  const [overlapMode, setOverlapMode] = useState<"face" | "full">("face");

  const modelsQ = useQuery({
    queryKey: ["avatar_models", user.id, activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avatar_models" as any)
        .select("*")
        .eq("brand_id", activeBrandId!)
        .order("created_at", { ascending: false });
      if (error) {
        if (error.code === "42P01" || /does not exist|relation/.test(error.message)) {
          setTablesMissing(true);
          return [];
        }
        throw error;
      }
      setTablesMissing(false);
      return data ?? [];
    },
  });

  const videosQ = useQuery({
    queryKey: ["raw_videos_for_overlap", user.id, activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_videos")
        .select("id,title,duration_s")
        .eq("brand_id", activeBrandId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobsQ = useQuery({
    queryKey: ["generation_jobs", user.id, activeBrandId, "avatar"],
    enabled: !!activeBrandId && !tablesMissing,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generation_jobs" as any)
        .select("*")
        .eq("brand_id", activeBrandId!)
        .in("kind", ["model", "overlap"])
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  const providerQ = useQuery({
    queryKey: ["provider_status"],
    queryFn: () => getProviderStatus(),
    staleTime: 60_000,
  });
  const providers = providerQ.data as { fal: boolean } | undefined;

  const [processing, setProcessing] = useState(false);
  async function processQueue() {
    setProcessing(true);
    try {
      const res = await runGenerationQueue();
      if (res.processed > 0) toast.success(`${res.processed} Job(s) verarbeitet`);
      jobsQ.refetch();
      modelsQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verarbeitung fehlgeschlagen");
    } finally {
      setProcessing(false);
    }
  }

  async function queueModelGeneration() {
    if (!activeBrand) return toast.error("Bitte zuerst ein Profil wählen");
    const p = genPrompt.trim();
    if (!p) return toast.error("Beschreibe die Person / das Model");
    const { error } = await supabase.from("generation_jobs" as any).insert({
      user_id: user.id,
      brand_id: activeBrand.id,
      kind: "model",
      prompt: p,
      options: { name: genName.trim() || null },
      status: "waiting_provider",
    } as any);
    if (error) return toast.error(error.message);
    toast.success(
      providers?.fal
        ? "Model wird generiert"
        : "Eingereiht: startet automatisch, sobald der FAL_KEY hinterlegt ist",
    );
    setGenPrompt("");
    setGenName("");
    jobsQ.refetch();
    processQueue();
  }

  async function uploadReference(file: File) {
    if (!activeBrand) return toast.error("Bitte zuerst ein Profil wählen");
    setUploadingRef(true);
    try {
      const key = `${user.id}/${activeBrand.id}/avatars/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("raw-videos").upload(key, file, {
        contentType: file.type || "image/jpeg",
      });
      if (upErr) throw upErr;
      const { error } = await supabase.from("avatar_models" as any).insert({
        user_id: user.id,
        brand_id: activeBrand.id,
        name: file.name.replace(/\.[^.]+$/, ""),
        kind: "uploaded",
        image_path: key,
      } as any);
      if (error) throw error;
      toast.success("Referenzbild gespeichert");
      modelsQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setUploadingRef(false);
    }
  }

  async function queueOverlap() {
    if (!activeBrand) return toast.error("Bitte zuerst ein Profil wählen");
    if (!overlapVideoId) return toast.error("Bitte ein Video wählen");
    if (!overlapAvatarId) return toast.error("Bitte ein Avatar-Model wählen");
    const model = (modelsQ.data ?? []).find((m: any) => m.id === overlapAvatarId);
    const video = (videosQ.data ?? []).find((v) => v.id === overlapVideoId);
    const { error } = await supabase.from("generation_jobs" as any).insert({
      user_id: user.id,
      brand_id: activeBrand.id,
      kind: "overlap",
      raw_video_id: overlapVideoId,
      avatar_model_id: overlapAvatarId,
      prompt: `${overlapMode === "face" ? "Face-Swap" : "Full-Body-Overlap"}: „${(model as any)?.name ?? "?"}" auf „${video?.title ?? "?"}"`,
      options: { mode: overlapMode },
      status: "waiting_provider",
    } as any);
    if (error) return toast.error(error.message);
    toast.success(
      providers?.fal
        ? "Overlap wird verarbeitet"
        : "Eingereiht: startet automatisch, sobald der FAL_KEY hinterlegt ist",
    );
    jobsQ.refetch();
    processQueue();
  }

  const models = (modelsQ.data ?? []) as any[];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
          <Users className="h-4 w-4" /> Avatare & Models
        </p>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight">
          Menschen generieren & overlappen
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Erzeuge KI-Models für dein Profil, oder filme dich selbst und lege ein Model per Overlap
          über dein Video.
        </p>
      </div>

      {!activeBrand && (
        <div className="flex items-start gap-2 rounded-[11px] border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>Wähle links ein Profil, um Avatare zu verwalten.</span>
        </div>
      )}

      {tablesMissing && (
        <div className="flex items-start gap-2 rounded-[11px] border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Die Studio-Tabellen sind noch nicht migriert. Die Migration liegt im Repo und wird beim
            nächsten Lovable-Sync/Publish angewendet.
          </span>
        </div>
      )}

      <div
        className={`grid gap-4 lg:grid-cols-2 ${activeBrand ? "" : "pointer-events-none opacity-50"}`}
      >
        {/* Model generieren */}
        <div className="space-y-4 rounded-[18px] border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <UserRoundPlus className="h-4 w-4 text-primary" /> Neues Model generieren
          </div>
          <input
            value={genName}
            onChange={(e) => setGenName(e.target.value)}
            placeholder={'Name (z.B. „Lena, Profil-Gesicht“)'}
            className="h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
          />
          <textarea
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            placeholder={
              'Beschreibung: Alter, Look, Stil, Setting … (z.B. „Frau, Ende 20, sportlich, natürliches Lächeln, Studio-Licht“)'
            }
            rows={3}
            className="min-h-[96px] w-full rounded-[11px] border border-border bg-input px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
          />
          <div className="flex gap-2">
            <button
              onClick={queueModelGeneration}
              disabled={!genPrompt.trim() || tablesMissing}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
            >
              <Sparkles className="h-4 w-4" /> Generieren
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingRef || tablesMissing}
              className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-border bg-card px-5 text-[15px] font-semibold text-foreground hover:bg-secondary disabled:opacity-40"
            >
              {uploadingRef ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}{" "}
              Foto hochladen
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadReference(e.target.files[0])}
            />
          </div>
          <p className="text-[13px] text-muted-foreground">
            Generierte Models starten, sobald ein Bild-Provider (z.B. Flux, Imagen) verbunden ist.
            Eigene Fotos sind sofort als Referenz nutzbar.
          </p>

          {/* Model-Galerie */}
          <div className="grid grid-cols-3 gap-3 pt-2">
            {models.map((m) => (
              <AvatarCard
                key={m.id}
                model={m}
                onDelete={async () => {
                  await supabase
                    .from("avatar_models" as any)
                    .delete()
                    .eq("id", m.id);
                  modelsQ.refetch();
                }}
              />
            ))}
            {models.length === 0 && (
              <div className="col-span-3 rounded-[11px] border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
                Noch keine Models für dieses Profil.
              </div>
            )}
          </div>
        </div>

        {/* Overlap */}
        <div className="space-y-4 rounded-[18px] border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Replace className="h-4 w-4 text-primary" /> Overlap: Model auf dein Video legen
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Film dich selbst (Gestik, Bewegung, Sprache), das gewählte Model wird per KI über dich
            gelegt. Dein Timing bleibt, das Gesicht/der Körper wird ersetzt.
          </p>
          <label className="block">
            <span className="text-[13px] font-semibold text-muted-foreground">
              Dein Video
            </span>
            <select
              value={overlapVideoId}
              onChange={(e) => setOverlapVideoId(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
            >
              <option value="">Video wählen</option>
              {(videosQ.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                  {v.duration_s ? ` (${Math.round(Number(v.duration_s))}s)` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold text-muted-foreground">
              Model
            </span>
            <select
              value={overlapAvatarId}
              onChange={(e) => setOverlapAvatarId(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
            >
              <option value="">Model wählen</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid h-9 grid-cols-2 gap-1 rounded-[10px] bg-secondary p-[3px] text-[13px]">
            <button
              onClick={() => setOverlapMode("face")}
              className={`rounded-[8px] px-3 font-semibold transition-colors ${overlapMode === "face" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Nur Gesicht (Face-Swap)
            </button>
            <button
              onClick={() => setOverlapMode("full")}
              className={`rounded-[8px] px-3 font-semibold transition-colors ${overlapMode === "full" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Ganzer Körper
            </button>
          </div>
          <button
            onClick={queueOverlap}
            disabled={!overlapVideoId || !overlapAvatarId || tablesMissing}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
          >
            <Film className="h-4 w-4" /> Overlap starten
          </button>
        </div>
      </div>

      {/* Jobs */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
          <Clock className="h-4 w-4" /> Avatar-Jobs
          <button
            onClick={processQueue}
            disabled={processing}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground hover:bg-[#dcdce1] disabled:opacity-40 dark:hover:bg-[#3a3a3c]"
            title="Queue jetzt verarbeiten"
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Verarbeiten
          </button>
        </div>
        {(jobsQ.data ?? []).length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
            Noch keine Avatar- oder Overlap-Jobs.
          </div>
        ) : (
          <div className="space-y-2">
            {(jobsQ.data ?? []).map((j: any) => (
              <div
                key={j.id}
                className="flex items-center gap-3 rounded-[18px] border border-border bg-card p-4 text-[13px]"
              >
                {j.status === "running" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                ) : j.kind === "model" ? (
                  <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Replace className="h-4 w-4 shrink-0 text-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{j.prompt}</div>
                  <div className="text-[13px] text-muted-foreground tabular-nums">
                    {new Date(j.created_at).toLocaleString()} · {j.kind}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${j.status === "waiting_provider" ? "bg-warning/15 text-warning" : j.status === "done" ? "bg-success/15 text-success" : j.status === "failed" ? "bg-destructive/15 text-destructive" : "bg-secondary text-muted-foreground"}`}
                >
                  {j.status === "waiting_provider" ? "wartet auf Provider" : j.status}
                </span>
                {j.output_url && j.kind === "overlap" && (
                  <a
                    href={j.output_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 shrink-0 items-center rounded-full bg-secondary px-3 text-[12px] font-semibold text-foreground hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"
                  >
                    Ansehen
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AvatarCard({ model, onDelete }: { model: any; onDelete: () => void }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!model.image_path) return;
    supabase.storage
      .from("raw-videos")
      .createSignedUrl(model.image_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setImgUrl(data.signedUrl);
      });
  }, [model.image_path]);
  return (
    <div className="group relative overflow-hidden rounded-[11px] border border-border bg-background">
      <div className="aspect-square w-full">
        {imgUrl ? (
          <img src={imgUrl} alt={model.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <Users className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="truncate px-2 py-1.5 text-[12px] font-semibold">{model.name}</div>
      <button
        onClick={onDelete}
        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-card/80 text-muted-foreground opacity-0 backdrop-blur hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
