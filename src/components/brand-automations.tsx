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
    <section className="space-y-5 rounded-[18px] border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Bot className="h-4 w-4 text-muted-foreground" /> Automatische Antworten ({rules.length})
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Personalisierte Nachrichten bei neuem Follower, Kommentar oder DM. Platzhalter:{" "}
            <code className="rounded-[5px] bg-secondary px-1.5 font-mono text-[12px] text-foreground">{"{name}"}</code>,{" "}
            <code className="rounded-[5px] bg-secondary px-1.5 font-mono text-[12px] text-foreground">{"{brand}"}</code>. Der
            Hintergrund-Job prüft alle 5 Minuten auf neue Ereignisse.
          </p>
        </div>
        <button onClick={() => setCreating((v) => !v)}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
          <Plus className="h-3.5 w-3.5" /> Neue Regel
        </button>
      </div>

      {creating && (
        <div className="space-y-4 rounded-[14px] border border-border bg-background p-5">
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button key={p.id} onClick={() => setPlatform(p.id)}
                className={`inline-flex h-9 items-center justify-center rounded-full px-4 text-[13px] font-semibold transition-colors ${platform === p.id ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"}`}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {TRIGGERS.map((t) => (
              <button key={t.id} onClick={() => setTrigger(t.id)}
                className={`rounded-[14px] border p-4 text-left text-[15px] transition-colors ${trigger === t.id ? "border-primary bg-card" : "border-border bg-card/60 hover:bg-card"}`}>
                <div className="flex items-center gap-2 font-semibold"><t.icon className="h-4 w-4 text-muted-foreground" /> {t.name}</div>
                <div className="mt-1 text-[13px] text-muted-foreground">{t.hint}</div>
              </button>
            ))}
          </div>
          {(trigger === "comment" || trigger === "dm") && (
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder="Nur bei Stichwort (optional, z. B. „Preis“)"
              className="h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />
          )}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
            className="min-h-[96px] w-full rounded-[11px] border border-border bg-input px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              Verzögerung
              <input type="number" min={0} max={1440} value={delay}
                onChange={(e) => setDelay(Math.max(0, Number(e.target.value)))}
                className="h-9 w-20 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/60" /> Min
            </label>
            <div className="flex gap-2">
              <button onClick={() => setCreating(false)} className="inline-flex h-9 items-center justify-center rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">Abbrechen</button>
              <button onClick={add} className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">Speichern</button>
            </div>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
          Noch keine Automatisierung. Typischer Start: Begrüßungs-DM für neue Follower.
        </div>
      ) : (
        <div className="grid gap-2">
          {rules.map((r: any) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-[14px] border border-border bg-background px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[12px] font-semibold capitalize text-foreground">{r.platform}</span>
                  <span>{TRIGGERS.find((t) => t.id === r.trigger_type)?.name ?? r.trigger_type}</span>
                  {r.keyword && <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[12px] font-semibold text-foreground">„{r.keyword}“</span>}
                  {r.delay_minutes > 0 && <span className="text-[13px] font-normal tabular-nums text-muted-foreground">+{r.delay_minutes} Min</span>}
                </div>
                <div className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{r.message_template}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggle(r)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
                  {r.active ? <><Pause className="h-3.5 w-3.5" /> Pausieren</> : <><Play className="h-3.5 w-3.5" /> Aktivieren</>}
                </button>
                <button onClick={() => remove(r.id)} className="grid h-9 w-9 place-items-center rounded-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(eventsQ.data ?? []).length > 0 && (
        <div className="border-t border-border pt-4">
          <div className="mb-2 text-[13px] font-semibold text-muted-foreground">Letzte Aktionen</div>
          <div className="space-y-1.5">
            {(eventsQ.data ?? []).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate text-muted-foreground">
                  {new Date(e.created_at).toLocaleString("de-AT")} · {e.platform} · {e.trigger_type} ·{" "}
                  {e.target_handle ?? "–"}
                </span>
                <span className={e.status === "sent" ? "font-semibold text-success" : "font-semibold text-destructive"}>{e.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
