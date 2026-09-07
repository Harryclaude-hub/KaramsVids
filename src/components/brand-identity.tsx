import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AtSign, CheckCircle2, Circle, Copy, ExternalLink, Eye, HelpCircle, KeyRound, Loader2, Search, Wand2, XCircle } from "lucide-react";

const PLATFORMS = [
  { id: "instagram", name: "Instagram" },
  { id: "tiktok", name: "TikTok" },
  { id: "youtube", name: "YouTube" },
  { id: "facebook", name: "Facebook" },
  { id: "x", name: "X (Twitter)" },
] as const;

type Check = { platform: string; url: string; state: "free" | "taken" | "unknown"; signupUrl: string };

export function BrandIdentity({ brandId, brandName }: { brandId: string; brandName: string }) {
  const qc = useQueryClient();
  const [handle, setHandle] = useState("");
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<Check[] | null>(null);

  const credsQ = useQuery({
    queryKey: ["brand_credentials", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_credentials")
        .select("*")
        .eq("brand_id", brandId);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function check() {
    const h = handle.trim() || brandName;
    if (!h) return;
    setChecking(true);
    try {
      const { checkBrandHandle } = await import("@/lib/brand-identity.functions");
      const res = await checkBrandHandle({
        data: { handle: h, platforms: PLATFORMS.map((p) => p.id) as never },
      });
      setHandle(res.handle);
      setResults(res.results as Check[]);
      await supabase.from("brands").update({ handle: res.handle } as never).eq("id", brandId);
      qc.invalidateQueries({ queryKey: ["brand", brandId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Prüfung fehlgeschlagen");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="space-y-5 rounded-[18px] border border-border bg-card p-6">
      <div>
        <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
          <AtSign className="h-4 w-4 text-muted-foreground" /> Identität & Kanäle
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Prüfe, ob dein Wunsch-Username auf allen Plattformen frei ist, lege die Accounts über die
          Direkt-Links an und hinterlege die Zugangsdaten hier verschlüsselt. Danach kommst du mit
          einem Klick in den jeweiligen Account.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-11 items-center gap-1 rounded-[11px] border border-border bg-input px-4 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/60">
          <span className="text-[15px] text-muted-foreground">@</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
            placeholder={brandName.toLowerCase().replace(/[^a-z0-9._-]/g, "")}
            className="w-48 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          onClick={check}
          disabled={checking}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Verfügbarkeit prüfen
        </button>
      </div>

      {results && (
        <div className="grid gap-2 sm:grid-cols-2">
          {results.map((r) => {
            const meta = PLATFORMS.find((p) => p.id === r.platform)!;
            return (
              <div key={r.platform} className="flex items-center justify-between gap-2 rounded-[14px] border border-border bg-background px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{meta.name}</div>
                  <div className="truncate text-[13px] text-muted-foreground">@{handle}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.state === "free" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[12px] font-semibold text-success"><CheckCircle2 className="h-3 w-3" /> frei</span>
                  )}
                  {r.state === "taken" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 text-[12px] font-semibold text-destructive"><XCircle className="h-3 w-3" /> vergeben</span>
                  )}
                  {r.state === "unknown" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground" title="Plattform blockt die automatische Prüfung, bitte manuell im Link prüfen">
                      <HelpCircle className="h-3 w-3" /> unklar
                    </span>
                  )}
                  <a href={r.state === "taken" ? r.url : r.signupUrl} target="_blank" rel="noreferrer"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
                    {r.state === "taken" ? "Ansehen" : "Anlegen"} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
          <p className="sm:col-span-2 text-[13px] leading-relaxed text-muted-foreground">
            Hinweis: Instagram, TikTok, YouTube & Co. erlauben per API <b>keine</b> automatische
            Account-Erstellung (Anti-Spam-Regel). Über die Links legst du den Account in etwa einer
            Minute an. Die Verbindung, das Posten und die Analysen laufen danach komplett automatisch.
          </p>
        </div>
      )}

      <SetupWizard
        brandId={brandId}
        brandName={brandName}
        creds={credsQ.data ?? []}
        onChanged={() => qc.invalidateQueries({ queryKey: ["brand_credentials", brandId] })}
      />

      <div className="space-y-3 border-t border-border pt-5">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
          <KeyRound className="h-4 w-4" /> Zugangsdaten (verschlüsselt gespeichert)
        </div>
        <div className="grid gap-2">
          {PLATFORMS.map((p) => (
            <CredentialRow
              key={p.id}
              brandId={brandId}
              platform={p.id}
              label={p.name}
              row={(credsQ.data ?? []).find((c: any) => c.platform === p.id) ?? null}
              onSaved={() => qc.invalidateQueries({ queryKey: ["brand_credentials", brandId] })}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------
// Setup-Assistent: fuehrt Schritt fuer Schritt durch die Account-Anlage
// (Plattformen erlauben keine API-Registrierung, deshalb wird hier alles
// vorbereitet, kopierbar gemacht und der Fortschritt getrackt).
// ---------------------------------------------------------------

type Suggestion = { handle: string; results: Check[]; free: number; taken: number };

function SetupWizard({
  brandId, brandName, creds, onChanged,
}: {
  brandId: string; brandName: string; creds: any[]; onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    try {
      const { suggestBrandSetup } = await import("@/lib/brand-identity.functions");
      const res = await suggestBrandSetup({ data: { name: brandName } });
      setSuggestions(res.suggestions as Suggestion[]);
      setChosen(res.suggestions[0]?.handle ?? "");
      setPassword(res.password);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assistent fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value).then(
      () => toast.success(`${label} kopiert`),
      () => toast.error("Kopieren nicht möglich"),
    );
  }

  async function mark(platform: string, status: "in_progress" | "done") {
    setBusy(platform);
    try {
      const { setCredentialSetupStatus, saveBrandCredential } = await import(
        "@/lib/brand-identity.functions"
      );
      if (status === "done" && chosen) {
        await saveBrandCredential({
          data: { brandId, platform: platform as never, username: chosen, password: password || null },
        });
      }
      await setCredentialSetupStatus({ data: { brandId, platform: platform as never, status } });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status konnte nicht gespeichert werden");
    } finally {
      setBusy(null);
    }
  }

  const done = PLATFORMS.filter(
    (p) => creds.find((c) => c.platform === p.id)?.setup_status === "done",
  ).length;

  return (
    <div className="space-y-4 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
          <Wand2 className="h-4 w-4" /> Account-Setup-Assistent
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[12px] font-semibold text-foreground">
            {done}/{PLATFORMS.length} fertig
          </span>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Setup vorbereiten
        </button>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Plattformen erlauben keine Account-Erstellung per API (Captcha/SMS-Pflicht, Sperrgefahr).
        Der Assistent macht alles Übrige automatisch: freie Handle-Varianten finden, Passwort
        erzeugen, Daten kopierfertig bereitstellen, Registrierung öffnen und den Fortschritt je
        Plattform tracken. Danach genügt „Verbinden“ per OAuth.
      </p>

      {suggestions && (
        <div className="space-y-3">
          <div className="grid gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.handle}
                onClick={() => setChosen(s.handle)}
                className={`flex items-center justify-between gap-2 rounded-[14px] border px-4 py-3 text-left transition-colors ${
                  chosen === s.handle ? "border-primary bg-card" : "border-border bg-background hover:bg-secondary/60"
                }`}
              >
                <span className="text-[15px] font-semibold">@{s.handle}</span>
                <span className="flex items-center gap-2 text-[13px]">
                  <span className="font-semibold text-success">{s.free} frei</span>
                  <span className="font-semibold text-destructive">{s.taken} vergeben</span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-background px-4 py-3">
            <span className="text-[13px] text-muted-foreground">Passwort</span>
            <code className="font-mono text-[13px]">{password}</code>
            <button onClick={() => copy(password, "Passwort")}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
              <Copy className="h-3.5 w-3.5" /> Kopieren
            </button>
            <button onClick={() => copy(chosen, "Username")}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
              <Copy className="h-3.5 w-3.5" /> Username
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {PLATFORMS.map((p) => {
              const cred = creds.find((c) => c.platform === p.id);
              const status = cred?.setup_status ?? "todo";
              const check = suggestions.find((s) => s.handle === chosen)?.results.find((r) => r.platform === p.id);
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-[14px] border border-border bg-background px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[15px] font-semibold">
                      {status === "done" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                      {p.name}
                    </div>
                    <div className="truncate text-[13px] text-muted-foreground">
                      @{chosen} · {check?.state === "free" ? "frei" : check?.state === "taken" ? "vergeben" : "unklar"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={check?.signupUrl || "#"}
                      target="_blank" rel="noreferrer"
                      onClick={() => mark(p.id, "in_progress")}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"
                    >
                      Anlegen <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => mark(p.id, "done")}
                      disabled={busy === p.id}
                      className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
                    >
                      {busy === p.id ? "…" : "Fertig"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


function CredentialRow({
  brandId, platform, label, row, onSaved,
}: {
  brandId: string; platform: string; label: string;
  row: any | null; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(row?.username ?? "");
  const [email, setEmail] = useState(row?.email ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    try {
      const { saveBrandCredential } = await import("@/lib/brand-identity.functions");
      await saveBrandCredential({
        data: { brandId, platform: platform as never, username, email, password: password || null },
      });
      setPassword("");
      toast.success(`${label}-Zugang gespeichert`);
      onSaved();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function reveal() {
    try {
      const { revealBrandCredential } = await import("@/lib/brand-identity.functions");
      const { password: pw } = await revealBrandCredential({ data: { credentialId: row.id } });
      setRevealed(pw ?? "kein Passwort hinterlegt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler");
    }
  }

  return (
    <div className="rounded-[14px] border border-border bg-background px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">{label}</div>
          <div className="truncate text-[13px] text-muted-foreground">
            {row?.username ? `@${row.username}` : "kein Zugang hinterlegt"}
            {row?.password_encrypted ? " · Passwort ✓" : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {row?.login_url && (
            <a href={row.login_url} target="_blank" rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
              Login <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {row?.password_encrypted && (
            <button onClick={reveal} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
              <Eye className="h-3.5 w-3.5" /> Zeigen
            </button>
          )}
          <button onClick={() => setOpen((v) => !v)} className="inline-flex h-9 items-center justify-center rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
            {open ? "Schließen" : row ? "Bearbeiten" : "Hinzufügen"}
          </button>
        </div>
      </div>
      {revealed && <div className="mt-3 rounded-[9px] bg-secondary px-3 py-2 font-mono text-[13px]">{revealed}</div>}
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username"
            className="h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail"
            className="h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />
          <div className="flex gap-2">
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Passwort"
              className="h-11 min-w-0 flex-1 rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />
            <button onClick={save} disabled={saving}
              className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]">
              {saving ? "…" : "OK"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
