import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Scissors, LayoutGrid, Upload, Share2, LogOut, Plus, Folder, Check, CalendarClock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useBrands, useActiveBrandId, useCreateBrand } from "@/lib/use-active-brand";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AppShell,
});

function AppShell() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const brandsQ = useBrands(user.id);
  const [activeBrandId, setActiveBrandId] = useActiveBrandId();
  const createBrand = useCreateBrand(user.id);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const nav = [
    { to: "/app", label: "Dashboard", icon: LayoutGrid },
    { to: "/app/upload", label: "Upload", icon: Upload },
    { to: "/app/publishing", label: "Publishing", icon: CalendarClock },
    { to: "/app/connections", label: "Social", icon: Share2 },
  ];

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function submitNewBrand() {
    const name = newName.trim();
    if (!name) return;
    try {
      const b = await createBrand(name);
      setActiveBrandId(b.id);
      setNewName("");
      setCreating(false);
      toast.success(`Brand „${b.name}" erstellt`);
      navigate({ to: "/app/brand/$id", params: { id: b.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Konnte Brand nicht anlegen");
    }
  }

  const brands = brandsQ.data ?? [];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 flex-col border-r border-border bg-card/40 p-4 md:flex">
        <Link to="/app" className="mb-6 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Scissors className="h-4 w-4" />
          </div>
          <span className="font-semibold">VideoCraft <span className="text-primary">AI</span></span>
        </Link>

        <nav className="space-y-1">
          {nav.map((n) => {
            const active = pathname === n.to || (n.to !== "/app" && pathname.startsWith(n.to));
            return (
              <Link key={n.to} to={n.to} className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}>
                <n.icon className="h-4 w-4" />{n.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between px-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Brands</span>
            <button
              onClick={() => setCreating((v) => !v)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Neuer Brand"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={() => setActiveBrandId(null)}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs ${activeBrandId === null ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />
            <span className="flex-1">Alle</span>
            {activeBrandId === null && <Check className="h-3 w-3" />}
          </button>

          <div className="mt-1 max-h-64 space-y-0.5 overflow-y-auto">
            {brands.map((b) => {
              const isActive = activeBrandId === b.id;
              return (
                <div key={b.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => setActiveBrandId(b.id)}
                    className={`flex flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs ${isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}
                  >
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: b.color }} />
                    <span className="flex-1 truncate">{b.name}</span>
                    {isActive && <Check className="h-3 w-3" />}
                  </button>
                  <Link
                    to="/app/brand/$id"
                    params={{ id: b.id }}
                    className="rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                    title="Öffnen"
                  >
                    <Folder className="h-3 w-3" />
                  </Link>
                </div>
              );
            })}
            {brands.length === 0 && !creating && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">Noch keine Brands. Lege einen an, um Videos & Social-Accounts zu gruppieren.</p>
            )}
          </div>

          {creating && (
            <div className="mt-2 space-y-2 rounded-md border border-border bg-background/60 p-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitNewBrand(); if (e.key === "Escape") setCreating(false); }}
                placeholder="Brand-Name"
                className="w-full rounded border border-border bg-input px-2 py-1 text-xs outline-none focus:border-primary"
              />
              <div className="flex gap-1">
                <button onClick={submitNewBrand} className="flex-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">Anlegen</button>
                <button onClick={() => { setCreating(false); setNewName(""); }} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">×</button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-auto space-y-2 border-t border-border pt-4">
          <div className="truncate px-3 text-xs text-muted-foreground">{user.email}</div>
          <button onClick={signOut} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary">
            <LogOut className="h-4 w-4" /> Abmelden
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <Link to="/app" className="flex items-center gap-2 text-sm font-semibold"><Scissors className="h-4 w-4 text-primary" /> VideoCraft</Link>
          <button onClick={signOut} className="text-xs text-muted-foreground">Abmelden</button>
        </header>
        <main className="flex-1 overflow-y-auto p-6 md:p-10"><Outlet /></main>
      </div>
    </div>
  );
}
