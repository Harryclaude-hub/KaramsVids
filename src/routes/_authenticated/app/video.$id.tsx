import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Wand2, Play, ArrowLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type EditMode = Database["public"]["Enums"]["edit_mode"];

export const Route = createFileRoute("/_authenticated/app/video/$id")({
  component: VideoDetail,
});

function VideoDetail() {
  const { id } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<EditMode>("ugc_shorts");
  const [captions, setCaptions] = useState(true);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const videoQ = useQuery({
    queryKey: ["raw_video", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_videos").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!videoQ.data?.storage_path) return;
    supabase.storage
      .from("raw-videos")
      .createSignedUrl(videoQ.data.storage_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setSignedUrl(data.signedUrl);
      });
  }, [videoQ.data?.storage_path]);

  const brandsQ = useQuery({
    queryKey: ["brands", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("*").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const createJob = useMutation({
    mutationFn: async () => {
      if (!videoQ.data?.brand_id) throw new Error("Video hat keinen Brand");
      const { data: job, error } = await supabase
        .from("edit_jobs")
        .insert({
          user_id: user.id,
          raw_video_id: id,
          brand_id: videoQ.data.brand_id,
          mode,
          options: {
            captions,
            aspect: mode === "ugc_shorts" || mode === "long_to_many" ? "9:16" : "16:9",
          },
        })
        .select()
        .single();
      if (error) throw error;

      const { analyzeVideo } = await import("@/lib/ai.functions");
      await analyzeVideo({ data: { jobId: job.id } });
      return job;
    },
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ["edit_jobs"] });
      toast.success("KI-Analyse fertig");
      navigate({ to: "/app/job/$id", params: { id: job.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Analyse fehlgeschlagen"),
  });

  async function changeBrand(newBrandId: string) {
    const { error } = await supabase
      .from("raw_videos")
      .update({ brand_id: newBrandId })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Brand geändert");
    qc.invalidateQueries({ queryKey: ["raw_video", id] });
    videoQ.refetch();
  }

  const v = videoQ.data;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Link
        to="/app"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Zurück
      </Link>
      {!v ? (
        <div className="h-40 animate-pulse rounded-xl bg-card" />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-primary">Video</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{v.title}</h1>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {v.duration_s ? `${Math.round(Number(v.duration_s))}s` : "unbekannte Länge"} ·
                Status: {v.status}
              </p>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Brand
              </span>
              <select
                value={v.brand_id ?? ""}
                onChange={(e) => e.target.value && changeBrand(e.target.value)}
                className="rounded-md border border-border bg-input px-2 py-1 text-sm outline-none focus:border-primary"
              >
                <option value="" disabled>
                  — wählen —
                </option>
                {(brandsQ.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-black">
            {signedUrl ? (
              <video src={signedUrl} controls className="aspect-video w-full" />
            ) : v.source_url ? (
              <div className="grid aspect-video place-items-center text-sm text-muted-foreground">
                Externer Link:{" "}
                <a
                  href={v.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-primary underline"
                >
                  öffnen
                </a>
              </div>
            ) : (
              <div className="grid aspect-video place-items-center">
                <Play className="h-10 w-10 text-muted-foreground" />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Wand2 className="h-4 w-4 text-primary" /> Neuen Schnitt starten
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                {
                  v: "ugc_shorts" as const,
                  t: "UGC Shorts",
                  d: "3–6 vertikale Clips mit starken Hooks",
                },
                {
                  v: "long_to_many" as const,
                  t: "Long → Many",
                  d: "10+ Shorts aus einem langen Video",
                },
                { v: "auto_cut" as const, t: "Auto Cut", d: "Ein straff geschnittener Clip" },
                { v: "manual" as const, t: "Manual", d: "Vorschlag mit 3 Cuts, du entscheidest" },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setMode(o.v)}
                  className={`rounded-xl border p-4 text-left transition ${mode === o.v ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"}`}
                >
                  <div className="text-sm font-medium">{o.t}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{o.d}</div>
                </button>
              ))}
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={captions}
                onChange={(e) => setCaptions(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Untertitel automatisch generieren
            </label>

            <button
              onClick={() => createJob.mutate()}
              disabled={createJob.isPending}
              className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />{" "}
              {createJob.isPending ? "KI analysiert…" : "KI-Analyse starten"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
