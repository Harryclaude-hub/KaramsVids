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
    supabase.storage.from("raw-videos").createSignedUrl(videoQ.data.storage_path, 3600).then(({ data }) => {
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
      if (!videoQ.data?.brand_id) throw new Error("Video hat kein Profil");
      const { data: job, error } = await supabase.from("edit_jobs").insert({
        user_id: user.id,
        raw_video_id: id,
        brand_id: videoQ.data.brand_id,
        mode,
        options: { captions, aspect: mode === "ugc_shorts" || mode === "long_to_many" ? "9:16" : "16:9" },
      }).select().single();
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
    const { error } = await supabase.from("raw_videos").update({ brand_id: newBrandId }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Profil geändert");
    qc.invalidateQueries({ queryKey: ["raw_video", id] });
    videoQ.refetch();
  }

  const v = videoQ.data;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Link to="/app" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Zurück</Link>
      {!v ? <div className="h-40 animate-pulse rounded-[18px] bg-secondary" /> : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-muted-foreground">Video</p>
              <h1 className="mt-1 text-[30px] font-semibold tracking-tight">{v.title}</h1>
              <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
                {v.duration_s ? `${Math.round(Number(v.duration_s))}s` : "unbekannte Länge"} · Status: {v.status}
              </p>
            </div>
            <label className="flex items-center gap-3 text-[13px]">
              <span className="font-semibold text-muted-foreground">Profil</span>
              <select
                value={v.brand_id ?? ""}
                onChange={(e) => e.target.value && changeBrand(e.target.value)}
                className="h-9 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
              >
                <option value="" disabled>Profil wählen</option>
                {(brandsQ.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          </div>


          <div className="overflow-hidden rounded-[18px] border border-border bg-black">
            {signedUrl ? (
              <video src={signedUrl} controls className="aspect-video w-full" />
            ) : v.source_url ? (
              <div className="grid aspect-video place-items-center bg-secondary text-[15px] text-muted-foreground">
                Externer Link: <a href={v.source_url} target="_blank" rel="noreferrer" className="ml-1 text-accent hover:underline">öffnen</a>
              </div>
            ) : (
              <div className="grid aspect-video place-items-center bg-secondary"><Play className="h-10 w-10 text-muted-foreground" /></div>
            )}
          </div>

          <div className="rounded-[18px] border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight"><Wand2 className="h-4 w-4 text-primary" /> Neuen Schnitt starten</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(
                [
                  { v: "ugc_shorts" as const, t: "UGC Shorts", d: "3–6 vertikale Clips mit starken Hooks" },
                  { v: "long_to_many" as const, t: "Long → Many", d: "10+ Shorts aus einem langen Video" },
                  { v: "auto_cut" as const, t: "Auto Cut", d: "Ein straff geschnittener Clip" },
                  { v: "manual" as const, t: "Manual", d: "Vorschlag mit 3 Cuts, du entscheidest" },
                ]
              ).map((o) => (
                <button key={o.v} onClick={() => setMode(o.v)} className={`rounded-[14px] border p-4 text-left transition-colors ${mode === o.v ? "border-primary bg-card ring-1 ring-primary" : "border-border bg-background hover:bg-secondary/60"}`}>
                  <div className="text-[15px] font-semibold">{o.t}</div>
                  <div className="mt-1 text-[13px] text-muted-foreground">{o.d}</div>
                </button>
              ))}
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-3 text-[15px]">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="h-[18px] w-[18px] accent-primary" />
              Untertitel automatisch generieren
            </label>

            <button onClick={() => createJob.mutate()} disabled={createJob.isPending} className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]">
              <Sparkles className="h-4 w-4" /> {createJob.isPending ? "KI analysiert…" : "KI-Analyse starten"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
