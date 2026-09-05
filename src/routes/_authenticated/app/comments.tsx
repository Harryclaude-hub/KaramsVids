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
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Community</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Kommentare</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Alle Kommentare deiner verbundenen Kanäle an einem Ort — von Hand oder automatisch
            beantwortet.
          </p>
        </div>
        <button
          onClick={syncNow}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Jetzt abholen
        </button>
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {(
          [
            ["inbox", "Posteingang", MessageSquare],
            ["rules", `Regeln (${rules.filter((r) => r.active).length})`, Bot],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${
              tab === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Auto-Antwort-Schalter je Kanal */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Power className="h-4 w-4 text-primary" />
            Auto-Antworten
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {autoOn} von {accounts.length} Kanälen aktiv
          </span>
        </div>
        {accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Noch kein Kanal verbunden. Das geht unter „Social“.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => toggleAuto(a)}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs transition ${
                  a.auto_reply_enabled
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:bg-secondary"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {a.handle ?? a.display_name ?? "Kanal"}
                  </span>
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    {PLATFORM_LABEL[a.platform] ?? a.platform}
                    {a.brand_id && brandById.get(a.brand_id)
                      ? ` · ${brandById.get(a.brand_id)!.name}`
                      : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${
                    a.auto_reply_enabled
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {a.auto_reply_enabled ? "an" : "aus"}
                </span>
              </button>
            ))}
          </div>
        )}
        {accounts.some((a) => a.sync_error) && (
          <div className="mt-3 space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2">
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
      </div>

      {tab === "inbox" ? (
        <>
          <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3">
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
            <span className="w-px bg-border" />
            <Chips
              value={platformFilter}
              onChange={setPlatformFilter}
              options={[["all", "Alle Plattformen"], ...Object.entries(PLATFORM_LABEL)]}
            />
            {brands.length > 1 && (
              <>
                <span className="w-px bg-border" />
                <Chips
                  value={brandFilter}
                  onChange={setBrandFilter}
                  options={[
                    ["all", "Alle Brands"],
                    ...brands.map((b) => [b.id, b.name] as [string, string]),
                  ]}
                />
              </>
            )}
          </div>

          {commentsQ.isLoading ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-border p-10 text-sm text-muted-foreground">
              <Loader2 className="mb-2 h-5 w-5 animate-spin" />
              Kommentare werden geladen
            </div>
          ) : comments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Keine Kommentare in dieser Ansicht. Mit „Jetzt abholen“ holst du den aktuellen Stand.
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => {
                const acc = accountById.get(c.social_account_id);
                return (
                  <div key={c.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-mono uppercase">
                        {PLATFORM_LABEL[c.platform] ?? c.platform}
                      </span>
                      <span className="font-medium text-foreground">
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

                    <p className="mt-2 whitespace-pre-wrap text-sm">{c.text}</p>

                    {c.status === "replied" ? (
                      <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-primary">
                          {c.reply_mode === "ai" ? (
                            <Sparkles className="h-3 w-3" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          Antwort
                          {c.reply_mode === "ai" && " (KI)"}
                          {c.reply_mode === "manual" && " (von Hand)"}
                          {c.replied_at && ` · ${new Date(c.replied_at).toLocaleString("de-DE")}`}
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{c.reply_text}</p>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {c.error && (
                          <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            {c.error}
                          </p>
                        )}
                        <textarea
                          value={drafts[c.id] ?? ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                          rows={2}
                          placeholder="Antwort schreiben…"
                          className="w-full resize-y rounded-lg border border-border bg-background p-2 text-sm outline-none focus:border-primary"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => sendReply(c)}
                            disabled={busyId === c.id}
                            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {busyId === c.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Send className="h-3 w-3" />
                            )}
                            Antworten
                          </button>
                          <button
                            onClick={() => skip(c)}
                            disabled={busyId === c.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
                          >
                            <SkipForward className="h-3 w-3" /> Abhaken
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
          className={`rounded-md border px-2.5 py-1 text-xs ${
            value === id
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-secondary"
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
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
  const labelCls = "font-mono text-[10px] uppercase tracking-widest text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Regeln greifen von oben nach unten: die Regel mit der höchsten Priorität, deren Stichwort
          passt, antwortet.
        </p>
        <button
          onClick={() => {
            setForm({ ...EMPTY_RULE });
            setPreview(null);
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3 w-3" /> Neue Regel
        </button>
      </div>

      {form && (
        <div className="space-y-4 rounded-xl border border-primary/40 bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className={labelCls}>Name</span>
              <input
                className={input}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="space-y-1">
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
            <label className="space-y-1">
              <span className={labelCls}>Brand</span>
              <select
                className={input}
                value={form.brandId ?? ""}
                onChange={(e) => setForm({ ...form, brandId: e.target.value || null })}
              >
                <option value="">Alle Brands</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
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
            <label className="space-y-1 sm:col-span-2">
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
            <label className="space-y-1">
              <span className={labelCls}>Stichwörter (Komma, leer = alle)</span>
              <input
                className={input}
                value={form.keywords}
                placeholder="preis, kaufen, link"
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              />
            </label>
            <label className="space-y-1">
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
            <label className="block space-y-1">
              <span className={labelCls}>
                Antworttext · Platzhalter {"{name} {brand} {kommentar}"}
              </span>
              <textarea
                rows={3}
                className={input}
                value={form.messageTemplate}
                onChange={(e) => setForm({ ...form, messageTemplate: e.target.value })}
              />
            </label>
          ) : (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className={labelCls}>Anweisung an die KI</span>
                <textarea
                  rows={3}
                  className={input}
                  placeholder="Bedanke dich, beantworte die Frage kurz und verweise bei Preisfragen auf den Link in der Bio."
                  value={form.aiInstruction}
                  onChange={(e) => setForm({ ...form, aiInstruction: e.target.value })}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className={labelCls}>Tonfall</span>
                  <input
                    className={input}
                    value={form.aiTone}
                    onChange={(e) => setForm({ ...form, aiTone: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className={labelCls}>Testkommentar</span>
                  <input
                    className={input}
                    value={sample}
                    onChange={(e) => setSample(e.target.value)}
                  />
                </label>
              </div>
              <button
                onClick={testAi}
                disabled={previewing}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
              >
                {previewing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Antwort testen
              </button>
              {preview && (
                <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
                  <div className={labelCls}>So würde die KI antworten</div>
                  <p className="mt-1 whitespace-pre-wrap">{preview}</p>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1">
              <span className={labelCls}>Max. Zeichen</span>
              <input
                type="number"
                className={input}
                value={form.maxLength}
                onChange={(e) => setForm({ ...form, maxLength: Number(e.target.value) })}
              />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Limit pro Tag</span>
              <input
                type="number"
                className={input}
                value={form.dailyLimit}
                onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })}
              />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Wartezeit (Min.)</span>
              <input
                type="number"
                className={input}
                value={form.delayMinutes}
                onChange={(e) => setForm({ ...form, delayMinutes: Number(e.target.value) })}
              />
            </label>
            <label className="space-y-1">
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
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Regel aktiv
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setForm(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"
              >
                Abbrechen
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {rules.length === 0 && !form ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Noch keine Regel. Ohne Regel bleibt jeder Kommentar im Posteingang liegen.
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                      r.mode === "ai"
                        ? "bg-accent/10 text-accent"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {r.mode === "ai" ? "KI" : "Vorlage"}
                  </span>
                  {!r.active && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                      pausiert
                    </span>
                  )}
                </div>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {r.platform ? (PLATFORM_LABEL[r.platform] ?? r.platform) : "Alle Plattformen"}
                  {" · "}
                  {r.brand_id
                    ? (brands.find((b) => b.id === r.brand_id)?.name ?? "Brand")
                    : "Alle Brands"}
                  {" · Priorität "}
                  {r.priority}
                  {" · max. "}
                  {r.daily_limit}
                  {"/Tag"}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {r.keywords.length ? `bei: ${r.keywords.join(", ")}` : "bei jedem Kommentar"}
                  {" — "}
                  {r.mode === "ai" ? r.ai_instruction : r.message_template}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => edit(r)}
                  className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-secondary"
                >
                  Bearbeiten
                </button>
                <button
                  onClick={() => remove(r.id)}
                  className="rounded-md border border-border px-2 py-1 text-destructive hover:bg-destructive/10"
                  title="Löschen"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
