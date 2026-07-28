import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wallet, Plus, Trash2, ExternalLink, Link2, TrendingUp, Check } from "lucide-react";
import {
  useEnsureWorkspace,
  useAffiliatePrograms,
  useEarnings,
  type AffiliateProgram,
} from "@/lib/use-workspace";
import { useBrands } from "@/lib/use-active-brand";
import { BrandAvatar } from "@/components/brand-avatar";

export const Route = createFileRoute("/_authenticated/app/profile")({
  head: () => ({
    meta: [
      { title: "Profil, Affiliate & Earnings — VideoCraft AI" },
      {
        name: "description",
        content:
          "Verwalte Profile, Affiliate-Programme, Auszahlungsdaten und alle Einnahmen deiner Brands an einem Ort.",
      },
      { property: "og:title", content: "Profil, Affiliate & Earnings — VideoCraft AI" },
      {
        property: "og:description",
        content: "Alle Brand-Einnahmen und Affiliate-Links eines Profils gebündelt.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfilePage,
});

const PAYOUT_PROVIDERS = ["PayPal", "Bank / SEPA", "Wise", "Revolut", "Stripe", "Crypto"];
const PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "x"];

function money(n: number, cur = "EUR") {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: cur }).format(n || 0);
}

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { activeWorkspace, activeWorkspaceId } = useEnsureWorkspace(user.id);
  const brandsQ = useBrands(user.id);
  const progsQ = useAffiliatePrograms(activeWorkspaceId);
  const earnQ = useEarnings(activeWorkspaceId);

  const brands = brandsQ.data ?? [];
  const programs = progsQ.data ?? [];
  const earnings = earnQ.data ?? [];

  const totals = useMemo(() => {
    const total = earnings.reduce((s, e) => s + Number(e.amount), 0);
    const paid = earnings
      .filter((e) => e.status === "paid")
      .reduce((s, e) => s + Number(e.amount), 0);
    const byPlatform = new Map<string, number>();
    const byBrand = new Map<string, number>();
    for (const e of earnings) {
      byPlatform.set(e.platform ?? "—", (byPlatform.get(e.platform ?? "—") ?? 0) + Number(e.amount));
      if (e.brand_id) byBrand.set(e.brand_id, (byBrand.get(e.brand_id) ?? 0) + Number(e.amount));
    }
    return { total, paid, open: total - paid, byPlatform, byBrand };
  }, [earnings]);

  // ---- Profil bearbeiten ----
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [profileTouched, setProfileTouched] = useState(false);
  if (activeWorkspace && !profileTouched && name === "") {
    // Initialwerte einmalig übernehmen
    if (activeWorkspace.name) {
      setName(activeWorkspace.name);
      setProvider(activeWorkspace.payout_provider ?? "");
      setPayoutAccount(String((activeWorkspace.payout_details as never)?.["account"] ?? ""));
      setProfileTouched(true);
    }
  }

  async function saveProfile() {
    if (!activeWorkspaceId) return;
    const { error } = await supabase
      .from("workspaces")
      .update({
        name: name.trim() || "Profil",
        payout_provider: provider || null,
        payout_details: { account: payoutAccount },
      } as never)
      .eq("id", activeWorkspaceId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["workspaces"] });
    toast.success("Profil gespeichert");
  }

  // ---- Affiliate ----
  const [aff, setAff] = useState({ name: "", link: "", payout_type: "cpm", payout_amount: "" });
  async function addProgram() {
    if (!activeWorkspaceId || !aff.name.trim() || !aff.link.trim())
      return toast.error("Name und Link nötig");
    const { error } = await supabase.from("affiliate_programs").insert({
      user_id: user.id,
      workspace_id: activeWorkspaceId,
      name: aff.name.trim(),
      link: aff.link.trim(),
      payout_type: aff.payout_type,
      payout_amount: Number(aff.payout_amount) || 0,
    } as never);
    if (error) return toast.error(error.message);
    setAff({ name: "", link: "", payout_type: "cpm", payout_amount: "" });
    qc.invalidateQueries({ queryKey: ["affiliate_programs", activeWorkspaceId] });
    toast.success("Affiliate-Programm gespeichert");
  }
  async function removeProgram(p: AffiliateProgram) {
    await supabase.from("affiliate_programs").delete().eq("id", p.id);
    qc.invalidateQueries({ queryKey: ["affiliate_programs", activeWorkspaceId] });
  }

  // ---- Earnings ----
  const [ent, setEnt] = useState({
    brand_id: "",
    platform: "",
    source: "platform",
    amount: "",
    views: "",
    program: "",
  });
  async function addEarning() {
    if (!activeWorkspaceId || !ent.amount) return toast.error("Betrag fehlt");
    const { error } = await supabase.from("earnings").insert({
      user_id: user.id,
      workspace_id: activeWorkspaceId,
      brand_id: ent.brand_id || null,
      affiliate_program_id: ent.program || null,
      platform: ent.platform || null,
      source: ent.source,
      amount: Number(ent.amount) || 0,
      views: Number(ent.views) || 0,
    } as never);
    if (error) return toast.error(error.message);
    setEnt({ brand_id: "", platform: "", source: "platform", amount: "", views: "", program: "" });
    qc.invalidateQueries({ queryKey: ["earnings", activeWorkspaceId] });
    toast.success("Einnahme erfasst");
  }
  async function togglePaid(id: string, status: string) {
    await supabase
      .from("earnings")
      .update({ status: status === "paid" ? "pending" : "paid" } as never)
      .eq("id", id);
    qc.invalidateQueries({ queryKey: ["earnings", activeWorkspaceId] });
  }

  /** Berechnet Affiliate-Einnahmen aus Views der Brand-Snapshots (CPM). */
  async function calcFromViews() {
    if (!activeWorkspaceId) return;
    const cpmProgram = programs.find((p) => p.payout_type === "cpm" && p.active);
    if (!cpmProgram) return toast.error("Kein aktives CPM-Programm hinterlegt");
    const { data } = await supabase
      .from("analytics_snapshots")
      .select("brand_id,platform,metrics")
      .in("brand_id", brands.map((b) => b.id).length ? brands.map((b) => b.id) : ["-"]);
    const per = new Map<string, { views: number; platform: string }>();
    for (const s of (data ?? []) as { brand_id: string; platform: string; metrics: never }[]) {
      const v = Number((s.metrics as Record<string, unknown>)?.["views"] ?? 0);
      const key = `${s.brand_id}|${s.platform}`;
      const cur = per.get(key);
      if (!cur || v > cur.views) per.set(key, { views: v, platform: s.platform });
    }
    if (per.size === 0) return toast.error("Noch keine Views-Daten vorhanden");
    const rows = [...per.entries()].map(([key, val]) => ({
      user_id: user.id,
      workspace_id: activeWorkspaceId,
      brand_id: key.split("|")[0],
      affiliate_program_id: cpmProgram.id,
      platform: val.platform,
      source: "affiliate",
      views: val.views,
      amount: (val.views / 1000) * Number(cpmProgram.payout_amount),
      note: `Automatisch aus Views · ${cpmProgram.name}`,
    }));
    const { error } = await supabase.from("earnings").insert(rows as never);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["earnings", activeWorkspaceId] });
    toast.success(`${rows.length} Einnahmen berechnet`);
  }

  const input =
    "w-full rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Profil, Affiliate & Earnings</h1>
          <p className="text-xs text-muted-foreground">
            Alles rund um „{activeWorkspace?.name ?? "Profil"}" — {brands.length} Brands
          </p>
        </div>
      </header>

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Gesamt-Earnings", value: money(totals.total), icon: TrendingUp },
          { label: "Ausgezahlt", value: money(totals.paid), icon: Check },
          { label: "Offen", value: money(totals.open), icon: Wallet },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <k.icon className="h-3.5 w-3.5" /> {k.label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Profil-Einstellungen */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Profil & Auszahlung</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Profilname</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Auszahlungs-Anbieter</span>
            <select
              className={input}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="">— wählen —</option>
              {PAYOUT_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Konto / E-Mail / IBAN</span>
            <input
              className={input}
              value={payoutAccount}
              onChange={(e) => setPayoutAccount(e.target.value)}
              placeholder="z. B. pay@brand.de"
            />
          </label>
        </div>
        <button
          onClick={saveProfile}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Speichern
        </button>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Hinweis: TikTok, YouTube und Meta zahlen Creator-Einnahmen direkt auf dein eigenes Konto
          aus — dafür gibt es keine öffentliche Auszahlungs-API. Hier werden alle Beträge gebündelt
          angezeigt und verwaltet; die eigentliche Auszahlung löst du beim jeweiligen Anbieter aus.
        </p>
      </section>

      {/* Affiliate-Programme */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold">Affiliate-Programme</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Der Link wird beim Posten automatisch an die Caption gehängt (im Publishing pro Clip
          wählbar).
        </p>

        <div className="grid gap-2 md:grid-cols-5">
          <input
            className={input}
            placeholder="Name (z. B. Clipper XY)"
            value={aff.name}
            onChange={(e) => setAff({ ...aff, name: e.target.value })}
          />
          <input
            className={`${input} md:col-span-2`}
            placeholder="https://link…"
            value={aff.link}
            onChange={(e) => setAff({ ...aff, link: e.target.value })}
          />
          <select
            className={input}
            value={aff.payout_type}
            onChange={(e) => setAff({ ...aff, payout_type: e.target.value })}
          >
            <option value="cpm">pro 1.000 Views</option>
            <option value="sale">pro Verkauf</option>
            <option value="fixed">Fixbetrag</option>
          </select>
          <div className="flex gap-2">
            <input
              className={input}
              placeholder="€"
              value={aff.payout_amount}
              onChange={(e) => setAff({ ...aff, payout_amount: e.target.value })}
            />
            <button
              onClick={addProgram}
              className="shrink-0 rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90"
              title="Hinzufügen"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {programs.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm"
            >
              <Link2 className="h-4 w-4 shrink-0 text-primary" />
              <span className="font-medium">{p.name}</span>
              <a
                href={p.link}
                target="_blank"
                rel="noreferrer"
                className="truncate text-xs text-muted-foreground hover:text-primary"
              >
                {p.link}
              </a>
              <span className="ml-auto shrink-0 rounded bg-secondary px-2 py-0.5 text-[11px]">
                {p.payout_type === "cpm"
                  ? `${money(Number(p.payout_amount))} / 1k Views`
                  : p.payout_type === "sale"
                    ? `${money(Number(p.payout_amount))} / Sale`
                    : money(Number(p.payout_amount))}
              </span>
              <button
                onClick={() => removeProgram(p)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {programs.length === 0 && (
            <p className="text-xs text-muted-foreground">Noch keine Programme hinterlegt.</p>
          )}
        </div>
      </section>

      {/* Earnings */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Einnahmen</h2>
          <button
            onClick={calcFromViews}
            className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
          >
            Aus Views berechnen (CPM)
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-6">
          <select
            className={input}
            value={ent.brand_id}
            onChange={(e) => setEnt({ ...ent, brand_id: e.target.value })}
          >
            <option value="">Brand …</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            className={input}
            value={ent.platform}
            onChange={(e) => setEnt({ ...ent, platform: e.target.value })}
          >
            <option value="">Plattform …</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            className={input}
            value={ent.source}
            onChange={(e) => setEnt({ ...ent, source: e.target.value })}
          >
            <option value="platform">Plattform-Auszahlung</option>
            <option value="affiliate">Affiliate</option>
            <option value="brandDeal">Brand-Deal</option>
          </select>
          <select
            className={input}
            value={ent.program}
            onChange={(e) => setEnt({ ...ent, program: e.target.value })}
          >
            <option value="">Programm …</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            className={input}
            placeholder="Views"
            value={ent.views}
            onChange={(e) => setEnt({ ...ent, views: e.target.value })}
          />
          <div className="flex gap-2">
            <input
              className={input}
              placeholder="Betrag €"
              value={ent.amount}
              onChange={(e) => setEnt({ ...ent, amount: e.target.value })}
            />
            <button
              onClick={addEarning}
              className="shrink-0 rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2">Brand</th>
                <th>Plattform</th>
                <th>Quelle</th>
                <th className="text-right">Views</th>
                <th className="text-right">Betrag</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {earnings.map((e) => {
                const b = brands.find((x) => x.id === e.brand_id);
                return (
                  <tr key={e.id}>
                    <td className="py-2">{b?.name ?? "—"}</td>
                    <td className="text-muted-foreground">{e.platform ?? "—"}</td>
                    <td className="text-muted-foreground">{e.source}</td>
                    <td className="text-right tabular-nums">{e.views.toLocaleString("de-DE")}</td>
                    <td className="text-right tabular-nums">
                      {money(Number(e.amount), e.currency)}
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => togglePaid(e.id, e.status)}
                        className={`rounded px-2 py-0.5 text-[11px] ${e.status === "paid" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}
                      >
                        {e.status === "paid" ? "ausgezahlt" : "offen"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {earnings.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-xs text-muted-foreground">
                    Noch keine Einnahmen erfasst.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Brands des Profils */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Brands in diesem Profil</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <Link
              key={b.id}
              to="/app/brand/$id"
              params={{ id: b.id }}
              className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3 hover:border-primary"
            >
              <BrandAvatar brand={b} className="h-8 w-8 rounded-lg text-xs" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{b.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {money(totals.byBrand.get(b.id) ?? 0)}
                </div>
              </div>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          ))}
          {brands.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Noch keine Brands in diesem Profil — links in der Seitenleiste anlegen.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
