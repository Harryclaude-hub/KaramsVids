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
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useActiveBrandId, useBrands } from "@/lib/use-active-brand";

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
    toast.success(`Storyline „${title}" angelegt`);
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
    if (!activeBrand) return toast.error("Bitte zuerst einen Brand wählen");
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
    toast.success("Generierung eingereiht — startet, sobald ein Video-Provider verbunden ist");
    setPrompt("");
    jobsQ.refetch();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
          <Clapperboard className="h-3 w-3" /> KI-Studio
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Komplette Videos generieren</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Storylines mit Gedächtnis: Charaktere, Fakten und Ereignisse bleiben über alle Episoden
          konsistent — alles in einem Brand.
        </p>
      </div>

      {!activeBrand && (
        <div className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs text-primary">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Wähle links einen Brand, um Storylines und Generierungen zu sehen.</span>
        </div>
      )}

      {tablesMissing && (
        <div className="flex items-start gap-2 rounded-xl border border-accent/40 bg-accent/5 p-3 text-xs text-accent">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
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
            <div className="flex items-center gap-2 text-sm font-medium">
              <BookOpen className="h-4 w-4 text-primary" /> Storylines
            </div>
            <button
              onClick={() => setCreating((v) => !v)}
              className="rounded-md border border-border p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Neue Storyline"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {creating && (
            <div className="space-y-2 rounded-xl border border-border bg-card p-3">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={'Titel (z.B. „Abenteuer von Max")'}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
              <textarea
                value={newPremise}
                onChange={(e) => setNewPremise(e.target.value)}
                placeholder="Prämisse: Worum geht's? Stil? Ton?"
                rows={3}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button
                onClick={createStoryline}
                className="w-full rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Anlegen
              </button>
            </div>
          )}

          <button
            onClick={() => setSelectedStoryline(null)}
            className={`flex w-full items-center gap-2 rounded-xl border p-3 text-left text-xs ${selectedStoryline === null ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
          >
            <Wand2 className="h-4 w-4 shrink-0 text-accent" />
            <div>
              <div className="font-medium">Freie Szene</div>
              <div className="text-[10px] text-muted-foreground">
                Einzelnes Video ohne Storyline
              </div>
            </div>
          </button>

          {storylines.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedStoryline(s.id)}
              className={`flex w-full items-center gap-2 rounded-xl border p-3 text-left text-xs ${selectedStoryline === s.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
            >
              <BookOpen className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.title}</div>
                <div className="text-[10px] text-muted-foreground">{s.episode_count} Episoden</div>
              </div>
            </button>
          ))}
        </aside>

        {/* Main */}
        <div className="space-y-4">
          {/* Storyline-Kontext */}
          {active && (
            <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <Brain className="h-3.5 w-3.5 text-accent" /> Gedächtnis
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {active.premise ?? "Keine Prämisse."}
                </p>
                {(active.memory?.events?.length ?? 0) > 0 && (
                  <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    {active.memory.events!.slice(-5).map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                )}
                {(active.memory?.events?.length ?? 0) === 0 && (
                  <p className="mt-2 text-[10px] italic text-muted-foreground">
                    Noch keine Ereignisse — nach jeder Episode wird das Gedächtnis automatisch
                    erweitert.
                  </p>
                )}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <Users className="h-3.5 w-3.5 text-primary" /> Charaktere
                  </div>
                  <button
                    onClick={() => setAddingChar((v) => !v)}
                    className="text-[10px] text-primary hover:underline"
                  >
                    <Plus className="inline h-3 w-3" /> Neu
                  </button>
                </div>
                {addingChar && (
                  <div className="mb-2 space-y-1">
                    <input
                      value={charName}
                      onChange={(e) => setCharName(e.target.value)}
                      placeholder="Name"
                      className="w-full rounded border border-border bg-input px-2 py-1 text-[11px] outline-none focus:border-primary"
                    />
                    <input
                      value={charDesc}
                      onChange={(e) => setCharDesc(e.target.value)}
                      placeholder="Aussehen, Persönlichkeit, Stimme"
                      className="w-full rounded border border-border bg-input px-2 py-1 text-[11px] outline-none focus:border-primary"
                    />
                    <button
                      onClick={addCharacter}
                      className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
                    >
                      OK
                    </button>
                  </div>
                )}
                <div className="space-y-1">
                  {(charactersQ.data ?? []).map((c: any) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 rounded-md border border-border bg-background p-1.5 text-[11px]"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {c.description}
                      </span>
                      <button
                        onClick={() => deleteCharacter(c.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {(charactersQ.data ?? []).length === 0 && !addingChar && (
                    <p className="text-[10px] italic text-muted-foreground">
                      Noch keine Charaktere.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Prompt */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
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
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase text-muted-foreground">Dauer</span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value))}
                  className="rounded-md border border-border bg-input px-2 py-1 outline-none focus:border-primary"
                >
                  <option value={10}>10s</option>
                  <option value={30}>30s</option>
                  <option value={60}>1 min</option>
                  <option value={180}>3 min</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  Format
                </span>
                <select
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value as any)}
                  className="rounded-md border border-border bg-input px-2 py-1 outline-none focus:border-primary"
                >
                  <option value="9:16">9:16</option>
                  <option value="16:9">16:9</option>
                  <option value="1:1">1:1</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={withSound}
                  onChange={(e) => setWithSound(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Sound & Musik
              </label>
              <button
                onClick={queueGeneration}
                disabled={!prompt.trim() || tablesMissing}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Film className="h-3.5 w-3.5" /> Generieren
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Hinweis: Die Generierung startet, sobald ein Video-Provider (z.B. Kling, Veo, Runway)
              verbunden ist — Jobs warten solange in der Queue.
            </p>
          </div>

          {/* Jobs */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4 text-muted-foreground" /> Generierungen
            </div>
            {(jobsQ.data ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Noch keine Generierungen für diesen Brand.
              </div>
            ) : (
              <div className="space-y-1.5">
                {(jobsQ.data ?? []).map((j: any) => (
                  <div
                    key={j.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-xs"
                  >
                    {j.status === "running" ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                    ) : (
                      <Film className="h-4 w-4 shrink-0 text-primary" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{j.prompt}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {new Date(j.created_at).toLocaleString()} · {j.options?.duration_s ?? "?"}s
                        · {j.options?.aspect ?? ""}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${jobStatusColor(j.status)}`}
                    >
                      {j.status === "waiting_provider" ? "wartet auf Provider" : j.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function jobStatusColor(s: string) {
  return (
    (
      {
        pending: "bg-muted text-muted-foreground",
        waiting_provider: "bg-accent/20 text-accent",
        running: "bg-accent/20 text-accent",
        done: "bg-primary/20 text-primary",
        failed: "bg-destructive/20 text-destructive",
      } as Record<string, string>
    )[s] ?? "bg-muted text-muted-foreground"
  );
}
