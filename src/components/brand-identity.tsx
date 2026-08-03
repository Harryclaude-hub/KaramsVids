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
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <AtSign className="h-4 w-4 text-primary" /> Identität & Accounts
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Prüfe, ob dein Wunsch-Username auf allen Plattformen frei ist, lege die Accounts über die
          Direkt-Links an und hinterlege die Zugangsdaten hier verschlüsselt — danach kommst du mit
          einem Klick in den jeweiligen Account.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-input px-2 py-1.5">
          <span className="font-mono text-xs text-muted-foreground">@</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
            placeholder={brandName.toLowerCase().replace(/[^a-z0-9._-]/g, "")}
            className="w-48 bg-transparent text-sm outline-none"
          />
        </div>
        <button
          onClick={check}
          disabled={checking}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Verfügbarkeit prüfen
        </button>
      </div>

      {results && (
        <div className="grid gap-2 sm:grid-cols-2">
          {results.map((r) => {
            const meta = PLATFORMS.find((p) => p.id === r.platform)!;
            return (
              <div key={r.platform} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium">{meta.name}</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">@{handle}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.state === "free" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-primary"><CheckCircle2 className="h-3 w-3" /> frei</span>
                  )}
                  {r.state === "taken" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-destructive"><XCircle className="h-3 w-3" /> vergeben</span>
                  )}
                  {r.state === "unknown" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Plattform blockt die automatische Prüfung — bitte manuell im Link prüfen">
                      <HelpCircle className="h-3 w-3" /> unklar
                    </span>
                  )}
                  <a href={r.state === "taken" ? r.url : r.signupUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-card">
                    {r.state === "taken" ? "Ansehen" : "Anlegen"} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            );
          })}
          <p className="sm:col-span-2 text-[10px] leading-relaxed text-muted-foreground">
            Hinweis: Instagram, TikTok, YouTube & Co. erlauben per API <b>keine</b> automatische
            Account-Erstellung (Anti-Spam-Regel). Über die Links legst du den Account in ~1 Minute
            an — die Verbindung, das Posten und die Analysen laufen danach komplett automatisch.
          </p>
        </div>
      )}

      <SetupWizard
        brandId={brandId}
        brandName={brandName}
        creds={credsQ.data ?? []}
        onChanged={() => qc.invalidateQueries({ queryKey: ["brand_credentials", brandId] })}
      />

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-xs font-medium">
          <KeyRound className="h-3.5 w-3.5 text-accent" /> Zugangsdaten (verschlüsselt gespeichert)
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
// Setup-Assistent: führt Schritt für Schritt durch die Account-Anlage
// (Plattformen erlauben keine API-Registrierung — hier wird alles
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
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Wand2 className="h-3.5 w-3.5 text-primary" /> Account-Setup-Assistent
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
            {done}/{PLATFORMS.length} fertig
          </span>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          Setup vorbereiten
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Plattformen erlauben keine Account-Erstellung per API (Captcha/SMS-Pflicht, Sperrgefahr).
        Der Assistent macht alles Übrige automatisch: freie Handle-Varianten finden, Passwort
        erzeugen, Daten kopierfertig bereitstellen, Registrierung öffnen und den Fortschritt je
        Plattform tracken. Danach genügt „Verbinden" per OAuth.
      </p>

      {suggestions && (
        <div className="space-y-3">
          <div className="grid gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.handle}
                onClick={() => setChosen(s.handle)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left ${
                  chosen === s.handle ? "border-primary bg-primary/5" : "border-border bg-background/50"
                }`}
              >
                <span className="font-mono text-xs">@{s.handle}</span>
                <span className="flex items-center gap-2 text-[10px]">
                  <span className="text-primary">{s.free} frei</span>
                  <span className="text-destructive">{s.taken} vergeben</span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2">
            <span className="text-[10px] text-muted-foreground">Passwort</span>
            <code className="font-mono text-[11px]">{password}</code>
            <button onClick={() => copy(password, "Passwort")}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-card">
              <Copy className="h-3 w-3" /> Kopieren
            </button>
            <button onClick={() => copy(chosen, "Username")}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-card">
              <Copy className="h-3 w-3" /> Username
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {PLATFORMS.map((p) => {
              const cred = creds.find((c) => c.platform === p.id);
              const status = cred?.setup_status ?? "todo";
              const check = suggestions.find((s) => s.handle === chosen)?.results.find((r) => r.platform === p.id);
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                      {status === "done" ? <CheckCircle2 className="h-3 w-3 text-primary" /> : <Circle className="h-3 w-3 text-muted-foreground" />}
                      {p.name}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      @{chosen} · {check?.state === "free" ? "frei" : check?.state === "taken" ? "vergeben" : "unklar"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <a
                      href={check?.signupUrl || "#"}
                      target="_blank" rel="noreferrer"
                      onClick={() => mark(p.id, "in_progress")}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-card"
                    >
                      Anlegen <ExternalLink className="h-3 w-3" />
                    </a>
                    <button
                      onClick={() => mark(p.id, "done")}
                      disabled={busy === p.id}
                      className="rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground disabled:opacity-60"
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
      setRevealed(pw ?? "— kein Passwort hinterlegt —");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">{label}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {row?.username ? `@${row.username}` : "— kein Zugang hinterlegt —"}
            {row?.password_encrypted ? " · Passwort ✓" : ""}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {row?.login_url && (
            <a href={row.login_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-card">
              Login <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {row?.password_encrypted && (
            <button onClick={reveal} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-card">
              <Eye className="h-3 w-3" /> Zeigen
            </button>
          )}
          <button onClick={() => setOpen((v) => !v)} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-card">
            {open ? "Schließen" : row ? "Bearbeiten" : "Hinzufügen"}
          </button>
        </div>
      </div>
      {revealed && <div className="mt-2 rounded bg-secondary px-2 py-1 font-mono text-[11px]">{revealed}</div>}
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username"
            className="rounded-md border border-border bg-input px-2 py-1.5 text-xs outline-none focus:border-primary" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail"
            className="rounded-md border border-border bg-input px-2 py-1.5 text-xs outline-none focus:border-primary" />
          <div className="flex gap-1">
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Passwort"
              className="min-w-0 flex-1 rounded-md border border-border bg-input px-2 py-1.5 text-xs outline-none focus:border-primary" />
            <button onClick={save} disabled={saving}
              className="rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-60">
              {saving ? "…" : "OK"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
