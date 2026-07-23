import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBrandId, useBrands } from "@/lib/use-active-brand";
import { useState } from "react";
import { CalendarClock, ListOrdered, Plus, Trash2, ArrowUp, ArrowDown, Play, Pause, RefreshCw, AlertTriangle, CheckCircle2, Clock, Edit3 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/publishing")({
  component: PublishingPage,
});

const PLATFORMS = [
  { id: "tiktok", name: "TikTok" },
  { id: "youtube", name: "YouTube" },
  { id: "instagram", name: "Instagram" },
  { id: "facebook", name: "Facebook" },
  { id: "x", name: "X (Twitter)" },
] as const;

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function PublishingPage() {
  const { user } = Route.useRouteContext();
  const [activeBrandId] = useActiveBrandId();
  const brandsQ = useBrands(user.id);
  const brand = brandsQ.data?.find((b) => b.id === activeBrandId) ?? null;
  const qc = useQueryClient();

  const schedQ = useQuery({
    queryKey: ["publish_schedules", user.id, activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase.from("publish_schedules")
        .select("*").eq("brand_id", activeBrandId!).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const clipsQ = useQuery({
    queryKey: ["clips", user.id, activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase.from("generated_clips")
        .select("*, edit_jobs(raw_videos(title))")
        .eq("brand_id", activeBrandId!)
        .order("queue_position", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });

  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  if (!activeBrandId) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Kein Brand aktiv. Wähle links einen Brand, um dessen Upload-Zeitplan und Warteschlange zu sehen.
      </div>
    );
  }
  if (!brand) return <div className="text-sm text-muted-foreground">Brand wird geladen …</div>;

  const schedules = schedQ.data ?? [];
  const clips = (clipsQ.data ?? []).filter((c: any) => {
    if (platformFilter !== "all" && c.platform !== platformFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    return true;
  });

  const queuedByPlatform: Record<string, number> = {};
  for (const c of clipsQ.data ?? []) {
    if (c.status === "queued" && c.platform) queuedByPlatform[c.platform] = (queuedByPlatform[c.platform] ?? 0) + 1;
  }

  async function triggerProcess() {
    toast.info("Warteschlange wird abgearbeitet …");
    try {
      const res = await fetch("/api/public/hooks/process-publish-queue", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      toast.success(`${j.published} Clip(s) veröffentlicht (${j.schedules_processed} Slots)`);
      qc.invalidateQueries({ queryKey: ["clips", user.id, activeBrandId] });
      qc.invalidateQueries({ queryKey: ["publish_schedules", user.id, activeBrandId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Publishing · {brand.name}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Zeitpläne & Warteschlange</h1>
          <p className="mt-1 text-xs text-muted-foreground">Der Hintergrund-Job läuft alle 5 Min. Fällige Slots holen die nächsten Clips aus der Warteschlange nach ihrer Reihenfolge.</p>
        </div>
        <button onClick={triggerProcess} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-card">
          <RefreshCw className="h-4 w-4" /> Jetzt verarbeiten
        </button>
      </div>

      <ScheduleSection
        brandId={brand.id}
        userId={user.id}
        schedules={schedules}
        onChange={() => qc.invalidateQueries({ queryKey: ["publish_schedules", user.id, activeBrandId] })}
        queuedByPlatform={queuedByPlatform}
      />

      <QueueSection
        clips={clips as ClipRow[]}
        allClips={(clipsQ.data ?? []) as ClipRow[]}
        platformFilter={platformFilter}
        statusFilter={statusFilter}
        onPlatformFilter={setPlatformFilter}
        onStatusFilter={setStatusFilter}
        onChange={() => qc.invalidateQueries({ queryKey: ["clips", user.id, activeBrandId] })}
      />
    </div>
  );
}

type ClipRow = {
  id: string;
  brand_id: string;
  platform: string;
  status: string;
  queue_position: number;
  scheduled_for: string | null;
  published_at: string | null;
  published_url: string | null;
  publish_error: string | null;
  title: string | null;
  duration_s: number | null;
  aspect: string;
  storage_path: string;
  created_at: string;
  edit_jobs?: { raw_videos?: { title?: string } | null } | null;
};

type Schedule = {
  id: string;
  brand_id: string;
  platform: string;
  cadence: string;
  weekdays: number[] | null;
  time_of_day: string;
  interval_minutes?: number | null;
  videos_per_slot: number;
  active: boolean;
  next_run_at: string;
  last_run_at: string | null;
};

function fmtInterval(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} Tag${min / 1440 > 1 ? "e" : ""}`;
  if (min % 60 === 0) return `${min / 60} Std`;
  return `${min} Min`;
}

/** Intervall direkt in der Liste bearbeiten: "alle [n] [Einheit]" + OK */
function IntervalEditor({ schedule, onSaved }: { schedule: Schedule; onSaved: () => void }) {
  const init = schedule.interval_minutes ?? 60;
  const initUnit: "minutes" | "hours" | "days" =
    init % 1440 === 0 ? "days" : init % 60 === 0 ? "hours" : "minutes";
  const initN = initUnit === "days" ? init / 1440 : initUnit === "hours" ? init / 60 : init;
  const [n, setN] = useState(initN);
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">(initUnit);
  const [saving, setSaving] = useState(false);

  const minutes = Math.max(
    5,
    Math.round(n * (unit === "minutes" ? 1 : unit === "hours" ? 60 : 1440)),
  );
  const changed = minutes !== init;

  async function save() {
    setSaving(true);
    const nextRun = new Date(Date.now() + minutes * 60_000);
    const { error } = await supabase
      .from("publish_schedules")
      .update({
        interval_minutes: minutes,
        next_run_at: nextRun.toISOString(),
      } as never)
      .eq("id", schedule.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(
      `Intervall geändert — nächster Upload um ${nextRun.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })} Uhr, danach alle ${fmtInterval(minutes)}`,
    );
    onSaved();
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs font-normal">
      · alle
      <input
        type="number"
        min={1}
        value={n}
        onChange={(e) => setN(Math.max(1, Number(e.target.value)))}
        className="w-14 rounded border border-border bg-input px-1.5 py-0.5 text-xs outline-none focus:border-primary"
      />
      <select
        value={unit}
        onChange={(e) => setUnit(e.target.value as "minutes" | "hours" | "days")}
        className="rounded border border-border bg-input px-1 py-0.5 text-xs outline-none focus:border-primary"
      >
        <option value="minutes">Minuten</option>
        <option value="hours">Stunden</option>
        <option value="days">Tage</option>
      </select>
      {changed && (
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saving ? "…" : "OK"}
        </button>
      )}
    </span>
  );
}

function ScheduleSection({
  brandId, userId, schedules, onChange, queuedByPlatform,
}: {
  brandId: string; userId: string; schedules: Schedule[]; onChange: () => void;
  queuedByPlatform: Record<string, number>;
}) {
  const [creating, setCreating] = useState(false);
  const [platform, setPlatform] = useState("tiktok");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "interval">("daily");
  const [time, setTime] = useState("18:00");
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [count, setCount] = useState(1);
  const [intervalN, setIntervalN] = useState(6);
  const [intervalUnit, setIntervalUnit] = useState<"minutes" | "hours" | "days">("hours");

  const unitFactor = intervalUnit === "minutes" ? 1 : intervalUnit === "hours" ? 60 : 1440;
  const previewMinutes = Math.max(5, Math.round(intervalN * unitFactor)); // min. 5 Min (Cron-Takt)
  const previewFirstRun = new Date(Date.now() + previewMinutes * 60_000);

  async function add() {
    const intervalMinutes = previewMinutes;
    const { error } = await supabase.from("publish_schedules").insert({
      user_id: userId, brand_id: brandId,
      platform, cadence,
      weekdays: cadence === "weekly" ? days : [],
      time_of_day: time,
      interval_minutes: cadence === "interval" ? intervalMinutes : null,
      // Intervall: erster Upload exakt in X Minuten — vorhersehbar statt "irgendwann"
      ...(cadence === "interval"
        ? { next_run_at: new Date(Date.now() + intervalMinutes * 60_000).toISOString() }
        : {}),
      videos_per_slot: count,
      active: true,
    } as never);
    if (error) return toast.error(error.message);
    setCreating(false);
    toast.success(
      cadence === "interval"
        ? `Zeitplan erstellt — postet alle ${fmtInterval(intervalMinutes)}`
        : "Zeitplan erstellt",
    );
    onChange();
  }

  async function toggleActive(s: Schedule) {
    const { error } = await supabase.from("publish_schedules").update({ active: !s.active }).eq("id", s.id);
    if (error) return toast.error(error.message);
    onChange();
  }
  async function remove(id: string) {
    if (!confirm("Zeitplan löschen?")) return;
    const { error } = await supabase.from("publish_schedules").delete().eq("id", id);
    if (error) return toast.error(error.message);
    onChange();
  }
  async function updateCount(s: Schedule, n: number) {
    if (n < 1) return;
    const { error } = await supabase.from("publish_schedules").update({ videos_per_slot: n }).eq("id", s.id);
    if (error) return toast.error(error.message);
    onChange();
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CalendarClock className="h-4 w-4" /> Upload-Zeitpläne ({schedules.length})
        </h2>
        <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-card">
          <Plus className="h-3 w-3" /> Neuer Slot
        </button>
      </div>

      {creating && (
        <div className="mb-3 rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">
              <span className="text-muted-foreground">Plattform</span>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm focus:border-primary">
                {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Kadenz</span>
              <select value={cadence} onChange={(e) => setCadence(e.target.value as any)} className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm focus:border-primary">
                <option value="daily">Täglich</option>
                <option value="weekly">Wöchentlich</option>
                <option value="interval">Alle paar Minuten / Stunden / Tage</option>
              </select>
            </label>
            {cadence === "interval" ? (
              <label className="text-xs">
                <span className="text-muted-foreground">Alle …</span>
                <div className="mt-1 flex gap-1">
                  <input
                    type="number"
                    min={1}
                    value={intervalN}
                    onChange={(e) => setIntervalN(Math.max(1, Number(e.target.value)))}
                    className="w-16 rounded-md border border-border bg-input px-2 py-1.5 text-sm focus:border-primary"
                  />
                  <select
                    value={intervalUnit}
                    onChange={(e) => setIntervalUnit(e.target.value as any)}
                    className="flex-1 rounded-md border border-border bg-input px-2 py-1.5 text-sm focus:border-primary"
                  >
                    <option value="minutes">Minuten</option>
                    <option value="hours">Stunden</option>
                    <option value="days">Tage</option>
                  </select>
                </div>
              </label>
            ) : (
              <label className="text-xs">
                <span className="text-muted-foreground">Uhrzeit</span>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm focus:border-primary" />
              </label>
            )}
            <label className="text-xs">
              <span className="text-muted-foreground">Videos pro Slot</span>
              <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} className="mt-1 w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm focus:border-primary" />
            </label>
          </div>
          {cadence === "interval" && (
            <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
              ⏱ Postet automatisch <b>alle {fmtInterval(previewMinutes)}</b> · erster Upload:{" "}
              <b>
                {previewFirstRun.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}{" "}
                Uhr
              </b>{" "}
              ({previewFirstRun.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" })}),
              danach fortlaufend — solange Videos in der Warteschlange sind.
            </div>
          )}
          {cadence === "weekly" && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Wochentage</div>
              <div className="flex gap-1">
                {WEEKDAYS.map((d, i) => (
                  <button key={i} onClick={() => setDays((cur) => cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i])}
                    className={`w-9 rounded-md border px-2 py-1 text-xs ${days.includes(i) ? "border-primary bg-primary/20 text-primary" : "border-border"}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="rounded-md border border-border px-3 py-1.5 text-xs">Abbrechen</button>
            <button onClick={add} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">Speichern</button>
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Noch keine Zeitpläne. Lege einen an, damit gequeuete Clips automatisch veröffentlicht werden.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {schedules.map((s) => {
            const q = queuedByPlatform[s.platform] ?? 0;
            return (
              <div key={s.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="capitalize">{s.platform}</span>
                      {s.cadence === "interval" ? (
                        <IntervalEditor schedule={s} onSaved={onChange} />
                      ) : (
                        <span>
                          ·{" "}
                          {s.cadence === "daily"
                            ? `täglich · ${s.time_of_day.slice(0, 5)}`
                            : `wöchentlich · ${s.time_of_day.slice(0, 5)}`}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      Nächster Upload:{" "}
                      {new Date(s.next_run_at).toLocaleString("de-AT", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      Uhr
                    </div>
                    {s.cadence === "weekly" && s.weekdays && s.weekdays.length > 0 && (
                      <div className="mt-1 flex gap-1">
                        {s.weekdays.map((d) => <span key={d} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">{WEEKDAYS[d]}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] ${s.active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {s.active ? <CheckCircle2 className="h-3 w-3" /> : <Pause className="h-3 w-3" />} {s.active ? "aktiv" : "pausiert"}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">{q} in Queue</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    Videos/Slot
                    <input type="number" min={1} max={10} value={s.videos_per_slot} onChange={(e) => updateCount(s, Number(e.target.value))} className="w-14 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs" />
                  </label>
                  <button onClick={() => toggleActive(s)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-background">
                    {s.active ? <><Pause className="h-3 w-3" /> Pausieren</> : <><Play className="h-3 w-3" /> Aktivieren</>}
                  </button>
                  <button onClick={() => remove(s.id)} className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" /> Löschen
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function QueueSection({
  clips, allClips, platformFilter, statusFilter, onPlatformFilter, onStatusFilter, onChange,
}: {
  clips: ClipRow[]; allClips: ClipRow[];
  platformFilter: string; statusFilter: string;
  onPlatformFilter: (v: string) => void; onStatusFilter: (v: string) => void;
  onChange: () => void;
}) {
  async function move(c: ClipRow, dir: -1 | 1) {
    const siblings = allClips
      .filter((x) => x.platform === c.platform && x.status === "queued")
      .sort((a, b) => a.queue_position - b.queue_position);
    const idx = siblings.findIndex((x) => x.id === c.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    const a = supabase.from("generated_clips").update({ queue_position: swap.queue_position }).eq("id", c.id);
    const b = supabase.from("generated_clips").update({ queue_position: c.queue_position }).eq("id", swap.id);
    const [ra, rb] = await Promise.all([a, b]);
    if (ra.error || rb.error) return toast.error(ra.error?.message ?? rb.error?.message ?? "Fehler");
    onChange();
  }

  async function setStatus(c: ClipRow, status: "queued" | "draft") {
    const patch: any = { status };
    if (status === "queued") {
      const maxPos = Math.max(0, ...allClips.filter((x) => x.platform === c.platform).map((x) => x.queue_position));
      patch.queue_position = maxPos + 1;
      patch.publish_error = null;
    }
    const { error } = await supabase.from("generated_clips").update(patch).eq("id", c.id);
    if (error) return toast.error(error.message);
    onChange();
  }

  async function moveToTop(c: ClipRow) {
    const minPos = Math.min(0, ...allClips.filter((x) => x.platform === c.platform && x.status === "queued").map((x) => x.queue_position));
    const { error } = await supabase.from("generated_clips").update({ queue_position: minPos - 1 }).eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("Als Nächstes markiert");
    onChange();
  }

  async function remove(id: string) {
    if (!confirm("Clip aus Queue löschen?")) return;
    const { error } = await supabase.from("generated_clips").delete().eq("id", id);
    if (error) return toast.error(error.message);
    onChange();
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <ListOrdered className="h-4 w-4" /> Warteschlange ({clips.length})
        </h2>
        <div className="flex gap-2">
          <select value={platformFilter} onChange={(e) => onPlatformFilter(e.target.value)} className="rounded-md border border-border bg-input px-2 py-1 text-xs focus:border-primary">
            <option value="all">Alle Plattformen</option>
            {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => onStatusFilter(e.target.value)} className="rounded-md border border-border bg-input px-2 py-1 text-xs focus:border-primary">
            <option value="all">Alle Status</option>
            <option value="draft">Entwurf</option>
            <option value="queued">Queued</option>
            <option value="published">Veröffentlicht</option>
            <option value="failed">Fehler</option>
          </select>
        </div>
      </div>

      {clips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Noch keine Clips. Rendere im <Link to="/app" className="text-primary underline">Editor</Link> und wähle „Queue".
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card/60 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Clip</th>
                <th className="px-3 py-2">Plattform</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Zeit</th>
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {clips.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-card/40">
                  <td className="px-3 py-2 font-mono text-xs">{c.queue_position}</td>
                  <td className="px-3 py-2">
                    <div className="text-sm font-medium">{c.title ?? c.edit_jobs?.raw_videos?.title ?? "Clip"}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{c.duration_s ? `${Math.round(Number(c.duration_s))}s` : "—"} · {c.aspect}</div>
                    {c.publish_error && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                        <AlertTriangle className="h-3 w-3" /> {c.publish_error}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs capitalize text-muted-foreground">{c.platform}</td>
                  <td className="px-3 py-2">
                    <StatusPill s={c.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {c.status === "published" && c.published_at
                      ? new Date(c.published_at).toLocaleString()
                      : c.scheduled_for
                        ? new Date(c.scheduled_for).toLocaleString()
                        : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {c.status === "queued" && (
                        <>
                          <button onClick={() => moveToTop(c)} title="Als Nächstes" className="rounded border border-border px-1.5 py-1 text-[10px] hover:bg-background">Als Nächstes</button>
                          <button onClick={() => move(c, -1)} title="Nach oben" className="rounded border border-border px-1 py-1 hover:bg-background"><ArrowUp className="h-3 w-3" /></button>
                          <button onClick={() => move(c, 1)} title="Nach unten" className="rounded border border-border px-1 py-1 hover:bg-background"><ArrowDown className="h-3 w-3" /></button>
                          <button onClick={() => setStatus(c, "draft")} title="In Entwurf" className="rounded border border-border px-1 py-1 hover:bg-background"><Edit3 className="h-3 w-3" /></button>
                        </>
                      )}
                      {c.status === "draft" && (
                        <button onClick={() => setStatus(c, "queued")} className="rounded border border-primary px-2 py-1 text-[10px] text-primary hover:bg-primary/10">In Queue</button>
                      )}
                      {c.status === "failed" && (
                        <button onClick={() => setStatus(c, "queued")} className="rounded border border-primary px-2 py-1 text-[10px] text-primary hover:bg-primary/10">Erneut</button>
                      )}
                      <button onClick={() => remove(c.id)} className="rounded border border-border px-1 py-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusPill({ s }: { s: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    queued: "bg-accent/20 text-accent",
    publishing: "bg-accent/20 text-accent",
    published: "bg-primary/20 text-primary",
    failed: "bg-destructive/20 text-destructive",
  };
  const Icon = s === "published" ? CheckCircle2 : s === "failed" ? AlertTriangle : Clock;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] ${map[s] ?? map.draft}`}>
      <Icon className="h-3 w-3" /> {s}
    </span>
  );
}
