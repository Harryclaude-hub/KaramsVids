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
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-primary text-primary-foreground">
            <Scissors className="h-4 w-4" />
          </div>
          <span>KaramsVids</span>
        </div>
        <Link to="/auth" className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
          Anmelden
        </Link>
      </header>

      <main className="relative">
        <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-16 md:grid-cols-2 md:items-center md:pt-24">
          <div>
            <p className="text-[13px] font-semibold text-muted-foreground">KI-Editor</p>
            <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              Rohvideo rein.<br />
              <span className="text-muted-foreground">Fertige Shorts</span> raus.
            </h1>
            <p className="mt-6 max-w-md text-[17px] leading-relaxed text-muted-foreground">
              Lade Rohmaterial hoch, die KI hört zu, findet Highlights und schneidet UGC-Clips mit
              Untertiteln. Du postest direkt auf TikTok, YouTube und Instagram.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/auth" className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
                Kostenlos starten <Play className="h-4 w-4" />
              </Link>
              <a href="#how" className="inline-flex h-11 items-center rounded-[11px] bg-secondary px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
                So funktioniert's
              </a>
            </div>
            <p className="mt-4 text-[13px] text-muted-foreground">
              KI kostenlos · Cloud-Speicher inklusive · Editor läuft im Browser
            </p>
          </div>

          <div className="relative">
            <div className="rounded-[18px] border border-border bg-card p-6">
              <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                <span className="font-mono">timeline.mp4</span><span className="font-semibold text-destructive">● REC</span>
              </div>
              <div className="mt-4 space-y-2">
                {[
                  { l: "00:00 bis 00:12", t: "Intro Hook", c: "bg-primary" },
                  { l: "00:14 bis 00:38", t: "Story Beat", c: "bg-success" },
                  { l: "00:42 bis 01:02", t: "Punchline", c: "bg-primary" },
                  { l: "01:05 bis 01:24", t: "CTA", c: "bg-success" },
                ].map((s) => (
                  <div key={s.l} className="flex items-center gap-3 rounded-[11px] border border-border bg-background p-3">
                    <div className={`h-8 w-1.5 rounded-full ${s.c}`} />
                    <div className="flex-1">
                      <div className="text-[15px] font-semibold">{s.t}</div>
                      <div className="font-mono text-[12px] tabular-nums text-muted-foreground">{s.l}</div>
                    </div>
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-[11px] bg-secondary p-3 text-[13px] text-muted-foreground">
                <span className="font-semibold text-foreground">KI:</span> „4 Shorts erkannt · 9:16 · Untertitel DE bereit“
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="border-t border-border">
          <div className="mx-auto grid max-w-6xl gap-6 px-6 py-16 md:grid-cols-3">
            {[
              { i: Wand2, t: "Analysieren", d: "KI hört, transkribiert und markiert die stärksten Momente." },
              { i: Scissors, t: "Schneiden", d: "Auto-Cut, UGC-Shorts oder Long-Form zu vielen Clips." },
              { i: Share2, t: "Publizieren", d: "TikTok, YouTube, Instagram, X, Facebook: mit einem Klick." },
            ].map((f) => (
              <div key={f.t} className="rounded-[18px] border border-border bg-card p-6">
                <f.i className="h-6 w-6 text-primary" />
                <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{f.t}</h3>
                <p className="mt-2 text-[15px] text-muted-foreground">{f.d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-[13px] text-muted-foreground">
          <span>© {new Date().getFullYear()} KaramsVids</span>
          <span>Powered by Lovable Cloud</span>
        </div>
      </footer>
    </div>
  );
}
