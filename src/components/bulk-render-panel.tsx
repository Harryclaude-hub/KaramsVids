import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getRenderProviderStatus,
  pollBulkRender,
  retryFailedRenders,
  startBulkRender,
} from "@/lib/render.functions";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Server,
} from "lucide-react";

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
  const [busy, setBusy] = useState(false);

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
    refetchInterval: 5000,
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
        /* stiller Fehlschlag — nächster Tick versucht es erneut */
      }
      if (!cancelled) qc.invalidateQueries({ queryKey: ["render-jobs", jobId] });
    };
    const t = setInterval(tick, 8000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pending, jobId, poll, qc]);

  async function onStart() {
    setBusy(true);
    try {
      const res = await start({ data: { jobId, clipIndexes: null } });
      if (res.queued === 0) {
        toast.info("Alle Clips sind bereits in der Render-Queue.");
      } else {
        toast.success(`${res.queued} Clips gestartet — läuft im Hintergrund weiter.`);
      }
      qc.invalidateQueries({ queryKey: ["render-jobs", jobId] });
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

  const configured = providerQ.data?.creatomate;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Server className="h-3.5 w-3.5" />
          Massen-Rendering (Server)
        </div>
        {providerQ.data && (
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            {configured ? `${providerQ.data.concurrency} parallel` : "Key fehlt"}
          </span>
        )}
      </div>

      {providerQ.data && !configured && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-200">
          <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Der Render-Dienst ist noch nicht verbunden. Hinterlege den Creatomate-API-Key
            (creatomate.com → Project Settings → API Key) als Secret{" "}
            <code className="font-mono">CREATOMATE_API_KEY</code>. Aufträge kannst du jetzt schon
            anlegen — sie starten automatisch, sobald der Key da ist.
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[
          ["Gesamt", stats.total],
          ["Läuft", stats.active],
          ["Fertig", stats.done],
          ["Fehler", stats.failed],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-md border border-border bg-background/60 p-1.5">
            <div className="text-sm font-semibold tabular-nums">{value as number}</div>
            <div className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground">
              {label as string}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={onStart}
          disabled={busy || clipCount === 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {clipCount > 0 ? `${clipCount} Clips rendern` : "Keine Clips"}
        </button>
        {stats.failed > 0 && (
          <button
            onClick={onRetry}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:border-primary/50 disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Wiederholen
          </button>
        )}
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.id} className="rounded-md border border-border bg-background/50 p-1.5">
            <div className="flex items-center gap-1.5 text-[11px]">
              {r.status === "done" ? (
                <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
              ) : r.status === "failed" ? (
                <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />
              ) : (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {r.clip_index + 1}. {r.title ?? "Clip"}
              </span>
              <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                {STATUS_LABEL[r.status]}
              </span>
              {r.status === "done" && r.storage_path && (
                <button
                  onClick={() => onDownload(r)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-primary"
                  aria-label="Clip herunterladen"
                >
                  <Download className="h-3 w-3" />
                </button>
              )}
            </div>
            {r.status !== "done" && r.status !== "failed" && (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.max(5, r.progress)}%` }}
                />
              </div>
            )}
            {r.error && (
              <div className="mt-1 line-clamp-2 text-[10px] text-destructive">{r.error}</div>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-3 text-center text-[11px] text-muted-foreground">
            Noch keine Render-Aufträge. Starte das Massen-Rendering, um alle Clips serverseitig mit
            Untertiteln, Musik und Übergängen zu erzeugen.
          </p>
        )}
      </div>
    </div>
  );
}
