import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Share2,
  Youtube,
  Instagram,
  Facebook,
  Link2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Unplug,
} from "lucide-react";
import { useActiveBrandId, useBrands } from "@/lib/use-active-brand";

export const Route = createFileRoute("/_authenticated/app/connections")({
  component: Connections,
});

type Platform = "tiktok" | "youtube" | "instagram" | "facebook" | "x";

const META: Record<Platform, { name: string; icon: typeof Share2; color: string; hint: string }> = {
  tiktok: {
    name: "TikTok",
    icon: Share2,
    color: "bg-primary/10 text-primary",
    hint: "Ohne TikTok-Audit landen Videos in den Entwürfen deines Accounts.",
  },
  youtube: {
    name: "YouTube",
    icon: Youtube,
    color: "bg-destructive/10 text-destructive",
    hint: "Direkter Shorts-Upload · ca. 6 Uploads/Tag im Free-Quota.",
  },
  instagram: {
    name: "Instagram",
    icon: Instagram,
    color: "bg-accent/10 text-accent",
    hint: "Business-Account + verknüpfte Facebook-Seite nötig. Reels-Upload direkt.",
  },
  facebook: {
    name: "Facebook",
    icon: Facebook,
    color: "bg-primary/10 text-primary",
    hint: "Postet auf die Seite, für die du Admin-Rechte hast.",
  },
  x: {
    name: "X (Twitter)",
    icon: Share2,
    color: "bg-muted text-foreground",
    hint: "Video-Upload erst ab Basic-Tier (kostenpflichtig).",
  },
};

function Connections() {
  const { user } = Route.useRouteContext();
  const [activeBrandId] = useActiveBrandId();
  const brandsQ = useBrands(user.id);
  const brands = brandsQ.data ?? [];
  const [brandId, setBrandId] = useState<string | null>(activeBrandId ?? null);
  const [connecting, setConnecting] = useState<Platform | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!brandId && brands.length) setBrandId(activeBrandId ?? brands[0].id);
  }, [brands, activeBrandId, brandId]);

  // Rückmeldung vom OAuth-Callback aus der URL lesen
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ok = p.get("connected");
    const err = p.get("error");
    if (ok) toast.success(`${p.get("platform") ?? "Account"} verbunden: ${ok}`);
    if (err) toast.error(`Verbindung fehlgeschlagen: ${err}`, { duration: 12000 });
    if (ok || err) window.history.replaceState({}, "", "/app/connections");
  }, []);

  const statusQ = useQuery({
    queryKey: ["social-platform-status"],
    staleTime: 60_000,
    queryFn: async () => {
      const { getSocialPlatformStatus } = await import("@/lib/social.functions");
      return getSocialPlatformStatus();
    },
  });

  const accountsQ = useQuery({
    queryKey: ["social-accounts", brandId ?? "none"],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_accounts")
        .select(
          "id, platform, handle, display_name, avatar_url, follower_count, status, expires_at, last_sync_at, sync_error",
        )
        .eq("brand_id", brandId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function connect(platform: Platform) {
    if (!brandId) return toast.error("Bitte zuerst einen Brand wählen");
    setConnecting(platform);
    try {
      const { startSocialConnect } = await import("@/lib/social.functions");
      const { url } = await startSocialConnect({
        data: { platform, brandId, origin: window.location.origin },
      });
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Start fehlgeschlagen", { duration: 14000 });
      setConnecting(null);
    }
  }

  async function disconnect(accountId: string) {
    try {
      const { disconnectSocialAccount } = await import("@/lib/social.functions");
      await disconnectSocialAccount({ data: { accountId } });
      toast.success("Verbindung getrennt");
      qc.invalidateQueries({ queryKey: ["social-accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Trennen fehlgeschlagen");
    }
  }

  const platformStatus = statusQ.data ?? [];
  const accounts = accountsQ.data ?? [];
  const missing = platformStatus.filter((p) => !p.configured);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Social</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Plattformen verbinden</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Verbindungen gelten <span className="font-medium text-foreground">pro Brand</span>. Jeder Brand kann beliebig
          viele Kanäle haben, auch mehrere auf derselben Plattform.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Brand</span>
        {brands.length === 0 && <span className="text-xs text-muted-foreground">Noch kein Brand angelegt.</span>}
        {brands.map((b) => (
          <button
            key={b.id}
            onClick={() => setBrandId(b.id)}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              brandId === b.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary"
            }`}
          >
            {b.name}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(META) as Platform[]).map((id) => {
          const m = META[id];
          const cfg = platformStatus.find((p) => p.platform === id);
          // Pro Plattform können beliebig viele Kanäle hängen.
          const connected = accounts.filter((a) => a.platform === id && a.status !== "disconnected");
          const configured = cfg?.configured ?? false;
          return (
            <div key={id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-lg ${m.color}`}>
                    <m.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {connected.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <CheckCircle2 className="h-3 w-3" />
                          {connected.length} {connected.length === 1 ? "Kanal" : "Kanäle"}
                        </span>
                      ) : configured ? (
                        "Nicht verbunden"
                      ) : (
                        "App-Keys fehlen"
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => connect(id)}
                  disabled={!brandId || connecting === id || !configured}
                  title={configured ? undefined : `Secrets ${cfg?.idEnv} & ${cfg?.secretEnv} fehlen noch`}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {connecting === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                  {connected.length > 0 ? "Weiteren verbinden" : "Verbinden"}
                </button>
              </div>

              {connected.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {connected.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {a.avatar_url ? (
                          <img src={a.avatar_url} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px]">
                            {(a.handle ?? a.display_name ?? "?").replace(/^@/, "").slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium">
                            {a.handle ?? a.display_name ?? "Kanal"}
                          </span>
                          {a.follower_count > 0 && (
                            <span className="block font-mono text-[10px] text-muted-foreground">
                              {a.follower_count.toLocaleString("de-DE")} Follower
                            </span>
                          )}
                        </span>
                      </span>
                      <button
                        onClick={() => disconnect(a.id)}
                        title="Trennen"
                        className="shrink-0 rounded-md border border-border p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
                      >
                        <Unplug className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{m.hint}</p>
              {connected
                .filter((a) => a.sync_error)
                .map((a) => (
                  <p key={a.id} className="mt-2 text-[11px] text-destructive">
                    {a.handle ?? "Kanal"}: {a.sync_error}
                  </p>
                ))}
              {!configured && cfg && (
                <a
                  href={cfg.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                >
                  App anlegen & Keys holen <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>

      {missing.length > 0 && (
        <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-4 text-xs">
          <div className="flex items-center gap-2 font-medium text-primary">
            <AlertTriangle className="h-3.5 w-3.5" /> Noch fehlende App-Keys
          </div>
          <ul className="space-y-1 text-muted-foreground">
            {missing.map((p) => (
              <li key={p.platform}>
                <span className="font-medium text-foreground">{p.label}</span> — {p.idEnv} + {p.secretEnv} ·{" "}
                <a href={p.docsUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {p.docsUrl}
                </a>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Trage bei der Developer-App als Redirect-URI ein:{" "}
            <code className="rounded bg-background px-1 py-0.5 font-mono text-[10px]">
              {typeof window !== "undefined" ? window.location.origin : ""}/api/public/oauth/&lt;plattform&gt;/callback
            </code>
          </p>
        </div>
      )}

      <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
        Sobald ein Account verbunden ist, kannst du unter{" "}
        <Link to="/app/publishing" className="text-primary hover:underline">
          Publishing
        </Link>{" "}
        Upload-Zeiten festlegen — die Warteschlange postet dann automatisch.
      </div>
    </div>
  );
}
