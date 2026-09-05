import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  BarChart3,
  RefreshCw,
  Loader2,
  Users,
  Eye,
  Heart,
  MessageSquare,
  Wallet,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { useBrands } from "@/lib/use-active-brand";
import { useActiveWorkspaceId, useEarnings } from "@/lib/use-workspace";

export const Route = createFileRoute("/_authenticated/app/tracking")({
  component: Tracking,
});

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
};

type AccountRow = {
  id: string;
  brand_id: string | null;
  platform: string;
  handle: string | null;
  display_name: string | null;
  follower_count: number;
  status: string;
  last_sync_at: string | null;
  sync_error: string | null;
};

type PostRow = {
  id: string;
  brand_id: string | null;
  social_account_id: string;
  platform: string;
  post_url: string | null;
  title: string | null;
  published_at: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
};

const RANGES = [
  [7, "7 Tage"],
  [30, "30 Tage"],
  [90, "90 Tage"],
  [0, "Alles"],
] as const;

const fmt = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)} Mio`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n);

function Tracking() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const brandsQ = useBrands(user.id);
  const brands = brandsQ.data ?? [];
  const [workspaceId] = useActiveWorkspaceId();
  const earningsQ = useEarnings(workspaceId);

  const [days, setDays] = useState<number>(30);
  const [syncing, setSyncing] = useState(false);

  const accountsQ = useQuery({
    queryKey: ["tracking-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_accounts")
        .select(
          "id, brand_id, platform, handle, display_name, follower_count, status, last_sync_at, sync_error",
        )
        .neq("status", "disconnected");
      if (error) throw error;
      return (data ?? []) as unknown as AccountRow[];
    },
  });

  const postsQ = useQuery({
    queryKey: ["tracking-posts", days],
    queryFn: async () => {
      let q = supabase
        .from("post_metrics")
        .select(
          "id, brand_id, social_account_id, platform, post_url, title, published_at, views, likes, comments, shares",
        )
        .order("views", { ascending: false })
        .limit(500);
      if (days > 0) {
        q = q.gte("published_at", new Date(Date.now() - days * 86_400_000).toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PostRow[];
    },
  });

  const openCommentsQ = useQuery({
    queryKey: ["tracking-open-comments"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("social_comments")
        .select("id", { count: "exact", head: true })
        .eq("status", "new");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const accounts = accountsQ.data ?? [];
  const posts = postsQ.data ?? [];
  const earnings = earningsQ.data ?? [];

  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const totals = useMemo(() => {
    const t = { views: 0, likes: 0, comments: 0, shares: 0, followers: 0, posts: posts.length };
    for (const p of posts) {
      t.views += p.views;
      t.likes += p.likes;
      t.comments += p.comments;
      t.shares += p.shares;
    }
    for (const a of accounts) t.followers += a.follower_count;
    return t;
  }, [posts, accounts]);

  const earnedTotal = useMemo(() => {
    const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0;
    return earnings
      .filter((e) => !cutoff || new Date(e.created_at).getTime() >= cutoff)
      .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
  }, [earnings, days]);

  // Zahlen je Kanal aus den Beitragsdaten aufsummieren.
  const perAccount = useMemo(() => {
    const map = new Map<
      string,
      { views: number; likes: number; comments: number; posts: number }
    >();
    for (const p of posts) {
      const cur = map.get(p.social_account_id) ?? { views: 0, likes: 0, comments: 0, posts: 0 };
      cur.views += p.views;
      cur.likes += p.likes;
      cur.comments += p.comments;
      cur.posts += 1;
      map.set(p.social_account_id, cur);
    }
    return map;
  }, [posts]);

  // Gruppierung nach Brand, damit jeder Bereich für sich lesbar bleibt.
  const grouped = useMemo(() => {
    const groups = new Map<string, AccountRow[]>();
    for (const a of accounts) {
      const key = a.brand_id ?? "ohne";
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    return [...groups.entries()].sort((a, b) => {
      const an = a[0] === "ohne" ? "zzz" : (brandById.get(a[0])?.name ?? "");
      const bn = b[0] === "ohne" ? "zzz" : (brandById.get(b[0])?.name ?? "");
      return an.localeCompare(bn);
    });
  }, [accounts, brandById]);

  async function refresh() {
    setSyncing(true);
    try {
      const { syncMetricsNow } = await import("@/lib/comments.functions");
      const r = await syncMetricsNow({ data: {} });
      toast.success(`${r.synced} Kanäle aktualisiert`);
      if (r.problems.length)
        toast.warning(r.problems.map((p) => `${p.account}: ${p.error}`).join("\n"), {
          duration: 14000,
        });
      qc.invalidateQueries({ queryKey: ["tracking-accounts"] });
      qc.invalidateQueries({ queryKey: ["tracking-posts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Aktualisieren fehlgeschlagen", {
        duration: 12000,
      });
    } finally {
      setSyncing(false);
    }
  }

  const loading = accountsQ.isLoading || postsQ.isLoading;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Auswertung</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Tracking</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Alle Kanäle, Reichweiten und Einnahmen deines aktiven Profils auf einen Blick.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-1">
            {RANGES.map(([d, label]) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  days === d
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Zahlen holen
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={Users} label="Follower" value={fmt(totals.followers)} hint="über alle Kanäle" />
        <Stat
          icon={Eye}
          label="Aufrufe"
          value={fmt(totals.views)}
          hint={`${totals.posts} Beiträge`}
        />
        <Stat icon={Heart} label="Likes" value={fmt(totals.likes)} />
        <Stat
          icon={MessageSquare}
          label="Kommentare"
          value={fmt(totals.comments)}
          hint={openCommentsQ.data ? `${openCommentsQ.data} offen` : undefined}
          hintTo="/app/comments"
        />
        <Stat
          icon={Wallet}
          label="Einnahmen"
          value={earnedTotal.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
          hint="erfasste Zahlungen"
        />
        <Stat
          icon={BarChart3}
          label="Kanäle"
          value={String(accounts.length)}
          hint={`${brands.length} Brands`}
        />
      </div>

      {accounts.some((a) => a.sync_error) && (
        <div className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
          {accounts
            .filter((a) => a.sync_error)
            .map((a) => (
              <p key={a.id} className="flex items-start gap-1.5 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  <span className="font-medium">{a.handle ?? PLATFORM_LABEL[a.platform]}:</span>{" "}
                  {a.sync_error}
                </span>
              </p>
            ))}
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
          <Loader2 className="mb-2 h-5 w-5 animate-spin" />
          Daten werden geladen
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Noch kein Kanal verbunden.{" "}
          <Link to="/app/connections" className="text-primary hover:underline">
            Jetzt verbinden
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {grouped.map(([brandId, list]) => (
              <div key={brandId} className="rounded-xl border border-border bg-card">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: brandById.get(brandId)?.color ?? "#888" }}
                  />
                  <span className="text-sm font-medium">
                    {brandId === "ohne" ? "Ohne Brand" : (brandById.get(brandId)?.name ?? "Brand")}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {list.length} {list.length === 1 ? "Kanal" : "Kanäle"}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {list.map((a) => {
                    const m = perAccount.get(a.id) ?? { views: 0, likes: 0, comments: 0, posts: 0 };
                    return (
                      <div
                        key={a.id}
                        className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm"
                      >
                        <div className="min-w-[180px] flex-1">
                          <div className="font-medium">{a.handle ?? a.display_name ?? "Kanal"}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {PLATFORM_LABEL[a.platform] ?? a.platform}
                            {a.last_sync_at &&
                              ` · Stand ${new Date(a.last_sync_at).toLocaleString("de-DE")}`}
                          </div>
                        </div>
                        <Cell label="Follower" value={fmt(a.follower_count)} />
                        <Cell label="Aufrufe" value={fmt(m.views)} />
                        <Cell label="Likes" value={fmt(m.likes)} />
                        <Cell label="Kommentare" value={fmt(m.comments)} />
                        <Cell label="Beiträge" value={String(m.posts)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-medium">
              Stärkste Beiträge {days > 0 ? `der letzten ${days} Tage` : "insgesamt"}
            </div>
            {posts.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Noch keine Beitragsdaten. Mit „Zahlen holen“ werden sie von den Plattformen
                abgerufen.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {posts.slice(0, 15).map((p) => {
                  const acc = accountById.get(p.social_account_id);
                  return (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm"
                    >
                      <div className="min-w-[200px] flex-1">
                        <div className="line-clamp-1 font-medium">{p.title ?? "Ohne Titel"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {PLATFORM_LABEL[p.platform] ?? p.platform}
                          {acc && ` · ${acc.handle ?? acc.display_name}`}
                          {p.published_at &&
                            ` · ${new Date(p.published_at).toLocaleDateString("de-DE")}`}
                        </div>
                      </div>
                      <Cell label="Aufrufe" value={fmt(p.views)} />
                      <Cell label="Likes" value={fmt(p.likes)} />
                      <Cell label="Kommentare" value={fmt(p.comments)} />
                      {p.post_url && (
                        <a
                          href={p.post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline"
                          title="Beitrag öffnen"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  hintTo,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
  hintTo?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      {hint &&
        (hintTo ? (
          <Link to={hintTo} className="text-[11px] text-primary hover:underline">
            {hint}
          </Link>
        ) : (
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        ))}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[70px]">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="tabular-nums">{value}</div>
    </div>
  );
}
