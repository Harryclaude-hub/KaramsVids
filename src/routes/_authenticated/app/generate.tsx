import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Clapperboard,
  Plus,
  Sparkles,
  BookOpen,
  Users,
  Trash2,
  Loader2,
  AlertTriangle,
  Wand2,
  Clock,
  Brain,
  Film,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useActiveBrandId, useBrands } from "@/lib/use-active-brand";
import { getProviderStatus, runGenerationQueue } from "@/lib/generation.functions";

export const Route = createFileRoute("/_authenticated/app/generate")({
  component: GenerateStudio,
});

type Storyline = {
  id: string;
  title: string;
  premise: string | null;
  style: Record<string, unknown>;
  memory: { events?: string[]; facts?: string[] };
  episode_count: number;
  created_at: string;
};

function GenerateStudio() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [activeBrandId] = useActiveBrandId();
  const brandsQ = useBrands(user.id);
  const activeBrand = (brandsQ.data ?? []).find((b) => b.id === activeBrandId) ?? null;

  const [selectedStoryline, setSelectedStoryline] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPremise, setNewPremise] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(30);
  const [withSound, setWithSound] = useState(true);
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [charName, setCharName] = useState("");
  const [charDesc, setCharDesc] = useState("");
  const [addingChar, setAddingChar] = useState(false);
  const [tablesMissing, setTablesMissing] = useState(false);

  const storylinesQ = useQuery({
    queryKey: ["storylines", user.id, activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("storylines" as any)
        .select("*")
        .eq("brand_id", activeBrandId!)
        .order("created_at", { ascending: false });
      if (error) {
        if (error.code === "42P01" || /does not exist|relation/.test(error.message)) {
          setTablesMissing(true);
          return [];
        }
        throw error;
      }
      setTablesMissing(false);
      return (data ?? []) as unknown as Storyline[];
    },
  });

  const charactersQ = useQuery({
    queryKey: ["storyline_characters", selectedStoryline],
    enabled: !!selectedStoryline && !tablesMissing,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("storyline_characters" as any)
        .select("*")
        .eq("storyline_id", selectedStoryline!)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobsQ = useQuery({
    queryKey: ["generation_jobs", user.id, activeBrandId, "video"],
    enabled: !!activeBrandId && !tablesMissing,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generation_jobs" as any)
        .select("*")
        .eq("brand_id", activeBrandId!)
        .in("kind", ["video", "scene"])
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  const storylines = (storylinesQ.data ?? []) as Storyline[];
  const active = storylines.find((s) => s.id === selectedStoryline) ?? null;

  const providerQ = useQuery({
    queryKey: ["provider_status"],
    queryFn: () => getProviderStatus(),
    staleTime: 60_000,
  });
  const providers = providerQ.data as
    { fal: boolean; groq: boolean; lovable_ai: boolean } | undefined;

  const [processing, setProcessing] = useState(false);
  async function processQueue() {
    setProcessing(true);
    try {
      const res = await runGenerationQueue();
      if (res.processed > 0) toast.success(`${res.processed} Job(s) verarbeitet`);
      jobsQ.refetch();
      qc.invalidateQueries({ queryKey: ["storylines", user.id, activeBrandId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verarbeitung fehlgeschlagen");
    } finally {
      setProcessing(false);
    }
  }

  async function createStoryline() {
    if (!activeBrand) return;
    const title = newTitle.trim();
    if (!title) return;
    const { data, error } = await supabase
      .from("storylines" as any)
      .insert({
        user_id: user.id,
        brand_id: activeBrand.id,
        title,
        premise: newPremise.trim() || null,
      } as any)
      .select()
      .single();
    if (error) return toast.error(error.message);
    toast.success(`Storyline „${title}“ angelegt`);
    setNewTitle("");
    setNewPremise("");
    setCreating(false);
    setSelectedStoryline((data as any).id);
    qc.invalidateQueries({ queryKey: ["storylines", user.id, activeBrandId] });
  }

  async function addCharacter() {
    if (!selectedStoryline) return;
    const name = charName.trim();
    if (!name) return;
    const { error } = await supabase.from("storyline_characters" as any).insert({
      user_id: user.id,
      storyline_id: selectedStoryline,
      name,
      description: charDesc.trim() || null,
    } as any);
    if (error) return toast.error(error.message);
    setCharName("");
    setCharDesc("");
    setAddingChar(false);
    charactersQ.refetch();
  }

  async function deleteCharacter(id: string) {
    await supabase
      .from("storyline_characters" as any)
      .delete()
      .eq("id", id);
    charactersQ.refetch();
  }

  async function queueGeneration() {
    if (!activeBrand) return toast.error("Bitte zuerst ein Profil wählen");
    const p = prompt.trim();
    if (!p) return toast.error("Beschreibe, was generiert werden soll");
    const { error } = await supabase.from("generation_jobs" as any).insert({
      user_id: user.id,
      brand_id: activeBrand.id,
      storyline_id: selectedStoryline,
      kind: selectedStoryline ? "video" : "scene",
      prompt: p,
      options: { duration_s: duration, sound: withSound, aspect },
      status: "waiting_provider",
    } as any);
    if (error) return toast.error(error.message);
    toast.success(
      providers?.fal
        ? "Generierung gestartet"
        : "Eingereiht: KI schreibt jetzt das Skript, das Video startet, sobald der Provider-Key da ist",
    );
    setPrompt("");
    jobsQ.refetch();
    // Sofort verarbeiten: Skript + Gedächtnis laufen ohne Provider-Key
    processQueue();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
          <Clapperboard className="h-4 w-4" /> KI-Studio
        </p>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight">Komplette Videos generieren</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Storylines mit Gedächtnis: Charaktere, Fakten und Ereignisse bleiben über alle Episoden
          konsistent, alles in einem Profil.
        </p>
      </div>

      {!activeBrand && (
        <div className="flex items-start gap-2 rounded-[11px] border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>Wähle links ein Profil, um Storylines und Generierungen zu sehen.</span>
        </div>
      )}

      {tablesMissing && (
        <div className="flex items-start gap-2 rounded-[11px] border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Die Studio-Tabellen sind noch nicht migriert. Die Migration liegt im Repo (
            <code>supabase/migrations</code>) und wird beim nächsten Lovable-Sync/Publish
            angewendet.
          </span>
        </div>
      )}

      <div
        className={`grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] ${activeBrand ? "" : "pointer-events-none opacity-50"}`}
      >
        {/* Storylines Sidebar */}
        <aside className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
              <BookOpen className="h-4 w-4" /> Storylines
            </div>
            <button
              onClick={() => setCreating((v) => !v)}
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Neue Storyline"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {creating && (
            <div className="space-y-2 rounded-[18px] border border-border bg-card p-4">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={'Titel (z.B. „Abenteuer von Max“)'}
                className="h-9 w-full rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
              />
              <textarea
                value={newPremise}
                onChange={(e) => setNewPremise(e.target.value)}
                placeholder="Prämisse: Worum geht's? Stil? Ton?"
                rows={3}
                className="w-full rounded-[9px] border border-border bg-input px-2.5 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
              />
              <button
                onClick={createStoryline}
                className="inline-flex h-9 w-full items-center justify-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]"
              >
                Anlegen
              </button>
            </div>
          )}

          <button
            onClick={() => setSelectedStoryline(null)}
            className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left ${selectedStoryline === null ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}
          >
            <Wand2 className="h-4 w-4 shrink-0 text-primary" />
            <div>
              <div className="text-[15px] font-semibold">Freie Szene</div>
              <div className="text-[13px] text-muted-foreground">
                Einzelnes Video ohne Storyline
              </div>
            </div>
          </button>

          {storylines.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedStoryline(s.id)}
              className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left ${selectedStoryline === s.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}
            >
              <BookOpen className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{s.title}</div>
                <div className="text-[13px] text-muted-foreground">{s.episode_count} Episoden</div>
              </div>
            </button>
          ))}
        </aside>

        {/* Main */}
        <div className="space-y-4">
          {/* Storyline-Kontext */}
          {active && (
            <div className="grid gap-6 rounded-[18px] border border-border bg-card p-6 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
                  <Brain className="h-4 w-4 text-primary" /> Gedächtnis
                </div>
                <p className="text-[13px] leading-relaxed text-foreground">
                  {active.premise ?? "Keine Prämisse."}
                </p>
                {(active.memory?.events?.length ?? 0) > 0 && (
                  <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
                    {active.memory.events!.slice(-5).map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                )}
                {(active.memory?.events?.length ?? 0) === 0 && (
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Noch keine Ereignisse. Nach jeder Episode wird das Gedächtnis automatisch
                    erweitert.
                  </p>
                )}
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
                    <Users className="h-4 w-4 text-primary" /> Charaktere
                  </div>
                  <button
                    onClick={() => setAddingChar((v) => !v)}
                    className="text-[13px] font-semibold text-accent hover:underline"
                  >
                    <Plus className="inline h-3.5 w-3.5" /> Neu
                  </button>
                </div>
                {addingChar && (
                  <div className="mb-3 space-y-2">
                    <input
                      value={charName}
                      onChange={(e) => setCharName(e.target.value)}
                      placeholder="Name"
                      className="h-9 w-full rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
                    />
                    <input
                      value={charDesc}
                      onChange={(e) => setCharDesc(e.target.value)}
                      placeholder="Aussehen, Persönlichkeit, Stimme"
                      className="h-9 w-full rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
                    />
                    <button
                      onClick={addCharacter}
                      className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]"
                    >
                      OK
                    </button>
                  </div>
                )}
                <div className="space-y-1">
                  {(charactersQ.data ?? []).map((c: any) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 rounded-[10px] border border-border bg-background px-3 py-2 text-[13px]"
                    >
                      <span className="font-semibold">{c.name}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {c.description}
                      </span>
                      <button
                        onClick={() => deleteCharacter(c.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {(charactersQ.data ?? []).length === 0 && !addingChar && (
                    <p className="text-[13px] text-muted-foreground">
                      Noch keine Charaktere.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Prompt */}
          <div className="space-y-4 rounded-[18px] border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
              <Sparkles className="h-4 w-4 text-primary" />
              {active ? `Nächste Episode: ${active.title}` : "Freie Szene generieren"}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                active
                  ? "Was passiert in dieser Episode? Die KI kennt Prämisse, Charaktere und bisherige Ereignisse."
                  : "Beschreibe die Szene: Ort, Stimmung, Handlung, Kamerabewegung …"
              }
              rows={4}
              className="min-h-[96px] w-full rounded-[11px] border border-border bg-input px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
            />
            <div className="flex flex-wrap items-center gap-4 text-[13px]">
              <label className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-muted-foreground">Dauer</span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value))}
                  className="h-9 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
                >
                  <option value={10}>10s</option>
                  <option value={30}>30s</option>
                  <option value={60}>1 min</option>
                  <option value={180}>3 min</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-muted-foreground">
                  Format
                </span>
                <select
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value as any)}
                  className="h-9 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60"
                >
                  <option value="9:16">9:16</option>
                  <option value="16:9">16:9</option>
                  <option value="1:1">1:1</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={withSound}
                  onChange={(e) => setWithSound(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Sound & Musik
              </label>
              <button
                onClick={queueGeneration}
                disabled={!prompt.trim() || tablesMissing}
                className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
              >
                <Film className="h-4 w-4" /> Generieren
              </button>
            </div>
            <p className="text-[13px] text-muted-foreground">
              {providers?.fal ? (
                <>Video-Provider verbunden: Generierung läuft vollautomatisch.</>
              ) : (
                <>
                  Skript & Story-Gedächtnis laufen sofort (KI schreibt die Episode). Das
                  Video-Rendering startet automatisch, sobald der <code>FAL_KEY</code> als Secret
                  hinterlegt ist.
                </>
              )}
            </p>
          </div>

          {/* Jobs */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
              <Clock className="h-4 w-4" /> Generierungen
              <button
                onClick={processQueue}
                disabled={processing}
                className="ml-auto inline-flex h-9 items-center gap-2 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground hover:bg-[#dcdce1] disabled:opacity-40 dark:hover:bg-[#3a3a3c]"
                title="Queue jetzt verarbeiten (Skripte schreiben, Provider-Jobs prüfen)"
              >
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Verarbeiten
              </button>
            </div>
            {(jobsQ.data ?? []).length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                Noch keine Generierungen für dieses Profil.
              </div>
            ) : (
              <div className="space-y-2">
                {(jobsQ.data ?? []).map((j: any) => (
                  <GenerationJobCard key={j.id} job={j} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function GenerationJobCard({ job: j }: { job: any }) {
  const [open, setOpen] = useState(false);
  const script = j.options?.script as
    | {
        title?: string;
        summary?: string;
        scenes?: Array<{ shot: string; description: string; dialog?: string; sound?: string }>;
      }
    | undefined;
  return (
    <div className="rounded-[18px] border border-border bg-card p-4 text-[13px]">
      <div className="flex items-center gap-3">
        {j.status === "running" ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : (
          <Film className="h-4 w-4 shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{script?.title ?? j.prompt}</div>
          <div className="text-[13px] text-muted-foreground tabular-nums">
            {new Date(j.created_at).toLocaleString()} · {j.options?.duration_s ?? "?"}s ·{" "}
            {j.options?.aspect ?? ""}
          </div>
        </div>
        {script && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-8 shrink-0 items-center rounded-full bg-secondary px-3 text-[12px] font-semibold text-foreground hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"
          >
            {open ? "Skript ausblenden" : "Skript anzeigen"}
          </button>
        )}
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${jobStatusColor(j.status)}`}
        >
          {j.status === "waiting_provider"
            ? script
              ? "Skript fertig · wartet auf Video-Provider"
              : "wartet auf Provider"
            : j.status}
        </span>
      </div>
      {open && script && (
        <div className="mt-3 space-y-2 rounded-[11px] border border-border bg-background p-3">
          {script.summary && <p className="text-muted-foreground">{script.summary}</p>}
          {(script.scenes ?? []).map((s, i) => (
            <div key={i} className="rounded-[10px] border border-border p-3">
              <div className="font-semibold">{s.shot}</div>
              <div className="text-muted-foreground">{s.description}</div>
              {s.dialog && <div className="mt-0.5 italic">„{s.dialog}“</div>}
              {s.sound && <div className="text-[12px] text-muted-foreground">♪ {s.sound}</div>}
            </div>
          ))}
        </div>
      )}
      {j.output_url && (
        <div className="mt-3">
          <video src={j.output_url} controls className="w-full max-w-sm rounded-[11px] bg-black" />
          <a
            href={j.output_url}
            target="_blank"
            rel="noreferrer"
            download
            className="mt-2 inline-flex h-9 items-center rounded-[11px] border border-border bg-card px-4 text-[13px] font-semibold text-foreground hover:bg-secondary"
          >
            Video herunterladen
          </a>
        </div>
      )}
      {j.error && <p className="mt-2 text-[13px] text-destructive">{j.error}</p>}
    </div>
  );
}

function jobStatusColor(s: string) {
  return (
    (
      {
        pending: "bg-secondary text-muted-foreground",
        waiting_provider: "bg-warning/15 text-warning",
        running: "bg-primary/15 text-primary",
        done: "bg-success/15 text-success",
        failed: "bg-destructive/15 text-destructive",
      } as Record<string, string>
    )[s] ?? "bg-secondary text-muted-foreground"
  );
}
