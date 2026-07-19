import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Scissors, LayoutGrid, Upload, Share2, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

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

  const nav = [
    { to: "/app", label: "Dashboard", icon: LayoutGrid },
    { to: "/app/upload", label: "Upload", icon: Upload },
    { to: "/app/connections", label: "Social", icon: Share2 },
  ];

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 flex-col border-r border-border bg-card/40 p-4 md:flex">
        <Link to="/app" className="mb-8 flex items-center gap-2">
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
