import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useNavigate,
} from "@tanstack/react-router";
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
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/70 px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-primary text-primary-foreground">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[15px] font-semibold">Admin-Portal</div>
            <div className="text-[13px] text-muted-foreground">
              KaramsVids · Verwaltung
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/app"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-[13px] font-semibold text-foreground hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"
          >
            <ArrowLeft className="h-4 w-4" /> Zurück zur App
          </Link>
          <span className="hidden text-[13px] text-muted-foreground sm:inline">{user.email}</span>
          <button
            onClick={signOut}
            className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="h-4 w-4" /> Abmelden
          </button>
        </div>
      </header>
      <main className="p-6 md:p-10">
        <Outlet />
      </main>
    </div>
  );
}
