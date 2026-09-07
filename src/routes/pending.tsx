import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Hourglass, LogOut, RefreshCw, ShieldX } from "lucide-react";

export const Route = createFileRoute("/pending")({
  ssr: false,
  component: PendingPage,
});

function PendingPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      setEmail(userData.user.email ?? "");
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userData.user.id)
        .maybeSingle();
      const st = (profile as { status?: string } | null)?.status ?? "pending";
      setStatus(st);
      if (st === "approved" || (profile as { role?: string } | null)?.role === "admin") {
        navigate({ to: "/app", replace: true });
      }
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    check();
    const t = setInterval(check, 30_000); // alle 30s automatisch prüfen
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const rejected = status === "rejected";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-5 rounded-[18px] border border-border bg-card p-8 text-center">
        <div
          className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${rejected ? "bg-destructive/15 text-destructive" : "bg-secondary text-foreground"}`}
        >
          {rejected ? <ShieldX className="h-7 w-7" /> : <Hourglass className="h-7 w-7" />}
        </div>
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">
            {rejected ? "Zugang abgelehnt" : "Warten auf Freigabe"}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            {rejected
              ? "Dein Konto wurde vom Administrator nicht freigegeben. Bei Fragen wende dich an den Betreiber."
              : "Deine Registrierung ist eingegangen. Der Administrator prüft dein Konto. Sobald es freigegeben ist, kommst du automatisch in die App."}
          </p>
          {email && <p className="mt-2 text-[13px] text-muted-foreground">{email}</p>}
        </div>
        {!rejected && (
          <button
            onClick={check}
            disabled={checking}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
          >
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} /> Status prüfen
          </button>
        )}
        <button
          onClick={signOut}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-secondary px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"
        >
          <LogOut className="h-4 w-4" /> Abmelden
        </button>
      </div>
    </div>
  );
}
