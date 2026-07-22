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
    if (!activeBrand) return toast.error("Bitte zuerst einen Brand wählen");
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
        : "Eingereiht — startet automatisch, sobald der FAL_KEY hinterlegt ist",
    );
    setGenPrompt("");
    setGenName("");
    jobsQ.refetch();
    processQueue();
  }

  async function uploadReference(file: File) {
    if (!activeBrand) return toast.error("Bitte zuerst einen Brand wählen");
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
    if (!activeBrand) return toast.error("Bitte zuerst einen Brand wählen");
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
        : "Eingereiht — startet automatisch, sobald der FAL_KEY hinterlegt ist",
    );
    jobsQ.refetch();
    processQueue();
  }

  const models = (modelsQ.data ?? []) as any[];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
          <Users className="h-3 w-3" /> Avatare & Models
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Menschen generieren & overlappen
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Erzeuge KI-Models für deinen Brand — oder filme dich selbst und lege ein Model per Overlap
          über dein Video.
        </p>
      </div>

      {!activeBrand && (
        <div className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs text-primary">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Wähle links einen Brand, um Avatare zu verwalten.</span>
        </div>
      )}

      {tablesMissing && (
        <div className="flex items-start gap-2 rounded-xl border border-accent/40 bg-accent/5 p-3 text-xs text-accent">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
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
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserRoundPlus className="h-4 w-4 text-primary" /> Neues Model generieren
          </div>
          <input
            value={genName}
            onChange={(e) => setGenName(e.target.value)}
            placeholder={'Name (z.B. „Lena — Brand-Gesicht")'}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <textarea
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            placeholder={
              'Beschreibung: Alter, Look, Stil, Setting … (z.B. „Frau, Ende 20, sportlich, natürliches Lächeln, Studio-Licht")'
            }
            rows={3}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <button
              onClick={queueModelGeneration}
              disabled={!genPrompt.trim() || tablesMissing}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" /> Generieren
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingRef || tablesMissing}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-secondary"
            >
              {uploadingRef ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadCloud className="h-3.5 w-3.5" />
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
          <p className="text-[10px] text-muted-foreground">
            Generierte Models starten, sobald ein Bild-Provider (z.B. Flux, Imagen) verbunden ist.
            Eigene Fotos sind sofort als Referenz nutzbar.
          </p>

          {/* Model-Galerie */}
          <div className="grid grid-cols-3 gap-2 pt-2">
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
              <div className="col-span-3 rounded-lg border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
                Noch keine Models für diesen Brand.
              </div>
            )}
          </div>
        </div>

        {/* Overlap */}
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Replace className="h-4 w-4 text-accent" /> Overlap: Model auf dein Video legen
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Film dich selbst (Gestik, Bewegung, Sprache) — das gewählte Model wird per KI über dich
            gelegt. Dein Timing bleibt, das Gesicht/der Körper wird ersetzt.
          </p>
          <label className="block text-xs">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Dein Video
            </span>
            <select
              value={overlapVideoId}
              onChange={(e) => setOverlapVideoId(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-input px-2.5 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">— Video wählen —</option>
              {(videosQ.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                  {v.duration_s ? ` (${Math.round(Number(v.duration_s))}s)` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Model
            </span>
            <select
              value={overlapAvatarId}
              onChange={(e) => setOverlapAvatarId(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-input px-2.5 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">— Model wählen —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-1 text-xs">
            <button
              onClick={() => setOverlapMode("face")}
              className={`rounded-md border px-2 py-2 ${overlapMode === "face" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}
            >
              Nur Gesicht (Face-Swap)
            </button>
            <button
              onClick={() => setOverlapMode("full")}
              className={`rounded-md border px-2 py-2 ${overlapMode === "full" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}
            >
              Ganzer Körper
            </button>
          </div>
          <button
            onClick={queueOverlap}
            disabled={!overlapVideoId || !overlapAvatarId || tablesMissing}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Film className="h-4 w-4" /> Overlap starten
          </button>
        </div>
      </div>

      {/* Jobs */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-muted-foreground" /> Avatar-Jobs
          <button
            onClick={processQueue}
            disabled={processing}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary disabled:opacity-50"
            title="Queue jetzt verarbeiten"
          >
            {processing ? <Loader2 className="h-3 w-3 animate-spin" /> : "↻"} Verarbeiten
          </button>
        </div>
        {(jobsQ.data ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Noch keine Avatar- oder Overlap-Jobs.
          </div>
        ) : (
          <div className="space-y-1.5">
            {(jobsQ.data ?? []).map((j: any) => (
              <div
                key={j.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-xs"
              >
                {j.status === "running" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                ) : j.kind === "model" ? (
                  <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Replace className="h-4 w-4 shrink-0 text-accent" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{j.prompt}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {new Date(j.created_at).toLocaleString()} · {j.kind}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${j.status === "waiting_provider" ? "bg-accent/20 text-accent" : j.status === "done" ? "bg-primary/20 text-primary" : j.status === "failed" ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"}`}
                >
                  {j.status === "waiting_provider" ? "wartet auf Provider" : j.status}
                </span>
                {j.output_url && j.kind === "overlap" && (
                  <a
                    href={j.output_url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded border border-primary px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                  >
                    ▶ Ansehen
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
    <div className="group relative overflow-hidden rounded-lg border border-border bg-background">
      <div className="aspect-square w-full">
        {imgUrl ? (
          <img src={imgUrl} alt={model.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <Users className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="truncate px-1.5 py-1 text-[10px]">{model.name}</div>
      <button
        onClick={onDelete}
        className="absolute right-1 top-1 rounded bg-background/80 p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
