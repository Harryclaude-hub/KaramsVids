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
      { title: "Projekt, Affiliate & Einnahmen · KaramsVids" },
      {
        name: "description",
        content:
          "Verwalte Projekte, Affiliate-Programme, Auszahlungsdaten und alle Einnahmen deiner Profile an einem Ort.",
      },
      { property: "og:title", content: "Projekt, Affiliate & Einnahmen · KaramsVids" },
      {
        property: "og:description",
        content: "Alle Profil-Einnahmen und Affiliate-Links eines Projekts gebündelt.",
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
      byPlatform.set(e.platform ?? "–", (byPlatform.get(e.platform ?? "–") ?? 0) + Number(e.amount));
      if (e.brand_id) byBrand.set(e.brand_id, (byBrand.get(e.brand_id) ?? 0) + Number(e.amount));
    }
    return { total, paid, open: total - paid, byPlatform, byBrand };
  }, [earnings]);

  // ---- Projekt bearbeiten ----
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
        name: name.trim() || "Projekt",
        payout_provider: provider || null,
        payout_details: { account: payoutAccount },
      } as never)
      .eq("id", activeWorkspaceId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["workspaces"] });
    toast.success("Projekt gespeichert");
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

  // ---- Einnahmen ----
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

  /** Berechnet Affiliate-Einnahmen aus Views der Profil-Snapshots (CPM). */
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
    "h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60";

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-primary">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">Projekt, Affiliate & Einnahmen</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Alles rund um „{activeWorkspace?.name ?? "Projekt"}“ · {brands.length} Profile
          </p>
        </div>
      </header>

      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Gesamt-Einnahmen", value: money(totals.total), icon: TrendingUp },
          { label: "Ausgezahlt", value: money(totals.paid), icon: Check },
          { label: "Offen", value: money(totals.open), icon: Wallet },
        ].map((k) => (
          <div key={k.label} className="rounded-[18px] border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
              <k.icon className="h-4 w-4" /> {k.label}
            </div>
            <div className="mt-2 text-[28px] font-semibold tracking-tight tabular-nums">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Projekt-Einstellungen */}
      <section className="rounded-[18px] border border-border bg-card p-6">
        <h2 className="mb-4 text-[17px] font-semibold tracking-tight">Projekt & Auszahlung</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block space-y-1.5">
            <span className="block text-[13px] font-semibold text-foreground">Projektname</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-[13px] font-semibold text-foreground">Auszahlungs-Anbieter</span>
            <select
              className={input}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="">Bitte wählen</option>
              {PAYOUT_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="block text-[13px] font-semibold text-foreground">Konto / E-Mail / IBAN</span>
            <input
              className={input}
              value={payoutAccount}
              onChange={(e) => setPayoutAccount(e.target.value)}
              placeholder="z. B. pay@beispiel.de"
            />
          </label>
        </div>
        <button
          onClick={saveProfile}
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
        >
          Speichern
        </button>
        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          Hinweis: TikTok, YouTube und Meta zahlen Creator-Einnahmen direkt auf dein eigenes Konto
          aus. Dafür gibt es keine öffentliche Auszahlungs-API. Hier werden alle Beträge gebündelt
          angezeigt und verwaltet; die eigentliche Auszahlung löst du beim jeweiligen Anbieter aus.
        </p>
      </section>

      {/* Affiliate-Programme */}
      <section className="rounded-[18px] border border-border bg-card p-6">
        <h2 className="mb-1 text-[17px] font-semibold tracking-tight">Affiliate-Programme</h2>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Der Link wird beim Posten automatisch an die Caption gehängt (im Publishing pro Clip
          wählbar).
        </p>

        <div className="grid gap-3 md:grid-cols-5">
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
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]"
              title="Hinzufügen"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {programs.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-[11px] border border-border bg-background px-4 py-3 text-[15px]"
            >
              <Link2 className="h-4 w-4 shrink-0 text-primary" />
              <span className="font-semibold">{p.name}</span>
              <a
                href={p.link}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[13px] text-muted-foreground hover:text-accent hover:underline"
              >
                {p.link}
              </a>
              <span className="ml-auto shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-[12px] font-semibold text-foreground tabular-nums">
                {p.payout_type === "cpm"
                  ? `${money(Number(p.payout_amount))} / 1k Views`
                  : p.payout_type === "sale"
                    ? `${money(Number(p.payout_amount))} / Sale`
                    : money(Number(p.payout_amount))}
              </span>
              <button
                onClick={() => removeProgram(p)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {programs.length === 0 && (
            <p className="text-[13px] text-muted-foreground">Noch keine Programme hinterlegt.</p>
          )}
        </div>
      </section>

      {/* Einnahmen */}
      <section className="rounded-[18px] border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-[17px] font-semibold tracking-tight">Einnahmen</h2>
          <button
            onClick={calcFromViews}
            className="ml-auto inline-flex h-9 items-center rounded-full bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"
          >
            Aus Views berechnen (CPM)
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-6">
          <select
            className={input}
            value={ent.brand_id}
            onChange={(e) => setEnt({ ...ent, brand_id: e.target.value })}
          >
            <option value="">Profil …</option>
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
            <option value="brandDeal">Sponsoring-Deal</option>
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
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="border-b border-border text-left text-[13px] font-semibold text-muted-foreground">
              <tr>
                <th className="h-11 px-3 font-semibold">Profil</th>
                <th className="h-11 px-3 font-semibold">Plattform</th>
                <th className="h-11 px-3 font-semibold">Quelle</th>
                <th className="h-11 px-3 text-right font-semibold">Views</th>
                <th className="h-11 px-3 text-right font-semibold">Betrag</th>
                <th className="h-11 px-3 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {earnings.map((e) => {
                const b = brands.find((x) => x.id === e.brand_id);
                return (
                  <tr key={e.id} className="transition-colors hover:bg-secondary/40">
                    <td className="px-3 py-3">{b?.name ?? "–"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{e.platform ?? "–"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{e.source}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{e.views.toLocaleString("de-DE")}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {money(Number(e.amount), e.currency)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => togglePaid(e.id, e.status)}
                        className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${e.status === "paid" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                      >
                        {e.status === "paid" ? "ausgezahlt" : "offen"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {earnings.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-[13px] text-muted-foreground">
                    Noch keine Einnahmen erfasst.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Profile des Projekts */}
      <section className="rounded-[18px] border border-border bg-card p-6">
        <h2 className="mb-4 text-[17px] font-semibold tracking-tight">Profile in diesem Projekt</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <Link
              key={b.id}
              to="/app/brand/$id"
              params={{ id: b.id }}
              className="flex items-center gap-3 rounded-[11px] border border-border bg-background p-3 transition-colors hover:bg-secondary/60"
            >
              <BrandAvatar brand={b} className="h-9 w-9 rounded-[10px] text-[12px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{b.name}</div>
                <div className="text-[13px] text-muted-foreground tabular-nums">
                  {money(totals.byBrand.get(b.id) ?? 0)}
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
          {brands.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              Noch keine Profile in diesem Projekt. Links in der Seitenleiste anlegen.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
