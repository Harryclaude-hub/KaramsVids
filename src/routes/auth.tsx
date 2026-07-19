import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";
import { Scissors } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/app" });
  },
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/app` },
        });
        if (error) throw error;
        toast.success("Konto erstellt — check deine E-Mail zur Bestätigung.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/app" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    try {
      const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (r.error) throw r.error;
      if (!r.redirected) navigate({ to: "/app" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google-Anmeldung fehlgeschlagen");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <a href="/" className="mb-8 flex items-center gap-2 text-sm">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Scissors className="h-4 w-4" />
          </div>
          <span className="font-semibold">VideoCraft <span className="text-primary">AI</span></span>
        </a>
        <div className="rounded-2xl border border-border bg-card p-6">
          <h1 className="text-2xl font-semibold">{mode === "signin" ? "Willkommen zurück" : "Konto erstellen"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin" ? "Melde dich an, um deine Videos zu schneiden." : "Starte in Sekunden. Kein Kreditkarte."}
          </p>

          <button onClick={handleGoogle} disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-secondary disabled:opacity-60">
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9c-.3 1.3-1 2.4-2.1 3.2v2.7h3.4c2-1.9 3.3-4.6 3.3-7.9z"/><path fill="#34A853" d="M12 23c2.8 0 5.2-.9 6.9-2.5l-3.4-2.7c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7C4.4 20.6 8 23 12 23z"/><path fill="#FBBC05" d="M6.2 14.5c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.8H2.7C1.9 9.3 1.5 11 1.5 12.5s.4 3.2 1.2 4.7l3.5-2.7z"/><path fill="#EA4335" d="M12 6c1.5 0 2.9.5 4 1.5l3-3C17.2 2.8 14.8 2 12 2 8 2 4.4 4.4 2.7 7.8l3.5 2.7C7 7.9 9.3 6 12 6z"/></svg>
            Weiter mit Google
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> oder E-Mail <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail" className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
            <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Passwort" className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
            <button type="submit" disabled={busy} className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {busy ? "Moment…" : mode === "signin" ? "Anmelden" : "Konto erstellen"}
            </button>
          </form>

          <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="mt-4 w-full text-xs text-muted-foreground hover:text-foreground">
            {mode === "signin" ? "Noch kein Konto? Jetzt registrieren." : "Schon dabei? Anmelden."}
          </button>
        </div>
      </div>
    </div>
  );
}
