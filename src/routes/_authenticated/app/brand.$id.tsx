import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Film, Share2, BarChart3, Upload, Youtube, Instagram, Facebook, ArrowLeft,
  RefreshCw, Unlink, Plug, FolderPlus, Folder as FolderIcon, Search, ArrowUpDown,
  Pencil, Trash2, Loader2, Stamp,
} from "lucide-react";
import { useActiveBrandId, useBrands } from "@/lib/use-active-brand";
import { BrandAvatar } from "@/components/brand-avatar";
import { BrandIdentity } from "@/components/brand-identity";
import { BrandAutomations } from "@/components/brand-automations";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/brand/$id")({
  component: BrandDetail,
});

const FONT_OPTIONS: { value: string; label: string; className: string }[] = [
  { value: "sans", label: "Sans (Standard)", className: "font-sans" },
  { value: "serif", label: "Serif", className: "font-serif" },
  { value: "mono", label: "Mono", className: "font-mono" },
  { value: "display", label: "Display (fett)", className: "font-sans font-bold tracking-tight" },
];

function fontClass(v?: string | null): string {
  return FONT_OPTIONS.find((f) => f.value === v)?.className ?? "font-sans";
}

const platforms = [
  { id: "tiktok", name: "TikTok", icon: Share2 },
  { id: "youtube", name: "YouTube", icon: Youtube },
  { id: "instagram", name: "Instagram", icon: Instagram },
  { id: "facebook", name: "Facebook", icon: Facebook },
  { id: "x", name: "X (Twitter)", icon: Share2 },
] as const;

type SortKey = "title" | "duration_s" | "clips" | "created_at" | "platform" | "status";
type SortDir = "asc" | "desc";

function BrandDetail() {
  const { id } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [, setActiveBrandId] = useActiveBrandId();

  useEffect(() => { setActiveBrandId(id); }, [id, setActiveBrandId]);

  const allBrandsQ = useBrands(user.id);
  const allBrands = allBrandsQ.data ?? [];
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const wmFileRef = useRef<HTMLInputElement | null>(null);
  const [wmUploading, setWmUploading] = useState(false);
  const [editingBrand, setEditingBrand] = useState(false);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#0071e3");
  const [editFont, setEditFont] = useState<string>("sans");
  const [savingBrand, setSavingBrand] = useState(false);
  const [analyticsRange, setAnalyticsRange] = useState<string>("30d");
  const [analyticsPlatform, setAnalyticsPlatform] = useState<string>("all");

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
        .from("raw_videos")
        .select("*, generated_clips(id), folders(id,name)")
        .eq("brand_id", id)
        .order("created_at", { ascending: false });
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

  const foldersQ = useQuery({
    queryKey: ["folders", user.id, id],
    queryFn: async () => {
      const { data, error } = await supabase.from("folders").select("*").eq("brand_id", id).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const snapshotsQ = useQuery({
    queryKey: ["snapshots", user.id, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analytics_snapshots")
        .select("*")
        .eq("brand_id", id)
        .order("snapshot_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const brand = brandQ.data;
  const videos = videosQ.data ?? [];
  const accounts = accountsQ.data ?? [];
  const folders = foldersQ.data ?? [];
  const snapshots = snapshotsQ.data ?? [];

  // Filters + sort
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter] = useState<string>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filteredVideos = useMemo(() => {
    const now = Date.now();
    const rangeMs: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
    return videos
      .filter((v: any) => {
        if (search && !v.title?.toLowerCase().includes(search.toLowerCase())) return false;
        if (platformFilter !== "all" && v.platform !== platformFilter) return false;
        if (statusFilter !== "all" && v.status !== statusFilter) return false;
        if (folderFilter !== "all") {
          if (folderFilter === "none" && v.folder_id) return false;
          if (folderFilter !== "none" && v.folder_id !== folderFilter) return false;
        }
        if (rangeFilter !== "all" && rangeMs[rangeFilter]) {
          const cutoff = now - rangeMs[rangeFilter] * 86400_000;
          if (new Date(v.created_at).getTime() < cutoff) return false;
        }
        return true;
      })
      .sort((a: any, b: any) => {
        const dir = sortDir === "asc" ? 1 : -1;
        const av = sortKey === "clips" ? (a.generated_clips?.length ?? 0) : a[sortKey];
        const bv = sortKey === "clips" ? (b.generated_clips?.length ?? 0) : b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av > bv ? dir : av < bv ? -dir : 0;
      });
  }, [videos, search, platformFilter, statusFilter, rangeFilter, folderFilter, sortKey, sortDir]);

  const totalClips = videos.reduce((sum, v: any) => sum + (v.generated_clips?.length ?? 0), 0);

  // Aggregate latest metrics per account
  const latestByAccount = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of snapshots) {
      if (!map.has(s.social_account_id)) map.set(s.social_account_id, s);
    }
    return map;
  }, [snapshots]);

  const totals = useMemo(() => {
    const t = { views: 0, likes: 0, comments: 0, shares: 0 };
    for (const s of latestByAccount.values()) {
      const m = (s.metrics ?? {}) as any;
      t.views += Number(m.views ?? 0);
      t.likes += Number(m.likes ?? 0);
      t.comments += Number(m.comments ?? 0);
      t.shares += Number(m.shares ?? 0);
    }
    return t;
  }, [latestByAccount]);

  // Analytics-Aggregat: Views je Plattform im gewählten Zeitraum (aus allen Snapshots, nicht nur "latest")
  const platformStats = useMemo(() => {
    const now = Date.now();
    const rangeDays: Record<string, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };
    const days = rangeDays[analyticsRange] ?? null;
    const cutoff = days ? now - days * 86400_000 : 0;
    const agg = new Map<string, { views: number; likes: number; comments: number; shares: number; samples: number }>();
    for (const s of snapshots as any[]) {
      if (cutoff && new Date(s.snapshot_at).getTime() < cutoff) continue;
      if (analyticsPlatform !== "all" && s.platform !== analyticsPlatform) continue;
      const cur = agg.get(s.platform) ?? { views: 0, likes: 0, comments: 0, shares: 0, samples: 0 };
      const m = (s.metrics ?? {}) as any;
      cur.views += Number(m.views ?? 0);
      cur.likes += Number(m.likes ?? 0);
      cur.comments += Number(m.comments ?? 0);
      cur.shares += Number(m.shares ?? 0);
      cur.samples += 1;
      agg.set(s.platform, cur);
    }
    const rows = Array.from(agg.entries()).map(([platform, v]) => ({ platform, ...v }));
    rows.sort((a, b) => b.views - a.views);
    const totalViews = rows.reduce((s, r) => s + r.views, 0);
    return { rows, totalViews };
  }, [snapshots, analyticsRange, analyticsPlatform]);

  const lastSyncOverall = useMemo(() => {
    const times = accounts.map((a) => a.last_sync_at).filter(Boolean).map((t) => new Date(t!).getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  }, [accounts]);

  async function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function openBrandEditor() {
    if (!brand) return;
    setEditName(brand.name);
    setEditColor(brand.color ?? "#0071e3");
    setEditFont((brand as any).name_font ?? "sans");
    setEditingBrand(true);
  }

  async function saveBrand() {
    const name = editName.trim();
    if (!name) return toast.error("Name darf nicht leer sein");
    setSavingBrand(true);
    try {
      const { error } = await supabase
        .from("brands")
        .update({ name, color: editColor, name_font: editFont } as never)
        .eq("id", id);
      if (error) throw error;
      toast.success("Profil gespeichert");
      setEditingBrand(false);
      qc.invalidateQueries({ queryKey: ["brand", id] });
      qc.invalidateQueries({ queryKey: ["brands", user.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSavingBrand(false);
    }
  }

  async function deleteBrand() {
    if (!brand) return;
    const sure = window.confirm(
      `Profil „${brand.name}“ wirklich löschen?\n\n` +
        "• Videos bleiben erhalten, verlieren aber die Profil-Zuordnung\n" +
        "• Ordner, Storylines, Avatare und Generierungs-Jobs dieses Profils werden gelöscht\n\n" +
        "Das kann nicht rückgängig gemacht werden.",
    );
    if (!sure) return;
    const { error } = await supabase.from("brands").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Profil „${brand.name}“ gelöscht`);
    setActiveBrandId(null);
    qc.invalidateQueries({ queryKey: ["brands", user.id] });
    navigate({ to: "/app" });
  }

  async function uploadBrandAvatar(file: File) {
    setAvatarUploading(true);
    try {
      const key = `${user.id}/brand-avatars/${id}-${crypto.randomUUID()}.${(file.name.split(".").pop() ?? "jpg").toLowerCase()}`;
      const { error: upErr } = await supabase.storage.from("raw-videos").upload(key, file, {
        contentType: file.type || "image/jpeg",
        upsert: true,
      });
      if (upErr) throw upErr;
      const { error } = await supabase
        .from("brands")
        .update({ avatar_path: key } as never)
        .eq("id", id);
      if (error) throw error;
      toast.success("Profilbild gespeichert");
      qc.invalidateQueries({ queryKey: ["brand", id] });
      qc.invalidateQueries({ queryKey: ["brands", user.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function uploadWatermark(file: File) {
    setWmUploading(true);
    try {
      const key = `${user.id}/brand-watermarks/${id}-${crypto.randomUUID()}.${(file.name.split(".").pop() ?? "png").toLowerCase()}`;
      const { error: upErr } = await supabase.storage.from("raw-videos").upload(key, file, {
        contentType: file.type || "image/png",
        upsert: true,
      });
      if (upErr) throw upErr;
      const { error } = await supabase
        .from("brands")
        .update({ watermark_path: key, watermark_enabled: true } as never)
        .eq("id", id);
      if (error) throw error;
      toast.success("Wasserzeichen gespeichert, wird ab jetzt in Exporte eingeblendet");
      qc.invalidateQueries({ queryKey: ["brand", id] });
      qc.invalidateQueries({ queryKey: ["brand_watermark", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setWmUploading(false);
    }
  }

  async function patchWatermark(patch: Record<string, unknown>, msg?: string) {
    const { error } = await supabase.from("brands").update(patch as never).eq("id", id);
    if (error) return toast.error(error.message);
    if (msg) toast.success(msg);
    qc.invalidateQueries({ queryKey: ["brand", id] });
    qc.invalidateQueries({ queryKey: ["brand_watermark", id] });
  }

  async function duplicateVideo(v: any, targetBrandId: string) {
    if (!targetBrandId || targetBrandId === id) return;
    const target = allBrands.find((b) => b.id === targetBrandId);
    const { error } = await supabase.from("raw_videos").insert({
      user_id: user.id,
      brand_id: targetBrandId,
      title: v.title,
      source_url: v.source_url,
      storage_path: v.storage_path,
      duration_s: v.duration_s,
      size_bytes: v.size_bytes,
      platform: v.platform,
    });
    if (error) return toast.error(error.message);
    toast.success(`„${v.title}“ nach „${target?.name ?? "Profil"}“ dupliziert`);
    qc.invalidateQueries({ queryKey: ["raw_videos", user.id, targetBrandId] });
  }

  async function connectPlatform(pid: string) {
    const handle = window.prompt(`Handle für ${pid} (z. B. @meinprofil)`)?.trim();
    if (!handle) return;
    const { error } = await supabase.from("social_accounts").insert({
      user_id: user.id, brand_id: id, platform: pid as any, handle, status: "connected",
    });
    if (error) return toast.error(error.message);
    toast.success(`${pid} verbunden`);
    qc.invalidateQueries({ queryKey: ["social_accounts", user.id, id] });
  }

  async function disconnectAccount(accId: string) {
    if (!confirm("Verbindung wirklich trennen?")) return;
    const { error } = await supabase.from("social_accounts").update({ status: "disconnected" }).eq("id", accId);
    if (error) return toast.error(error.message);
    toast.success("Getrennt");
    qc.invalidateQueries({ queryKey: ["social_accounts", user.id, id] });
  }

  async function reconnectAccount(accId: string) {
    const { error } = await supabase.from("social_accounts")
      .update({ status: "connected", sync_error: null }).eq("id", accId);
    if (error) return toast.error(error.message);
    toast.success("Wieder verbunden");
    qc.invalidateQueries({ queryKey: ["social_accounts", user.id, id] });
  }

  async function checkStatus(accId: string) {
    const { data, error } = await supabase.from("social_accounts").select("*").eq("id", accId).maybeSingle();
    if (error || !data) return toast.error(error?.message ?? "Nicht gefunden");
    toast.info(`Status: ${data.status}${data.last_sync_at ? ` · Sync ${new Date(data.last_sync_at).toLocaleString()}` : " · noch nie synchronisiert"}`);
  }

  async function triggerSync() {
    toast.info("Analyse-Sync gestartet …");
    try {
      const res = await fetch("/api/public/hooks/sync-analytics", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      toast.success(`Sync fertig · ${j.synced} ${j.synced === 1 ? "Kanal" : "Kanäle"}`);
      qc.invalidateQueries({ queryKey: ["social_accounts", user.id, id] });
      qc.invalidateQueries({ queryKey: ["snapshots", user.id, id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync fehlgeschlagen");
    }
  }

  async function addFolder() {
    const name = window.prompt("Ordnername")?.trim();
    if (!name) return;
    const { error } = await supabase.from("folders").insert({ user_id: user.id, brand_id: id, name });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["folders", user.id, id] });
  }

  async function deleteFolder(fid: string) {
    if (!confirm("Ordner löschen? Videos bleiben erhalten (kein Ordner).")) return;
    const { error } = await supabase.from("folders").delete().eq("id", fid);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["folders", user.id, id] });
    qc.invalidateQueries({ queryKey: ["raw_videos", user.id, id] });
  }

  if (brandQ.isLoading) return <div className="animate-pulse text-[13px] text-muted-foreground">Lade Profil …</div>;
  if (!brand) return <div className="text-[13px] text-muted-foreground">Profil nicht gefunden.</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <button onClick={() => navigate({ to: "/app" })} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Zurück zum Dashboard
      </button>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="group relative">
            <BrandAvatar brand={brand} className="h-14 w-14 rounded-[14px] text-lg" />
            <button
              onClick={() => avatarFileRef.current?.click()}
              disabled={avatarUploading}
              title="Profilbild ändern"
              className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
            >
              {avatarUploading ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
            </button>
            <input
              ref={avatarFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadBrandAvatar(e.target.files[0])}
            />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-muted-foreground">Profil</p>
            <h1 className={`text-[30px] font-semibold tracking-tight ${fontClass((brand as any).name_font)}`}>{brand.name}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {lastSyncOverall ? `Letzter Analyse-Sync: ${lastSyncOverall.toLocaleString()}` : "Noch kein Analyse-Sync"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={openBrandEditor} className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-secondary px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
            <Pencil className="h-4 w-4" /> Bearbeiten
          </button>
          <button onClick={triggerSync} className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-secondary px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
            <RefreshCw className="h-4 w-4" /> Tracking jetzt synchronisieren
          </button>
          <button onClick={() => navigate({ to: "/app/upload" })} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
            <Upload className="h-4 w-4" /> Video hinzufügen
          </button>
        </div>
      </div>

      {editingBrand && (
        <div className="space-y-4 rounded-[18px] border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Pencil className="h-4 w-4 text-muted-foreground" /> Profil bearbeiten
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="block text-[13px]">
              <span className="font-semibold text-muted-foreground">Name</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveBrand()}
                className="mt-1.5 h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
              />
            </label>
            <label className="block text-[13px]">
              <span className="font-semibold text-muted-foreground">Farbe</span>
              <input
                type="color"
                value={editColor}
                onChange={(e) => setEditColor(e.target.value)}
                className="mt-1.5 block h-11 w-14 cursor-pointer rounded-[11px] border border-border bg-input p-1"
              />
            </label>
            <label className="block text-[13px]">
              <span className="font-semibold text-muted-foreground">Profilbild</span>
              <button
                onClick={() => avatarFileRef.current?.click()}
                disabled={avatarUploading}
                className="mt-1.5 inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-secondary px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] disabled:opacity-40 dark:hover:bg-[#3a3a3c]"
              >
                {avatarUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Bild wählen
              </button>
            </label>
            <label className="block text-[13px] sm:col-span-3">
              <span className="font-semibold text-muted-foreground">Schrift für Profilname</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {FONT_OPTIONS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setEditFont(f.value)}
                    className={`rounded-[11px] border px-4 py-2.5 text-left text-[15px] transition-colors ${editFont === f.value ? "border-primary bg-card text-foreground" : "border-border bg-input text-muted-foreground hover:bg-secondary hover:text-foreground"} ${f.className}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </label>
          </div>
          {/* Wasserzeichen (Logo im Video-Eck) */}
          <div className="rounded-[14px] border border-border bg-background p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
              <Stamp className="h-4 w-4" /> Wasserzeichen: Logo im Video
            </div>
            {(brand as any).watermark_path ? (
              <div className="flex flex-wrap items-center gap-3">
                <WatermarkThumb path={(brand as any).watermark_path} />
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={!!(brand as any).watermark_enabled}
                    onChange={(e) =>
                      patchWatermark(
                        { watermark_enabled: e.target.checked },
                        e.target.checked ? "Wasserzeichen aktiv" : "Wasserzeichen ausgeschaltet",
                      )
                    }
                    className="h-[18px] w-[18px] accent-primary"
                  />
                  Standardmäßig einblenden
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <span className="text-muted-foreground">Ecke:</span>
                  <select
                    value={(brand as any).watermark_position ?? "br"}
                    onChange={(e) => patchWatermark({ watermark_position: e.target.value })}
                    className="h-9 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
                  >
                    <option value="tl">oben links</option>
                    <option value="tr">oben rechts</option>
                    <option value="bl">unten links</option>
                    <option value="br">unten rechts</option>
                  </select>
                </label>
                <button
                  onClick={() => wmFileRef.current?.click()}
                  disabled={wmUploading}
                  className="inline-flex h-9 items-center justify-center rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] disabled:opacity-40 dark:hover:bg-[#3a3a3c]"
                >
                  {wmUploading ? "Lädt…" : "Anderes Bild"}
                </button>
                <button
                  onClick={() =>
                    patchWatermark(
                      { watermark_path: null, watermark_enabled: false },
                      "Wasserzeichen entfernt",
                    )
                  }
                  className="inline-flex h-9 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-destructive transition-colors hover:bg-destructive/15"
                >
                  Entfernen
                </button>
              </div>
            ) : (
              <button
                onClick={() => wmFileRef.current?.click()}
                disabled={wmUploading}
                className="inline-flex h-9 items-center gap-2 rounded-[11px] border border-dashed border-border px-4 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
              >
                {wmUploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Logo hochladen (PNG mit Transparenz empfohlen)
              </button>
            )}
            <input
              ref={wmFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadWatermark(e.target.files[0])}
            />
            <p className="mt-3 text-[13px] text-muted-foreground">
              Wird beim Rendern in das gewählte Eck aller Clips dieses Profils eingeblendet. Im
              Editor kannst du es pro Video über den „Logo“-Schalter an- oder ausschalten.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <button
              onClick={deleteBrand}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[11px] px-4 text-[13px] font-semibold text-destructive transition-colors hover:bg-destructive/15"
            >
              <Trash2 className="h-3.5 w-3.5" /> Profil löschen
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setEditingBrand(false)}
                className="inline-flex h-9 items-center justify-center rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"
              >
                Abbrechen
              </button>
              <button
                onClick={saveBrand}
                disabled={savingBrand}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
              >
                {savingBrand && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Videos" value={videos.length} />
        <Stat label="Clips" value={totalClips} />
        <Stat label="Kanäle" value={accounts.filter((a) => a.status !== "disconnected").length} />
        <Stat label="Views (Cache)" value={totals.views} />
        <Stat label="Likes" value={totals.likes} />
        <Stat label="Kommentare" value={totals.comments} />
      </div>

      {/* Plattform-Analytics: Views je Plattform + Filter */}
      <section className="rounded-[18px] border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <BarChart3 className="h-4 w-4" /> Tracking: Views je Plattform
          </h2>
          <div className="flex flex-wrap gap-2">
            <Select value={analyticsPlatform} onChange={setAnalyticsPlatform} options={[
              { value: "all", label: "Alle Plattformen" },
              ...platforms.map((p) => ({ value: p.id, label: p.name })),
            ]} />
            <Select value={analyticsRange} onChange={setAnalyticsRange} options={[
              { value: "7d", label: "Letzte 7 Tage" },
              { value: "30d", label: "Letzte 30 Tage" },
              { value: "90d", label: "Letzte 90 Tage" },
              { value: "all", label: "Gesamter Zeitraum" },
            ]} />
          </div>
        </div>
        <div className="mb-4 flex items-baseline gap-3">
          <div className="text-[30px] font-semibold tracking-tight tabular-nums">{platformStats.totalViews.toLocaleString()}</div>
          <div className="text-[13px] text-muted-foreground">Gesamt-Views im Zeitraum</div>
        </div>
        {platformStats.rows.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
            Keine Daten in diesem Zeitraum. Der Sync läuft alle 30 Minuten, oder du löst ihn oben manuell aus.
          </div>
        ) : (
          <div className="space-y-3">
            {platformStats.rows.map((r) => {
              const pct = platformStats.totalViews ? Math.round((r.views / platformStats.totalViews) * 100) : 0;
              const meta = platforms.find((p) => p.id === r.platform);
              const Icon = meta?.icon ?? Share2;
              return (
                <div key={r.platform} className="rounded-[14px] border border-border bg-background p-4">
                  <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-foreground">{meta?.name ?? r.platform}</span>
                      <span className="tabular-nums text-muted-foreground">{r.samples} Snapshots</span>
                    </div>
                    <div className="tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{r.views.toLocaleString()}</span> Views · {pct}% · {r.likes.toLocaleString()} Likes · {r.comments.toLocaleString()} Kommentare
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Kanaele (verbundene Social-Accounts) */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
          <Share2 className="h-4 w-4" /> Kanäle für {brand.name}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {platforms.map((p) => {
            const acc = accounts.find((a) => a.platform === p.id);
            const snap = acc ? latestByAccount.get(acc.id) : null;
            const m = (snap?.metrics ?? {}) as any;
            return (
              <div key={p.id} className="rounded-[18px] border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-secondary text-foreground">
                      <p.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-[15px] font-semibold">{p.name}</div>
                      <div className="text-[13px] text-muted-foreground">
                        {acc ? (
                          <>
                            <span className={acc.status === "connected" ? "font-semibold text-success" : acc.status === "error" ? "font-semibold text-destructive" : "text-muted-foreground"}>
                              ● {acc.status}
                            </span>
                            {acc.handle ? ` · @${acc.handle}` : ""}
                            {acc.last_sync_at ? ` · Sync ${new Date(acc.last_sync_at).toLocaleTimeString()}` : " · noch kein Sync"}
                          </>
                        ) : "Nicht verbunden"}
                      </div>
                      {acc && snap && (
                        <div className="mt-1 text-[13px] tabular-nums text-muted-foreground">
                          {m.views ?? 0} Views · {m.likes ?? 0} Likes · Retention {m.avg_watch_pct ?? 0}%
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {acc ? (
                      <>
                        <button onClick={() => checkStatus(acc.id)} className="inline-flex h-9 items-center justify-center rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
                          Status
                        </button>
                        {acc.status === "disconnected" ? (
                          <button onClick={() => reconnectAccount(acc.id)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
                            <Plug className="h-3.5 w-3.5" /> Neu verbinden
                          </button>
                        ) : (
                          <button onClick={() => disconnectAccount(acc.id)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-[#dcdce1] hover:text-destructive dark:hover:bg-[#3a3a3c]">
                            <Unlink className="h-3.5 w-3.5" /> Trennen
                          </button>
                        )}
                      </>
                    ) : (
                      <button onClick={() => connectPlatform(p.id)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
                        <Plug className="h-3.5 w-3.5" /> Verbinden
                      </button>
                    )}
                  </div>
                </div>
                {acc?.sync_error && (
                  <div className="mt-3 rounded-[9px] bg-destructive/15 px-3 py-1.5 text-[13px] text-destructive">{acc.sync_error}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Folders */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <FolderIcon className="h-4 w-4" /> Ordner
          </h2>
          <button onClick={addFolder} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
            <FolderPlus className="h-3.5 w-3.5" /> Neuer Ordner
          </button>
        </div>
        {folders.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
            Noch keine Ordner. Ordner strukturieren deinen Video-Verlauf (z. B. „Kampagne Herbst“, „Testimonials“).
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {folders.map((f) => {
              const count = videos.filter((v: any) => v.folder_id === f.id).length;
              return (
                <div key={f.id} className="group flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px]">
                  <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-semibold">{f.name}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                  <button onClick={() => deleteFolder(f.id)} className="ml-1 text-[13px] text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Video history with filters */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <Film className="h-4 w-4" /> Video-Verlauf ({filteredVideos.length})
          </h2>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Titel suchen …" className="h-9 w-full rounded-[9px] border border-border bg-input pl-9 pr-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />
          </div>
          <Select value={folderFilter} onChange={setFolderFilter} options={[
            { value: "all", label: "Alle Ordner" },
            { value: "none", label: "Ohne Ordner" },
            ...folders.map((f) => ({ value: f.id, label: f.name })),
          ]} />
          <Select value={platformFilter} onChange={setPlatformFilter} options={[
            { value: "all", label: "Alle Plattformen" },
            { value: "tiktok", label: "TikTok" },
            { value: "youtube", label: "YouTube" },
            { value: "instagram", label: "Instagram" },
            { value: "facebook", label: "Facebook" },
            { value: "x", label: "X" },
          ]} />
          <Select value={statusFilter} onChange={setStatusFilter} options={[
            { value: "all", label: "Alle Status" },
            { value: "ready", label: "Fertig" },
            { value: "processing", label: "In Bearbeitung" },
            { value: "error", label: "Fehler" },
          ]} />
          <Select value={rangeFilter} onChange={setRangeFilter} options={[
            { value: "all", label: "Gesamter Zeitraum" },
            { value: "7d", label: "Letzte 7 Tage" },
            { value: "30d", label: "Letzte 30 Tage" },
            { value: "90d", label: "Letzte 90 Tage" },
          ]} />
        </div>

        {filteredVideos.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border p-8 text-center text-[15px] text-muted-foreground">
            Keine Videos entsprechen den Filtern.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[18px] border border-border bg-card">
            <table className="w-full text-[15px]">
              <thead className="text-left text-[13px] font-semibold text-muted-foreground">
                <tr>
                  <Th onClick={() => toggleSort("title")} active={sortKey === "title"}>Titel</Th>
                  <Th onClick={() => toggleSort("platform")} active={sortKey === "platform"}>Plattform</Th>
                  <Th>Ordner</Th>
                  <Th onClick={() => toggleSort("duration_s")} active={sortKey === "duration_s"}>Dauer</Th>
                  <Th onClick={() => toggleSort("clips")} active={sortKey === "clips"}>Clips</Th>
                  <Th onClick={() => toggleSort("status")} active={sortKey === "status"}>Status</Th>
                  <Th onClick={() => toggleSort("created_at")} active={sortKey === "created_at"}>Datum</Th>
                  <th className="px-4 py-3 text-right">Analyse</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredVideos.map((v: any) => (
                  <tr key={v.id} className="transition-colors hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <Link to="/app/video/$id" params={{ id: v.id }} className="font-semibold hover:text-accent hover:underline">{v.title}</Link>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground">{v.platform ?? "–"}</td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground">{v.folders?.name ?? "–"}</td>
                    <td className="px-4 py-3 text-[13px] tabular-nums text-muted-foreground">{v.duration_s ? `${Math.round(Number(v.duration_s))}s` : "–"}</td>
                    <td className="px-4 py-3 text-[13px] tabular-nums text-muted-foreground">{v.generated_clips?.length ?? 0}</td>
                    <td className="px-4 py-3 text-[13px]">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${v.status === "ready" ? "bg-success/15 text-success" : v.status === "error" ? "bg-destructive/15 text-destructive" : v.status === "processing" ? "bg-warning/15 text-warning" : "bg-secondary text-foreground"}`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px] tabular-nums text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <select
                          value=""
                          onChange={(e) => e.target.value && duplicateVideo(v, e.target.value)}
                          title="Video in ein anderes Profil duplizieren"
                          className="h-9 max-w-[140px] rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
                        >
                          <option value="">Duplizieren …</option>
                          {allBrands.filter((b) => b.id !== id).map((b) => (
                            <option key={b.id} value={b.id}>→ {b.name}</option>
                          ))}
                        </select>
                        <Link to="/app/video/$id" params={{ id: v.id }} className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
                          <BarChart3 className="h-3.5 w-3.5" /> Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground"><BarChart3 className="h-4 w-4" /> Performance-Snapshots</h2>
        {snapshots.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border p-6 text-[13px] text-muted-foreground">
            Noch keine Snapshots. Der Sync läuft alle 30 Minuten automatisch, oder du löst ihn oben manuell aus.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[18px] border border-border bg-card">
            <table className="w-full text-[15px]">
              <thead className="text-left text-[13px] font-semibold text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Zeit</th>
                  <th className="px-4 py-3">Plattform</th>
                  <th className="px-4 py-3">Views</th>
                  <th className="px-4 py-3">Likes</th>
                  <th className="px-4 py-3">Retention</th>
                  <th className="px-4 py-3">Drop-off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {snapshots.slice(0, 20).map((s: any) => (
                  <tr key={s.id} className="transition-colors hover:bg-secondary/40">
                    <td className="px-4 py-2.5 text-[13px] tabular-nums text-muted-foreground">{new Date(s.snapshot_at).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-[13px]">{s.platform}</td>
                    <td className="px-4 py-2.5 text-[13px] tabular-nums">{s.metrics?.views ?? 0}</td>
                    <td className="px-4 py-2.5 text-[13px] tabular-nums">{s.metrics?.likes ?? 0}</td>
                    <td className="px-4 py-2.5 text-[13px] tabular-nums">{s.metrics?.avg_watch_pct ?? 0}%</td>
                    <td className="px-4 py-2.5 text-[13px] tabular-nums">{s.metrics?.drop_off_pct ?? 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BrandIdentity brandId={id} brandName={brand.name} />
      <BrandAutomations brandId={id} userId={user.id} />
    </div>
  );
}


function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[18px] border border-border bg-card p-5">
      <div className="text-[13px] font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-[26px] font-semibold tracking-tight tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function Th({ children, onClick, active }: { children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <th className={`px-4 py-3 ${onClick ? "cursor-pointer select-none hover:text-foreground" : ""} ${active ? "text-foreground" : ""}`} onClick={onClick}>
      <span className="inline-flex items-center gap-1">{children}{onClick && <ArrowUpDown className="h-3 w-3 opacity-50" />}</span>
    </th>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function WatermarkThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage
      .from("raw-videos")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setUrl(data.signedUrl);
      });
  }, [path]);
  return (
    <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-[9px] border border-border bg-[repeating-conic-gradient(#e8e8ed_0%_25%,#fff_0%_50%)] bg-[length:12px_12px]">
      {url ? (
        <img src={url} alt="Wasserzeichen" className="max-h-full max-w-full object-contain" />
      ) : (
        <Stamp className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}
