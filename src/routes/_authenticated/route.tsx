import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  Scissors,
  Share2,
  LogOut,
  Plus,
  Folder,
  Check,
  CalendarClock,
  Wand2,
  Clapperboard,
  Users,
  Shield,
  Menu,
  X,
  PanelLeft,
  PanelLeftClose,
  Wallet,
  MessageSquare,
  BarChart3,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useBrands, useActiveBrandId, useCreateBrand } from "@/lib/use-active-brand";
import { useEnsureWorkspace, createWorkspace } from "@/lib/use-workspace";
import { BrandAvatar } from "@/components/brand-avatar";
import { toast } from "sonner";


const ADMIN_EMAIL = "saifokaram1@gmail.com";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Freigabe-Gate: ohne Admin-Genehmigung kein Zugang zur App.
    // Der Admin-Account selbst ist immer freigeschaltet.
    let isAdmin = data.user.email === ADMIN_EMAIL;
    if (!isAdmin) {
      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!profErr && profile) {
        const p = profile as { status?: string; role?: string };
        isAdmin = p.role === "admin";
        // Solange die Admin-Migration noch nicht lief, gibt es keine status-Spalte
        // (undefined), dann nicht aussperren. Danach gilt: nur 'approved' darf rein.
        if (!isAdmin && p.status !== undefined && p.status !== "approved") {
          throw redirect({ to: "/pending" });
        }
      }
    }
    return { user: data.user, isAdmin };
  },
  component: AppShell,
});

// Begriffe in der Oberflaeche: Konto -> Projekt (Tabelle workspaces) -> Profil (Tabelle brands) -> Kanal.
// Variablen- und Tabellennamen bleiben unveraendert, nur die Beschriftungen sind neu.
function AppShell() {
  const { user, isAdmin } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, activeWorkspace } =
    useEnsureWorkspace(user.id);
  const brandsQ = useBrands(user.id);
  const [activeBrandId, setActiveBrandId] = useActiveBrandId();
  const createBrand = useCreateBrand(user.id);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  // Seitenleiste ausblendbar, Einstellung wird gemerkt
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("vc:sidebar") !== "hidden";
  });
  function toggleSidebar() {
    setSidebarOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("vc:sidebar", next ? "shown" : "hidden");
      } catch {
        /* localStorage nicht verfuegbar */
      }
      return next;
    });
  }

  const nav: {
    to:
      | "/app"
      | "/app/clip"
      | "/app/templates"
      | "/app/generate"
      | "/app/avatars"
      | "/app/publishing"
      | "/app/connections"
      | "/app/comments"
      | "/app/tracking"
      | "/app/profile";
    label: string;
    icon: typeof Scissors;
  }[] = [
    { to: "/app", label: "Editor", icon: Scissors },
    { to: "/app/templates", label: "Vorlagen", icon: Wand2 },
    { to: "/app/clip", label: "Massen-Clipping", icon: Wand2 },
    { to: "/app/generate", label: "KI-Studio", icon: Clapperboard },
    { to: "/app/avatars", label: "Avatare", icon: Users },
    { to: "/app/publishing", label: "Publishing", icon: CalendarClock },
    { to: "/app/connections", label: "Kanäle", icon: Share2 },
    { to: "/app/comments", label: "Kommentare", icon: MessageSquare },
    { to: "/app/tracking", label: "Tracking", icon: BarChart3 },
    { to: "/app/profile", label: "Projekt & Einnahmen", icon: Wallet },
  ];

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function addWorkspace() {
    const name = window.prompt("Name des neuen Projekts?")?.trim();
    if (!name) return;
    try {
      const ws = await createWorkspace(user.id, name);
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setActiveWorkspaceId(ws.id);
      setActiveBrandId(null);
      toast.success(`Projekt „${ws.name}“ erstellt`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Konnte Projekt nicht anlegen");
    }
  }


  async function submitNewBrand() {
    const name = newName.trim();
    if (!name) return;
    try {
      const b = await createBrand(name);
      setActiveBrandId(b.id);
      setNewName("");
      setCreating(false);
      toast.success(`Profil „${b.name}“ erstellt`);
      navigate({ to: "/app/brand/$id", params: { id: b.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Konnte Profil nicht anlegen");
    }
  }

  const brands = brandsQ.data ?? [];
  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Seitenleiste: transluzent mit Weichzeichner, Hairline rechts */}
      <aside
        className={`${sidebarOpen ? "md:flex" : "md:hidden"} hidden w-64 flex-col border-r border-border bg-card/70 p-4 backdrop-blur-xl`}
      >
        <Link to="/app" className="mb-5 flex items-center gap-2.5 px-1">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-primary text-primary-foreground">
            <Scissors className="h-4 w-4" />
          </div>
          <span className="text-[17px] font-semibold tracking-tight">KaramsVids</span>
        </Link>

        {/* Projekt-Umschalter (Tabelle workspaces): Projekte sind komplett voneinander getrennt */}
        <div className="mb-5 rounded-[14px] border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-muted-foreground">Projekt</span>
            <button
              onClick={addWorkspace}
              className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Neues Projekt"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <select
            value={activeWorkspaceId ?? ""}
            onChange={(e) => {
              setActiveWorkspaceId(e.target.value || null);
              setActiveBrandId(null);
            }}
            className="h-9 w-full rounded-[9px] border border-border bg-input px-2.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/60"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <Link
            to="/app/profile"
            className="mt-2 block text-[13px] text-accent hover:underline"
          >
            Einnahmen & Affiliate verwalten
          </Link>
        </div>

        <nav className="space-y-0.5">
          {nav.map((n) => {
            const active = pathname === n.to || (n.to !== "/app" && pathname.startsWith(n.to));
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 rounded-[10px] px-3 py-2 text-[15px] ${active ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* Profil-Liste (Tabelle brands) */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between px-3">
            <span className="text-[13px] font-semibold text-muted-foreground">Profile</span>
            <button
              onClick={() => setCreating((v) => !v)}
              className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Neues Profil"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={() => setActiveBrandId(null)}
            className={`flex w-full items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-[13px] ${activeBrandId === null ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}
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
                    className={`flex flex-1 items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-[13px] ${isActive ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}
                  >
                    <BrandAvatar brand={b} className="h-4 w-4 shrink-0 rounded-full text-[8px]" />
                    <span className="flex-1 truncate">{b.name}</span>
                    {isActive && <Check className="h-3 w-3" />}
                  </button>
                  <Link
                    to="/app/brand/$id"
                    params={{ id: b.id }}
                    className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                    title="Öffnen"
                  >
                    <Folder className="h-3 w-3" />
                  </Link>
                </div>
              );
            })}
            {brands.length === 0 && !creating && (
              <p className="px-3 py-2 text-[13px] text-muted-foreground">
                Noch keine Profile. Lege eines an, um Videos und Kanäle zu gruppieren.
              </p>
            )}
          </div>

          {creating && (
            <div className="mt-2 space-y-2 rounded-[14px] border border-border bg-card p-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNewBrand();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Profilname"
                className="h-9 w-full rounded-[9px] border border-border bg-input px-2.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/60"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={submitNewBrand}
                  className="h-9 flex-1 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]"
                >
                  Anlegen
                </button>
                <button
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                  className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
                  title="Abbrechen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-auto space-y-1 border-t border-border pt-4">
          {isAdmin && (
            <Link
              to="/admin"
              className="flex items-center gap-3 rounded-[10px] px-3 py-2 text-[15px] text-accent hover:bg-secondary/60"
            >
              <Shield className="h-4 w-4" /> Admin-Portal
            </Link>
          )}
          <div className="truncate px-3 text-[13px] text-muted-foreground">{user.email}</div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-[15px] text-muted-foreground hover:bg-secondary/60"
          >
            <LogOut className="h-4 w-4" /> Abmelden
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Mobiler Kopfbereich */}
        <header className="flex items-center justify-between border-b border-border bg-card/70 px-4 py-3 backdrop-blur-xl md:hidden">
          <Link
            to="/app"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
          >
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-primary text-primary-foreground">
              <Scissors className="h-3.5 w-3.5" />
            </span>
            KaramsVids
          </Link>
          <button
            onClick={() => setMobileNav((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-secondary px-4 text-[13px] font-semibold text-foreground"
            aria-label="Menü"
          >
            {mobileNav ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />} Menü
          </button>
        </header>

        {/* Mobile-Navigation, inkl. Admin-Portal */}
        {mobileNav && (
          <nav className="space-y-0.5 border-b border-border bg-card px-3 py-3 md:hidden">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setMobileNav(false)}
                className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[15px] ${pathname === n.to ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            ))}
            {isAdmin && (
              <Link
                to="/admin"
                onClick={() => setMobileNav(false)}
                className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[15px] text-accent"
              >
                <Shield className="h-4 w-4" /> Admin-Portal
              </Link>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <span className="truncate px-3 text-[13px] text-muted-foreground">{user.email}</span>
              <button
                onClick={signOut}
                className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[15px] text-muted-foreground"
              >
                <LogOut className="h-4 w-4" /> Abmelden
              </button>
            </div>
          </nav>
        )}
        {/* Aktives Profil, immer sichtbar */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/70 px-4 py-2 backdrop-blur-xl md:px-6">
          <button
            onClick={toggleSidebar}
            title={sidebarOpen ? "Seitenleiste ausblenden" : "Seitenleiste einblenden"}
            className="hidden h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground md:grid"
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <Link
            to="/app/profile"
            className="hidden h-8 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-semibold text-foreground hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c] sm:inline-flex"
            title="Projekt öffnen"
          >
            <Wallet className="h-3.5 w-3.5" />
            {activeWorkspace?.name ?? "Projekt"}
          </Link>

          {activeBrand ? (
            <>
              <BrandAvatar brand={activeBrand} className="h-7 w-7 rounded-[8px] text-xs" />
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-muted-foreground">Aktives Profil</div>
                <div className="truncate text-[15px] font-semibold leading-tight">
                  {activeBrand.name}
                </div>
              </div>
            </>
          ) : (
            <div className="text-[13px] text-muted-foreground">
              Kein Profil gewählt: links auswählen oder anlegen
            </div>
          )}
          <select
            value={activeBrandId ?? ""}
            onChange={(e) => setActiveBrandId(e.target.value || null)}
            className="ml-auto h-8 max-w-[180px] rounded-[9px] border border-border bg-input px-2 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/60"
            title="Profil wechseln"
          >
            <option value="">Profil wechseln</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <main className="flex-1 overflow-y-auto p-6 md:p-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
