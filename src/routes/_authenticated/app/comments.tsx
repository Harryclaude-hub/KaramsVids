import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  MessageSquare,
  RefreshCw,
  Loader2,
  Send,
  SkipForward,
  Sparkles,
  Plus,
  Trash2,
  Bot,
  ExternalLink,
  AlertTriangle,
  Power,
} from "lucide-react";
import { useBrands } from "@/lib/use-active-brand";

export const Route = createFileRoute("/_authenticated/app/comments")({
  component: Comments,
});

type Platform = "tiktok" | "youtube" | "instagram" | "facebook" | "x";
const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
};

type CommentRow = {
  id: string;
  brand_id: string | null;
  social_account_id: string;
  platform: string;
  post_url: string | null;
  author_handle: string | null;
  author_name: string | null;
  text: string;
  like_count: number;
  posted_at: string | null;
  status: string;
  reply_text: string | null;
  reply_mode: string | null;
  replied_at: string | null;
  error: string | null;
};

type AccountRow = {
  id: string;
  brand_id: string | null;
  platform: string;
  handle: string | null;
  display_name: string | null;
  auto_reply_enabled: boolean;
  last_comment_sync_at: string | null;
  sync_error: string | null;
  status: string;
};

type RuleRow = {
  id: string;
  brand_id: string | null;
  platform: string | null;
  social_account_id: string | null;
  name: string;
  mode: string;
  keywords: string[];
  exclude_keywords: string[];
  message_template: string | null;
  ai_instruction: string | null;
  ai_tone: string;
  max_length: number;
  daily_limit: number;
  delay_minutes: number;
  priority: number;
  active: boolean;
};

const EMPTY_RULE = {
  id: null as string | null,
  brandId: null as string | null,
  platform: null as Platform | null,
  socialAccountId: null as string | null,
  name: "Neue Regel",
  mode: "template" as "template" | "ai",
  keywords: "",
  excludeKeywords: "",
  messageTemplate: "Danke dir, {name}! 🙏",
  aiInstruction: "",
  aiTone: "freundlich",
  maxLength: 220,
  dailyLimit: 50,
  delayMinutes: 0,
  priority: 0,
  active: true,
};

// Apple-Rezepte als Klassen, damit die Bausteine hier einheitlich aussehen.
const BTN_PRIMARY =
  "inline-flex items-center gap-2 h-11 px-5 rounded-full bg-primary text-primary-foreground text-[15px] font-semibold hover:bg-[#0077ed] disabled:opacity-40";
const BTN_SMALL_PRIMARY =
  "inline-flex items-center gap-2 h-9 px-4 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-[#0077ed] disabled:opacity-40";
const BTN_SMALL_SECONDARY =
  "inline-flex items-center gap-2 h-9 px-4 rounded-full bg-secondary text-foreground text-[13px] font-semibold hover:bg-[#dcdce1] disabled:opacity-40";

function Comments() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const brandsQ = useBrands(user.id);
  const brands = brandsQ.data ?? [];

  const [tab, setTab] = useState<"inbox" | "rules">("inbox");
  const [statusFilter, setStatusFilter] = useState<"new" | "replied" | "failed" | "all">("new");
  const [brandFilter, setBrandFilter] = useState<string | "all">("all");
  const [platformFilter, setPlatformFilter] = useState<string | "all">("all");
  const [syncing, setSyncing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const accountsQ = useQuery({
    queryKey: ["social-accounts-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_accounts")
        .select(
          "id, brand_id, platform, handle, display_name, auto_reply_enabled, last_comment_sync_at, sync_error, status",
        )
        .neq("status", "disconnected");
      if (error) throw error;
      return (data ?? []) as unknown as AccountRow[];
    },
  });

  const commentsQ = useQuery({
    queryKey: ["social-comments", statusFilter, brandFilter, platformFilter],
    queryFn: async () => {
      let q = supabase
        .from("social_comments")
        .select(
          "id, brand_id, social_account_id, platform, post_url, author_handle, author_name, text, like_count, posted_at, status, reply_text, reply_mode, replied_at, error",
        )
        .order("posted_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (brandFilter !== "all") q = q.eq("brand_id", brandFilter);
      if (platformFilter !== "all") q = q.eq("platform", platformFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CommentRow[];
    },
  });

  const rulesQ = useQuery({
    queryKey: ["comment-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comment_reply_rules")
        .select("*")
        .order("priority", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RuleRow[];
    },
  });

  const accounts = accountsQ.data ?? [];
  const comments = commentsQ.data ?? [];
  const rules = rulesQ.data ?? [];
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands]);
  const autoOn = accounts.filter((a) => a.auto_reply_enabled).length;

  async function syncNow() {
    setSyncing(true);
    try {
      const { syncCommentsNow } = await import("@/lib/comments.functions");
      const r = await syncCommentsNow({ data: {} });
      const bits = [`${r.new} neu`, `${r.replied} beantwortet`];
      toast.success(`Abgeholt: ${bits.join(", ")} (${r.accounts} Accounts)`);
      if (r.problems.length) {
        toast.warning(r.problems.map((p) => `${p.account}: ${p.error}`).join("\n"), {
          duration: 14000,
        });
      }
      qc.invalidateQueries({ queryKey: ["social-comments"] });
      qc.invalidateQueries({ queryKey: ["social-accounts-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Abholen fehlgeschlagen", { duration: 12000 });
    } finally {
      setSyncing(false);
    }
  }

  async function toggleAuto(acc: AccountRow) {
    try {
      const { setAutoReply } = await import("@/lib/comments.functions");
      await setAutoReply({ data: { accountId: acc.id, enabled: !acc.auto_reply_enabled } });
      qc.invalidateQueries({ queryKey: ["social-accounts-all"] });
      toast.success(
        `Auto-Antworten für ${acc.handle ?? PLATFORM_LABEL[acc.platform]} ${acc.auto_reply_enabled ? "aus" : "an"}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Umschalten fehlgeschlagen");
    }
  }

  async function sendReply(c: CommentRow) {
    const text = (drafts[c.id] ?? "").trim();
    if (!text) return toast.error("Antworttext fehlt");
    setBusyId(c.id);
    try {
      const { replyManually } = await import("@/lib/comments.functions");
      await replyManually({ data: { commentId: c.id, text } });
      toast.success("Antwort gesendet");
      setDrafts((d) => ({ ...d, [c.id]: "" }));
      qc.invalidateQueries({ queryKey: ["social-comments"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Antwort fehlgeschlagen", { duration: 12000 });
    } finally {
      setBusyId(null);
    }
  }

  async function skip(c: CommentRow) {
    setBusyId(c.id);
    try {
      const { skipComment } = await import("@/lib/comments.functions");
      await skipComment({ data: { commentId: c.id } });
      qc.invalidateQueries({ queryKey: ["social-comments"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehlgeschlagen");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-muted-foreground">Community</p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-tight">Kommentare</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Alle Kommentare deiner verbundenen Kanäle an einem Ort, von Hand oder automatisch
            beantwortet.
          </p>
        </div>
        <button onClick={syncNow} disabled={syncing} className={BTN_PRIMARY}>
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Jetzt abholen
        </button>
      </div>

      <div className="flex h-9 rounded-[10px] bg-secondary p-[3px]">
        {(
          [
            ["inbox", "Posteingang", MessageSquare],
            ["rules", `Regeln (${rules.filter((r) => r.active).length})`, Bot],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-[8px] px-3 text-[13px] font-semibold ${
              tab === id ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Auto-Antwort-Schalter je Kanal */}
      <div className="rounded-[18px] border border-border bg-card p-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <Power className="h-4 w-4 text-primary" />
            Auto-Antworten
          </div>
          <span className="text-[13px] text-muted-foreground">
            {autoOn} von {accounts.length} Kanälen aktiv
          </span>
        </div>
        {accounts.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Noch kein Kanal verbunden. Das geht unter „Kanäle“.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => toggleAuto(a)}
                className={`flex items-center justify-between gap-3 rounded-[11px] border px-3 py-2 text-left text-[13px] transition-colors ${
                  a.auto_reply_enabled
                    ? "border-primary bg-card"
                    : "border-border hover:bg-secondary"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {a.handle ?? a.display_name ?? "Kanal"}
                  </span>
                  <span className="block text-[12px] text-muted-foreground">
                    {PLATFORM_LABEL[a.platform] ?? a.platform}
                    {a.brand_id && brandById.get(a.brand_id)
                      ? ` · ${brandById.get(a.brand_id)!.name}`
                      : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
                    a.auto_reply_enabled
                      ? "bg-success/15 text-success"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {a.auto_reply_enabled ? "An" : "Aus"}
                </span>
              </button>
            ))}
          </div>
        )}
        {accounts.some((a) => a.sync_error) && (
          <div className="mt-3 space-y-1 rounded-[11px] border border-destructive/40 bg-destructive/5 p-3">
            {accounts
              .filter((a) => a.sync_error)
              .map((a) => (
                <p key={a.id} className="flex items-start gap-1.5 text-[13px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <span className="font-semibold">{a.handle ?? PLATFORM_LABEL[a.platform]}:</span>{" "}
                    {a.sync_error}
                  </span>
                </p>
              ))}
          </div>
        )}
      </div>

      {tab === "inbox" ? (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-border bg-card p-3">
            <Chips
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as typeof statusFilter)}
              options={[
                ["new", "Offen"],
                ["replied", "Beantwortet"],
                ["failed", "Fehler"],
                ["all", "Alle"],
              ]}
            />
            <span className="h-5 w-px bg-border" />
            <Chips
              value={platformFilter}
              onChange={setPlatformFilter}
              options={[["all", "Alle Plattformen"], ...Object.entries(PLATFORM_LABEL)]}
            />
            {brands.length > 1 && (
              <>
                <span className="h-5 w-px bg-border" />
                <Chips
                  value={brandFilter}
                  onChange={setBrandFilter}
                  options={[
                    ["all", "Alle Profile"],
                    ...brands.map((b) => [b.id, b.name] as [string, string]),
                  ]}
                />
              </>
            )}
          </div>

          {commentsQ.isLoading ? (
            <div className="grid place-items-center rounded-[18px] border border-dashed border-border p-10 text-[15px] text-muted-foreground">
              <Loader2 className="mb-2 h-5 w-5 animate-spin" />
              Kommentare werden geladen
            </div>
          ) : comments.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-border p-10 text-center text-[15px] text-muted-foreground">
              Keine Kommentare in dieser Ansicht. Mit „Jetzt abholen“ holst du den aktuellen Stand.
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => {
                const acc = accountById.get(c.social_account_id);
                return (
                  <div key={c.id} className="rounded-[18px] border border-border bg-card p-5">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[12px] font-semibold text-foreground">
                        {PLATFORM_LABEL[c.platform] ?? c.platform}
                      </span>
                      <span className="font-semibold text-foreground">
                        {c.author_handle ?? c.author_name ?? "Unbekannt"}
                      </span>
                      {acc && <span>an {acc.handle ?? acc.display_name}</span>}
                      {c.posted_at && (
                        <span>· {new Date(c.posted_at).toLocaleString("de-DE")}</span>
                      )}
                      {c.like_count > 0 && <span>· {c.like_count} Likes</span>}
                      {c.post_url && (
                        <a
                          href={c.post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                        >
                          Beitrag <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    <p className="mt-2 whitespace-pre-wrap text-[15px]">{c.text}</p>

                    {c.status === "replied" ? (
                      <div className="mt-3 rounded-[14px] border border-border bg-background p-4">
                        <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                          {c.reply_mode === "ai" ? (
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <Send className="h-3.5 w-3.5 text-primary" />
                          )}
                          Antwort
                          {c.reply_mode === "ai" && " (KI)"}
                          {c.reply_mode === "manual" && " (von Hand)"}
                          {c.replied_at && ` · ${new Date(c.replied_at).toLocaleString("de-DE")}`}
                        </div>
                        <p className="whitespace-pre-wrap text-[15px]">{c.reply_text}</p>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {c.error && (
                          <p className="flex items-start gap-1.5 text-[13px] text-destructive">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {c.error}
                          </p>
                        )}
                        <textarea
                          value={drafts[c.id] ?? ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                          rows={2}
                          placeholder="Antwort schreiben…"
                          className="min-h-[96px] w-full resize-y rounded-[11px] border border-border bg-input px-4 py-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => sendReply(c)}
                            disabled={busyId === c.id}
                            className={BTN_SMALL_PRIMARY}
                          >
                            {busyId === c.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            Antworten
                          </button>
                          <button
                            onClick={() => skip(c)}
                            disabled={busyId === c.id}
                            className={BTN_SMALL_SECONDARY}
                          >
                            <SkipForward className="h-3.5 w-3.5" /> Abhaken
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <RulesPanel
          rules={rules}
          brands={brands}
          accounts={accounts}
          onChanged={() => qc.invalidateQueries({ queryKey: ["comment-rules"] })}
        />
      )}
    </div>
  );
}

function Chips({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <>
      {options.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-colors ${
            value === id
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </>
  );
}

// ============================================================
// Regeln
// ============================================================

function RulesPanel({
  rules,
  brands,
  accounts,
  onChanged,
}: {
  rules: RuleRow[];
  brands: Array<{ id: string; name: string }>;
  accounts: AccountRow[];
  onChanged: () => void;
}) {
  const [form, setForm] = useState<typeof EMPTY_RULE | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sample, setSample] = useState("Wo kann ich das kaufen?");

  function edit(r: RuleRow) {
    setForm({
      id: r.id,
      brandId: r.brand_id,
      platform: (r.platform as Platform) ?? null,
      socialAccountId: r.social_account_id,
      name: r.name,
      mode: r.mode === "ai" ? "ai" : "template",
      keywords: r.keywords.join(", "),
      excludeKeywords: r.exclude_keywords.join(", "),
      messageTemplate: r.message_template ?? "",
      aiInstruction: r.ai_instruction ?? "",
      aiTone: r.ai_tone,
      maxLength: r.max_length,
      dailyLimit: r.daily_limit,
      delayMinutes: r.delay_minutes,
      priority: r.priority,
      active: r.active,
    });
    setPreview(null);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const { saveReplyRule } = await import("@/lib/comments.functions");
      await saveReplyRule({
        data: {
          id: form.id,
          brandId: form.brandId,
          platform: form.platform,
          socialAccountId: form.socialAccountId,
          name: form.name,
          mode: form.mode,
          keywords: form.keywords
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          excludeKeywords: form.excludeKeywords
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          messageTemplate: form.messageTemplate || null,
          aiInstruction: form.aiInstruction || null,
          aiTone: form.aiTone,
          maxLength: form.maxLength,
          dailyLimit: form.dailyLimit,
          delayMinutes: form.delayMinutes,
          priority: form.priority,
          active: form.active,
        },
      });
      toast.success("Regel gespeichert");
      setForm(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen", { duration: 10000 });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      const { deleteReplyRule } = await import("@/lib/comments.functions");
      await deleteReplyRule({ data: { id } });
      toast.success("Regel gelöscht");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen");
    }
  }

  async function testAi() {
    if (!form?.aiInstruction.trim()) return toast.error("Erst eine Anweisung schreiben");
    setPreviewing(true);
    try {
      const { previewAiReply } = await import("@/lib/comments.functions");
      const r = await previewAiReply({
        data: {
          commentText: sample,
          aiInstruction: form.aiInstruction,
          aiTone: form.aiTone,
          maxLength: form.maxLength,
          brandName: form.brandId
            ? (brands.find((b) => b.id === form.brandId)?.name ?? null)
            : null,
          authorName: "Lisa",
        },
      });
      setPreview(r.text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Vorschau fehlgeschlagen", { duration: 12000 });
    } finally {
      setPreviewing(false);
    }
  }

  const input =
    "h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60";
  const textarea =
    "min-h-[96px] w-full rounded-[11px] border border-border bg-input px-4 py-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60";
  const labelCls = "text-[13px] font-semibold text-foreground";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          Regeln greifen von oben nach unten: die Regel mit der höchsten Priorität, deren Stichwort
          passt, antwortet.
        </p>
        <button
          onClick={() => {
            setForm({ ...EMPTY_RULE });
            setPreview(null);
          }}
          className={`shrink-0 ${BTN_SMALL_PRIMARY}`}
        >
          <Plus className="h-3.5 w-3.5" /> Neue Regel
        </button>
      </div>

      {form && (
        <div className="space-y-4 rounded-[18px] border border-border bg-card p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className={labelCls}>Name</span>
              <input
                className={input}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelCls}>Art der Antwort</span>
              <select
                className={input}
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value as "template" | "ai" })}
              >
                <option value="template">Feste Vorlage</option>
                <option value="ai">KI schreibt die Antwort</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className={labelCls}>Profil</span>
              <select
                className={input}
                value={form.brandId ?? ""}
                onChange={(e) => setForm({ ...form, brandId: e.target.value || null })}
              >
                <option value="">Alle Profile</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className={labelCls}>Plattform</span>
              <select
                className={input}
                value={form.platform ?? ""}
                onChange={(e) =>
                  setForm({ ...form, platform: (e.target.value || null) as Platform | null })
                }
              >
                <option value="">Alle Plattformen</option>
                {Object.entries(PLATFORM_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 sm:col-span-2">
              <span className={labelCls}>Nur dieser Kanal (optional)</span>
              <select
                className={input}
                value={form.socialAccountId ?? ""}
                onChange={(e) => setForm({ ...form, socialAccountId: e.target.value || null })}
              >
                <option value="">Alle Kanäle</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.handle ?? a.display_name ?? "Kanal") +
                      " · " +
                      (PLATFORM_LABEL[a.platform] ?? a.platform)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className={labelCls}>Stichwörter (Komma, leer = alle)</span>
              <input
                className={input}
                value={form.keywords}
                placeholder="preis, kaufen, link"
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelCls}>Nie antworten bei</span>
              <input
                className={input}
                value={form.excludeKeywords}
                placeholder="beleidigung, spam"
                onChange={(e) => setForm({ ...form, excludeKeywords: e.target.value })}
              />
            </label>
          </div>

          {form.mode === "template" ? (
            <label className="block space-y-1.5">
              <span className={labelCls}>
                Antworttext · Platzhalter {"{name} {brand} {kommentar}"}
              </span>
              <textarea
                rows={3}
                className={textarea}
                value={form.messageTemplate}
                onChange={(e) => setForm({ ...form, messageTemplate: e.target.value })}
              />
            </label>
          ) : (
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className={labelCls}>Anweisung an die KI</span>
                <textarea
                  rows={3}
                  className={textarea}
                  placeholder="Bedanke dich, beantworte die Frage kurz und verweise bei Preisfragen auf den Link in der Bio."
                  value={form.aiInstruction}
                  onChange={(e) => setForm({ ...form, aiInstruction: e.target.value })}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className={labelCls}>Tonfall</span>
                  <input
                    className={input}
                    value={form.aiTone}
                    onChange={(e) => setForm({ ...form, aiTone: e.target.value })}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className={labelCls}>Testkommentar</span>
                  <input
                    className={input}
                    value={sample}
                    onChange={(e) => setSample(e.target.value)}
                  />
                </label>
              </div>
              <button onClick={testAi} disabled={previewing} className={BTN_SMALL_SECONDARY}>
                {previewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Antwort testen
              </button>
              {preview && (
                <div className="rounded-[14px] border border-border bg-background p-4 text-[15px]">
                  <div className="text-[13px] font-semibold text-muted-foreground">
                    So würde die KI antworten
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{preview}</p>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1.5">
              <span className={labelCls}>Max. Zeichen</span>
              <input
                type="number"
                className={input}
                value={form.maxLength}
                onChange={(e) => setForm({ ...form, maxLength: Number(e.target.value) })}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelCls}>Limit pro Tag</span>
              <input
                type="number"
                className={input}
                value={form.dailyLimit}
                onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelCls}>Wartezeit (Min.)</span>
              <input
                type="number"
                className={input}
                value={form.delayMinutes}
                onChange={(e) => setForm({ ...form, delayMinutes: Number(e.target.value) })}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelCls}>Priorität</span>
              <input
                type="number"
                className={input}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[13px] font-semibold">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Regel aktiv
            </label>
            <div className="flex gap-2">
              <button onClick={() => setForm(null)} className={BTN_SMALL_SECONDARY}>
                Abbrechen
              </button>
              <button onClick={save} disabled={saving} className={BTN_SMALL_PRIMARY}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {rules.length === 0 && !form ? (
        <div className="rounded-[18px] border border-dashed border-border p-10 text-center text-[15px] text-muted-foreground">
          Noch keine Regel. Ohne Regel bleibt jeder Kommentar im Posteingang liegen.
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-start justify-between gap-3 rounded-[18px] border border-border bg-card p-5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold">{r.name}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
                      r.mode === "ai"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-foreground"
                    }`}
                  >
                    {r.mode === "ai" ? "KI" : "Vorlage"}
                  </span>
                  {!r.active && (
                    <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[12px] font-semibold text-warning">
                      Pausiert
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {r.platform ? (PLATFORM_LABEL[r.platform] ?? r.platform) : "Alle Plattformen"}
                  {" · "}
                  {r.brand_id
                    ? (brands.find((b) => b.id === r.brand_id)?.name ?? "Profil")
                    : "Alle Profile"}
                  {" · Priorität "}
                  {r.priority}
                  {" · max. "}
                  {r.daily_limit}
                  {"/Tag"}
                </p>
                <p className="mt-1 truncate text-[13px] text-muted-foreground">
                  {r.keywords.length ? `bei: ${r.keywords.join(", ")}` : "bei jedem Kommentar"}
                  {" · "}
                  {r.mode === "ai" ? r.ai_instruction : r.message_template}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => edit(r)} className={BTN_SMALL_SECONDARY}>
                  Bearbeiten
                </button>
                <button
                  onClick={() => remove(r.id)}
                  className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  title="Löschen"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
