import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Scissors, Sparkles, Share2, Wand2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Landing,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/app" });
  },
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 font-semibold">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Scissors className="h-4 w-4" />
          </div>
          <span>
            VideoCraft <span className="text-primary">AI</span>
          </span>
        </div>
        <Link
          to="/auth"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Anmelden
        </Link>
      </header>

      <main className="relative">
        <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-16 md:grid-cols-2 md:items-center md:pt-24">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              v1 · KI-Editor
            </p>
            <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              Rohvideo rein.
              <br />
              <span className="text-primary">Fertige Shorts</span> raus.
            </h1>
            <p className="mt-6 max-w-md text-muted-foreground">
              Lade Rohmaterial hoch, die KI hört zu, findet Highlights, schneidet UGC-Clips mit
              Untertiteln — und du postest direkt auf TikTok, YouTube & Instagram.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Kostenlos starten <Play className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center rounded-md border border-border px-5 py-3 text-sm font-medium hover:bg-secondary"
              >
                So funktioniert's
              </a>
            </div>
            <p className="mt-4 font-mono text-xs text-muted-foreground">
              KI kostenlos · Cloud-Speicher inklusive · Editor läuft im Browser
            </p>
          </div>

          <div className="relative">
            <div className="grain absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/20 via-transparent to-accent/10 blur-2xl" />
            <div className="relative rounded-3xl border border-border bg-card p-6 shadow-2xl">
              <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
                <span>timeline.mp4</span>
                <span className="text-primary">● REC</span>
              </div>
              <div className="mt-4 space-y-2">
                {[
                  { l: "00:00 — 00:12", t: "Intro Hook", c: "bg-primary/80" },
                  { l: "00:14 — 00:38", t: "Story Beat", c: "bg-accent/70" },
                  { l: "00:42 — 01:02", t: "Punchline", c: "bg-primary/80" },
                  { l: "01:05 — 01:24", t: "CTA", c: "bg-accent/70" },
                ].map((s) => (
                  <div
                    key={s.l}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-3"
                  >
                    <div className={`h-8 w-1.5 rounded-full ${s.c}`} />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{s.t}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{s.l}</div>
                    </div>
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg bg-background/60 p-3 text-xs text-muted-foreground">
                <span className="font-mono text-primary">KI:</span> „4 Shorts erkannt · 9:16 ·
                Untertitel DE bereit"
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="border-t border-border bg-card/40">
          <div className="mx-auto grid max-w-6xl gap-6 px-6 py-16 md:grid-cols-3">
            {[
              {
                i: Wand2,
                t: "Analysieren",
                d: "KI hört, transkribiert und markiert die stärksten Momente.",
              },
              {
                i: Scissors,
                t: "Schneiden",
                d: "Auto-Cut, UGC-Shorts oder Long-Form zu vielen Clips.",
              },
              {
                i: Share2,
                t: "Publizieren",
                d: "TikTok, YouTube, Instagram, X, Facebook — mit einem Klick.",
              },
            ].map((f) => (
              <div key={f.t} className="rounded-2xl border border-border bg-background p-6">
                <f.i className="h-6 w-6 text-primary" />
                <h3 className="mt-4 text-lg font-semibold">{f.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} VideoCraft AI</span>
          <span className="font-mono">Powered by Lovable Cloud</span>
        </div>
      </footer>
    </div>
  );
}
