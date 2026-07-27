import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Bot, MessageSquare, Plus, Trash2, UserPlus, MessageCircle, Play, Pause } from "lucide-react";

const PLATFORMS = [
  { id: "instagram", name: "Instagram" },
  { id: "facebook", name: "Facebook" },
  { id: "tiktok", name: "TikTok" },
  { id: "youtube", name: "YouTube" },
] as const;

const TRIGGERS = [
  { id: "new_follower", name: "Neuer Follower", icon: UserPlus, hint: "Begrüßungs-DM direkt nach dem Follow" },
  { id: "comment", name: "Kommentar", icon: MessageCircle, hint: "Antwort unter dem Kommentar (optional nur bei Stichwort)" },
  { id: "dm", name: "Direktnachricht", icon: MessageSquare, hint: "Auto-Antwort im Chat" },
] as const;

export function BrandAutomations({ brandId, userId }: { brandId: string; userId: string }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [platform, setPlatform] = useState<string>("instagram");
  const [trigger, setTrigger] = useState<string>("new_follower");
  const [keyword, setKeyword] = useState("");
  const [message, setMessage] = useState("Hey {name}, danke fürs Folgen! 🙌 Schreib mir „Info“, wenn du mehr wissen willst.");
  const [delay, setDelay] = useState(0);

  const rulesQ = useQuery({
    queryKey: ["automation_rules", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_rules").select("*").eq("brand_id", brandId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const eventsQ = useQuery({
    queryKey: ["automation_events", brandId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_events").select("*").eq("brand_id", brandId)
        .order("created_at", { ascending: false }).limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function add() {
    if (!message.trim()) return toast.error("Bitte eine Nachricht formulieren");
    const { error } = await supabase.from("automation_rules").insert({
      user_id: userId, brand_id: brandId, platform, trigger_type: trigger,
      keyword: trigger === "comment" || trigger === "dm" ? keyword.trim() || null : null,
      message_template: message, delay_minutes: delay, active: true,
    } as never);
    if (error) return toast.error(error.message);
    toast.success("Automatisierung gespeichert");
    setCreating(false);
    qc.invalidateQueries({ queryKey: ["automation_rules", brandId] });
  }

  async function toggle(r: any) {
    const { error } = await supabase.from("automation_rules").update({ active: !r.active }).eq("id", r.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["automation_rules", brandId] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("automation_rules").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["automation_rules", brandId] });
  }

  const rules = rulesQ.data ?? [];

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Bot className="h-4 w-4 text-accent" /> Automatische Antworten ({rules.length})
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Personalisierte Nachrichten bei neuem Follower, Kommentar oder DM. Platzhalter:{" "}
            <code className="rounded bg-background px-1 font-mono text-[10px]">{"{name}"}</code>,{" "}
            <code className="rounded bg-background px-1 font-mono text-[10px]">{"{brand}"}</code>. Der
            Hintergrund-Job prüft alle 5 Minuten auf neue Ereignisse.
          </p>
        </div>
        <button onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-background">
          <Plus className="h-3 w-3" /> Neue Regel
        </button>
      </div>

      {creating && (
        <div className="space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <button key={p.id} onClick={() => setPlatform(p.id)}
                className={`rounded-md border px-2.5 py-1.5 text-xs ${platform === p.id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-card"}`}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {TRIGGERS.map((t) => (
              <button key={t.id} onClick={() => setTrigger(t.id)}
                className={`rounded-lg border p-2.5 text-left text-xs ${trigger === t.id ? "border-primary bg-primary/10" : "border-border hover:bg-card"}`}>
                <div className="flex items-center gap-1.5 font-medium"><t.icon className="h-3.5 w-3.5" /> {t.name}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{t.hint}</div>
              </button>
            ))}
          </div>
          {(trigger === "comment" || trigger === "dm") && (
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder="Nur bei Stichwort (optional, z. B. „Preis“)"
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs outline-none focus:border-primary" />
          )}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
            className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs outline-none focus:border-primary" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              Verzögerung
              <input type="number" min={0} max={1440} value={delay}
                onChange={(e) => setDelay(Math.max(0, Number(e.target.value)))}
                className="w-16 rounded-md border border-border bg-input px-2 py-1 text-xs" /> Min
            </label>
            <div className="flex gap-2">
              <button onClick={() => setCreating(false)} className="rounded-md border border-border px-3 py-1.5 text-xs">Abbrechen</button>
              <button onClick={add} className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">Speichern</button>
            </div>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Noch keine Automatisierung. Typischer Start: Begrüßungs-DM für neue Follower.
        </div>
      ) : (
        <div className="grid gap-2">
          {rules.map((r: any) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] capitalize">{r.platform}</span>
                  <span>{TRIGGERS.find((t) => t.id === r.trigger_type)?.name ?? r.trigger_type}</span>
                  {r.keyword && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">„{r.keyword}"</span>}
                  {r.delay_minutes > 0 && <span className="font-mono text-[10px] text-muted-foreground">+{r.delay_minutes} Min</span>}
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{r.message_template}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => toggle(r)} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-card">
                  {r.active ? <><Pause className="h-3 w-3" /> Pausieren</> : <><Play className="h-3 w-3" /> Aktivieren</>}
                </button>
                <button onClick={() => remove(r.id)} className="rounded border border-border px-1.5 py-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(eventsQ.data ?? []).length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Letzte Aktionen</div>
          <div className="space-y-1">
            {(eventsQ.data ?? []).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-muted-foreground">
                  {new Date(e.created_at).toLocaleString("de-AT")} · {e.platform} · {e.trigger_type} ·{" "}
                  {e.target_handle ?? "—"}
                </span>
                <span className={e.status === "sent" ? "text-primary" : "text-destructive"}>{e.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
