import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Film, Share2, BarChart3, Upload, Youtube, Instagram, Facebook, ArrowLeft } from "lucide-react";
import { useActiveBrandId } from "@/lib/use-active-brand";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/app/brand/$id")({
  component: BrandDetail,
});

const platforms = [
  { id: "tiktok", name: "TikTok", icon: Share2 },
  { id: "youtube", name: "YouTube", icon: Youtube },
  { id: "instagram", name: "Instagram", icon: Instagram },
  { id: "facebook", name: "Facebook", icon: Facebook },
  { id: "x", name: "X (Twitter)", icon: Share2 },
];

function BrandDetail() {
  const { id } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [, setActiveBrandId] = useActiveBrandId();

  // Activate this brand when the page opens so uploads land in it.
  useEffect(() => { setActiveBrandId(id); }, [id, setActiveBrandId]);

  const brandQ = useQuery({
    queryKey: ["brand", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const videosQ = useQuery({
    queryKey: ["raw_videos", user.id, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_videos").select("*, generated_clips(id)").eq("brand_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const accountsQ = useQuery({
    queryKey: ["social_accounts", user.id, id],
    queryFn: async () => {
      const { data, error } = await supabase.from("social_accounts").select("*").eq("brand_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const brand = brandQ.data;
  const videos = videosQ.data ?? [];
  const accounts = accountsQ.data ?? [];

  if (brandQ.isLoading) return <div className="animate-pulse text-sm text-muted-foreground">Lade Brand …</div>;
  if (!brand) return <div className="text-sm text-muted-foreground">Brand nicht gefunden.</div>;

  const totalClips = videos.reduce((sum, v: any) => sum + (v.generated_clips?.length ?? 0), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <button onClick={() => navigate({ to: "/app" })} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Zurück zum Dashboard
      </button>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl" style={{ background: brand.color }} />
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Brand</p>
            <h1 className="text-3xl font-semibold tracking-tight">{brand.name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">Aktiver Brand — neue Uploads werden hier abgelegt.</p>
          </div>
        </div>
        <button onClick={() => navigate({ to: "/app/upload" })} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Upload className="h-4 w-4" /> Video hinzufügen
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Videos" value={videos.length} />
        <Stat label="Generierte Clips" value={totalClips} />
        <Stat label="Verbundene Accounts" value={accounts.length} />
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"><Share2 className="h-4 w-4" /> Social-Accounts für {brand.name}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {platforms.map((p) => {
            const acc = accounts.find((a) => a.platform === p.id);
            return (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                    <p.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {acc ? `Verbunden${acc.handle ? ` · @${acc.handle}` : ""}` : "Nicht verbunden"}
                    </div>
                  </div>
                </div>
                <button disabled className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground opacity-70">
                  {acc ? "Verwalten" : "Bald"}
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Für jeden Brand kannst du eigene Accounts verbinden (z. B. mehrere Instagram-Profile).</p>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"><Film className="h-4 w-4" /> Video-History</h2>
        {videos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Noch keine Videos in diesem Brand.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Titel</th>
                  <th className="px-4 py-2">Dauer</th>
                  <th className="px-4 py-2">Clips</th>
                  <th className="px-4 py-2">Datum</th>
                  <th className="px-4 py-2 text-right">Analyse</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v: any) => (
                  <tr key={v.id} className="border-t border-border hover:bg-card/40">
                    <td className="px-4 py-3">
                      <Link to="/app/video/$id" params={{ id: v.id }} className="font-medium hover:text-primary">{v.title}</Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v.duration_s ? `${Math.round(Number(v.duration_s))}s` : "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v.generated_clips?.length ?? 0}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <Link to="/app/video/$id" params={{ id: v.id }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <BarChart3 className="h-3 w-3" /> Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"><BarChart3 className="h-4 w-4" /> Performance</h2>
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Views, Retention & Likes werden angezeigt, sobald Social-Accounts verbunden und Videos veröffentlicht sind. (Benötigt Plattform-API-Freigaben.)
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
