import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Shield, ArrowLeft, LogOut } from "lucide-react";

const ADMIN_EMAIL = "saifokaram1@gmail.com";

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    let isAdmin = data.user.email === ADMIN_EMAIL;
    if (!isAdmin) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .maybeSingle();
      const p = (profile ?? {}) as { role?: string };
      isAdmin = p.role === "admin";
    }
    if (!isAdmin) throw redirect({ to: "/app" });
    return { user: data.user };
  },
  component: AdminShell,
});

function AdminShell() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Admin-Portal</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              VideoCraft AI · Verwaltung
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/app"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Zurück zur App
          </Link>
          <span className="hidden text-xs text-muted-foreground sm:inline">{user.email}</span>
          <button
            onClick={signOut}
            className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
          >
            <LogOut className="h-3.5 w-3.5" /> Abmelden
          </button>
        </div>
      </header>
      <main className="p-6 md:p-10">
        <Outlet />
      </main>
    </div>
  );
}
