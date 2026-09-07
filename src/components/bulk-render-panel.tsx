import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getBulkRenderStats,
  getJobExportAssets,
  getRenderProviderStatus,
  pollBulkRender,
  retryFailedRenders,
  setQueueRenderProvider,
  startBulkRender,
  testRenderProvider,
} from "@/lib/render.functions";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  Loader2,
  FolderDown,
  Play,
  PlugZap,
  RefreshCw,
  Server,
  Timer,
  Wallet,
} from "lucide-react";

type ProviderId = "creatomate" | "shotstack" | "json2video" | "custom";

type RenderRow = {
  id: string;
  clip_index: number;
  title: string | null;
  status: "queued" | "submitted" | "rendering" | "done" | "failed";
  progress: number;
  storage_path: string | null;
  error: string | null;
  aspect: string;
  template_id: string;
};

const STATUS_LABEL: Record<RenderRow["status"], string> = {
  queued: "In Warteschlange",
  submitted: "Übergeben",
  rendering: "Rendert",
  done: "Fertig",
  failed: "Fehler",
};

/**
 * Bulk-Render-Panel: startet die serverseitige Creatomate-Pipeline für
 * alle Clips des Jobs und zeigt den Fortschritt jedes einzelnen Renders.
 */
export function BulkRenderPanel({ jobId, clipCount }: { jobId: string; clipCount: number }) {
  const qc = useQueryClient();
  const start = useServerFn(startBulkRender);
  const poll = useServerFn(pollBulkRender);
  const retry = useServerFn(retryFailedRenders);
  const testConn = useServerFn(testRenderProvider);
  const loadAssets = useServerFn(getJobExportAssets);
  const loadStats = useServerFn(getBulkRenderStats);
  const switchProvider = useServerFn(setQueueRenderProvider);
  const [provider, setProvider] = useState<ProviderId>("creatomate");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const providerQ = useQuery({
    queryKey: ["render-provider"],
    queryFn: () => getRenderProviderStatus(),
    staleTime: 60_000,
  });

  const rowsQ = useQuery({
    queryKey: ["render-jobs", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("render_jobs")
        .select("id, clip_index, title, status, progress, storage_path, error, aspect, template_id")
        .eq("job_id", jobId)
        .order("clip_index", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as RenderRow[];
    },
    refetchInterval: providerQ.data?.webhook ? 15000 : 5000,
  });

  const costQ = useQuery({
    queryKey: ["render-stats", jobId],
    queryFn: () => loadStats({ data: { jobId } }),
    refetchInterval: 15000,
  });

  const rows = rowsQ.data ?? [];
  const stats = useMemo(() => {
    const by = (s: RenderRow["status"]) => rows.filter((r) => r.status === s).length;
    return {
      total: rows.length,
      done: by("done"),
      failed: by("failed"),
      active: by("rendering") + by("submitted"),
      queued: by("queued"),
    };
  }, [rows]);

  const pending = stats.active + stats.queued;

  // Solange Renders laufen, den Server anstoßen (Slots nachfüllen + Status holen)
  useEffect(() => {
    if (pending === 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await poll({});
      } catch {
        /* stiller Fehlschlag, nächster Tick versucht es erneut */
      }
      if (!cancelled) qc.invalidateQueries({ queryKey: ["render-jobs", jobId] });
      qc.invalidateQueries({ queryKey: ["render-stats", jobId] });
    };
    const t = setInterval(tick, providerQ.data?.webhook ? 45000 : 8000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pending, jobId, poll, qc, providerQ.data?.webhook]);

  async function onStart() {
    setBusy(true);
    try {
      const res = await start({ data: { jobId, clipIndexes: null, provider } });
      if (res.queued === 0) {
        toast.info("Alle Clips sind bereits in der Render-Queue.");
      } else {
        toast.success(`${res.queued} Clips gestartet, läuft im Hintergrund weiter.`);
      }
      qc.invalidateQueries({ queryKey: ["render-jobs", jobId] });
      qc.invalidateQueries({ queryKey: ["render-stats", jobId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Render-Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function onRetry() {
    setBusy(true);
    try {
      const res = await retry({ data: { jobId } });
      toast.success(`${res.queued} Renders wieder in der Warteschlange.`);
      qc.invalidateQueries({ queryKey: ["render-jobs", jobId] });
      qc.invalidateQueries({ queryKey: ["render-stats", jobId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Neustart fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(row: RenderRow) {
    if (!row.storage_path) return;
    const { data, error } = await supabase.storage
      .from("rendered-clips")
      .createSignedUrl(row.storage_path, 3600);
    if (error || !data?.signedUrl) {
      toast.error("Download-Link konnte nicht erstellt werden.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function onTest() {
    setTesting(true);
    try {
      const res = await testConn({ data: { provider } });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      void providerQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verbindungstest fehlgeschlagen");
    } finally {
      setTesting(false);
    }
  }

  async function onBulkDownload() {
    try {
      const { assets } = await loadAssets({ data: { jobId } });
      const links = assets.filter((a) => a.video);
      if (!links.length) {
        toast.info("Noch keine fertigen Clips zum Herunterladen.");
        return;
      }
      links.forEach((a, i) => {
        setTimeout(() => window.open(a.video as string, "_blank", "noopener"), i * 400);
      });
      toast.success(`${links.length} Clips werden heruntergeladen.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk-Download fehlgeschlagen");
    }
  }

  const providers = providerQ.data?.providers ?? [];
  const activeProvider = providers.find((p) => p.id === provider);
  const configured = activeProvider ? activeProvider.configured : providerQ.data?.creatomate;

  async function onProviderChange(next: ProviderId) {
    setProvider(next);
    if (rows.length === 0) return;
    try {
      const res = await switchProvider({ data: { jobId, provider: next } });
      if (res.updated > 0) {
        toast.success(`${res.updated} offene Renders laufen jetzt über ${next}.`);
        qc.invalidateQueries({ queryKey: ["render-jobs", jobId] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Provider-Wechsel fehlgeschlagen");
    }
  }

  const cost = costQ.data;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
          <Server className="h-3.5 w-3.5" />
          Massen-Rendering (Server)
        </div>
        {providerQ.data && (
          <span className="text-[12px] text-muted-foreground">
            {configured ? `${providerQ.data.concurrency} parallel · ${providerQ.data.webhook ? "Webhook" : "Polling"}` : "Key fehlt"}
          </span>
        )}
      </div>

      {providerQ.data && !configured && (
        <div className="flex gap-2 rounded-[11px] bg-warning/15 px-3 py-2.5 text-[13px] leading-relaxed text-foreground">
          <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            {activeProvider?.label ?? "Der Render-Dienst"} ist noch nicht verbunden. Hinterlege den
            API-Key als Secret{" "}
            <code className="font-mono">{activeProvider?.keyName ?? "CREATOMATE_API_KEY"}</code>.
            Aufträge kannst du jetzt schon
            anlegen, sie starten automatisch, sobald der Key da ist.
          </span>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-[13px] font-semibold text-muted-foreground">
          Render-Provider
        </label>
        <select
          value={provider}
          onChange={(e) => void onProviderChange(e.target.value as ProviderId)}
          className="w-full h-9 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/60"
        >
          {(providers.length
            ? providers
            : [{ id: "creatomate", label: "Creatomate", configured: true, note: "" }]
          ).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} {p.configured ? "" : "· Key fehlt"}
            </option>
          ))}
        </select>
        {activeProvider && (
          <p className="text-[13px] leading-snug text-muted-foreground">{activeProvider.note}</p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          ["Gesamt", stats.total],
          ["Läuft", stats.active],
          ["Fertig", stats.done],
          ["Fehler", stats.failed],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-[11px] bg-secondary p-2">
            <div className="text-[15px] font-semibold tabular-nums">{value as number}</div>
            <div className="text-[12px] text-muted-foreground">
              {label as string}
            </div>
          </div>
        ))}
      </div>

      {cost && cost.total > 0 && (
        <div className="grid grid-cols-3 gap-2 rounded-[11px] bg-secondary p-3 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-[15px] font-semibold tabular-nums">
              <Wallet className="h-3 w-3 text-muted-foreground" />${cost.costSpentUsd.toFixed(2)}
            </div>
            <div className="text-[12px] text-muted-foreground">
              von ~${cost.costEstimateUsd.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-[15px] font-semibold tabular-nums">
              <Timer className="h-3 w-3 text-muted-foreground" />
              {cost.avgRenderSeconds ? `${cost.avgRenderSeconds}s` : "–"}
            </div>
            <div className="text-[12px] text-muted-foreground">
              ø pro Clip
            </div>
          </div>
          <div>
            <div className="text-[15px] font-semibold tabular-nums">
              {cost.wallClockSeconds != null ? `${Math.round(cost.wallClockSeconds / 60)}m` : "–"}
            </div>
            <div className="text-[12px] text-muted-foreground">
              Gesamtdauer
            </div>
          </div>
        </div>
      )}

      {cost && cost.errors.length > 0 && (
        <div className="max-h-24 space-y-1 overflow-y-auto rounded-[11px] bg-destructive/15 px-3 py-2 text-[13px] text-destructive">
          {cost.errors.map((e) => (
            <div key={e.clipIndex} className="line-clamp-2">
              Clip {e.clipIndex + 1}: {e.error ?? "unbekannter Fehler"}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onStart}
          disabled={busy || clipCount === 0}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff] disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {clipCount > 0 ? `${clipCount} Clips rendern` : "Keine Clips"}
        </button>
        {stats.failed > 0 && (
          <button
            onClick={onRetry}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-full bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c] disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Wiederholen
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onTest}
          disabled={testing}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c] disabled:opacity-40"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
          Verbindung testen
        </button>
        <button
          onClick={onBulkDownload}
          disabled={stats.done === 0}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c] disabled:opacity-40"
        >
          <FolderDown className="h-3.5 w-3.5" />
          Alle laden ({stats.done})
        </button>
      </div>

      <div className="max-h-64 space-y-1.5 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.id} className="rounded-[11px] border border-border bg-card p-2.5">
            <div className="flex items-center gap-2 text-[13px]">
              {r.status === "done" ? (
                <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
              ) : r.status === "failed" ? (
                <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />
              ) : (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {r.clip_index + 1}. {r.title ?? "Clip"}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                {STATUS_LABEL[r.status]}
              </span>
              {r.status === "done" && r.storage_path && (
                <button
                  onClick={() => onDownload(r)}
                  className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label="Clip herunterladen"
                >
                  <Download className="h-3 w-3" />
                </button>
              )}
            </div>
            {r.status !== "done" && r.status !== "failed" && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(5, r.progress)}%` }}
                />
              </div>
            )}
            {r.error && (
              <div className="mt-1 line-clamp-2 text-[12px] text-destructive">{r.error}</div>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-3 text-center text-[13px] text-muted-foreground">
            Noch keine Render-Aufträge. Starte das Massen-Rendering, um alle Clips serverseitig mit
            Untertiteln, Musik und Übergängen zu erzeugen.
          </p>
        )}
      </div>
    </div>
  );
}
