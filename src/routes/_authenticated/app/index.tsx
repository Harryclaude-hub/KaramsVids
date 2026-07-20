import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Film, Sparkles, Clock } from "lucide-react";
import { useActiveBrandId, useBrands } from "@/lib/use-active-brand";

export const Route = createFileRoute("/_authenticated/app/")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [brandId] = useActiveBrandId();
  const brandsQ = useBrands(user.id);
  const activeBrand = brandsQ.data?.find((b) => b.id === brandId) ?? null;

  const videosQ = useQuery({
    queryKey: ["raw_videos", user.id, brandId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("raw_videos").select("*").order("created_at", { ascending: false }).limit(20);
      if (brandId) q = q.eq("brand_id", brandId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobsQ = useQuery({
    queryKey: ["edit_jobs", user.id, brandId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("edit_jobs").select("*, raw_videos(title)").order("created_at", { ascending: false }).limit(10);
      if (brandId) q = q.eq("brand_id", brandId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Dashboard</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {activeBrand ? activeBrand.name : "Alle Videos"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeBrand ? "Aktiver Brand — Uploads & Jobs werden diesem Brand zugeordnet." : "Kein Brand aktiv — Uploads bleiben ohne Zuordnung."}
          </p>
        </div>
        <button onClick={() => navigate({ to: "/app/upload" })} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Upload className="h-4 w-4" /> Neues Video
        </button>
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"><Film className="h-4 w-4" /> Rohvideos</h2>
        {videosQ.isLoading ? <SkeletonGrid /> : (videosQ.data?.length ?? 0) === 0 ? (
          <EmptyState onClick={() => navigate({ to: "/app/upload" })} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {videosQ.data!.map((v) => (
              <Link key={v.id} to="/app/video/$id" params={{ id: v.id }} className="group rounded-xl border border-border bg-card p-4 transition hover:border-primary/50">
                <div className="mb-3 flex aspect-video items-center justify-center rounded-lg bg-background/60">
                  <Film className="h-8 w-8 text-muted-foreground group-hover:text-primary" />
                </div>
                <div className="truncate text-sm font-medium">{v.title}</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {v.duration_s ? `${Math.round(Number(v.duration_s))}s` : "—"} · {new Date(v.created_at).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"><Sparkles className="h-4 w-4" /> Schnitt-Aufträge</h2>
        {jobsQ.isLoading ? <SkeletonList /> : (jobsQ.data?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Noch keine Aufträge — öffne ein Video und starte die KI-Analyse.</div>
        ) : (
          <div className="space-y-2">
            {jobsQ.data!.map((j: any) => (
              <Link key={j.id} to="/app/job/$id" params={{ id: j.id }} className="flex items-center justify-between rounded-lg border border-border bg-card p-4 hover:border-primary/50">
                <div>
                  <div className="text-sm font-medium">{j.raw_videos?.title ?? "Video"}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">Modus: {j.mode} · {new Date(j.created_at).toLocaleString()}</div>
                </div>
                <span className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${statusColor(j.status)}`}>
                  <Clock className="mr-1 inline h-3 w-3" />{j.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function statusColor(s: string) {
  return {
    pending: "bg-muted text-muted-foreground",
    analyzing: "bg-accent/20 text-accent",
    ready: "bg-primary/20 text-primary",
    rendering: "bg-accent/20 text-accent",
    done: "bg-primary/20 text-primary",
    failed: "bg-destructive/20 text-destructive",
  }[s] ?? "bg-muted text-muted-foreground";
}

function SkeletonGrid() {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => (
    <div key={i} className="aspect-video animate-pulse rounded-xl bg-card" />
  ))}</div>;
}
function SkeletonList() {
  return <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-card" />)}</div>;
}
function EmptyState({ onClick }: { onClick: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center">
      <Film className="mx-auto h-10 w-10 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">Noch keine Videos. Lade dein erstes Rohmaterial hoch.</p>
      <button onClick={onClick} className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        <Upload className="h-4 w-4" /> Video hochladen
      </button>
    </div>
  );
}
