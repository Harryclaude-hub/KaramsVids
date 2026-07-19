import { createFileRoute } from "@tanstack/react-router";
import { Share2, Youtube, Instagram, Facebook } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/connections")({
  component: Connections,
});

const platforms = [
  { id: "tiktok", name: "TikTok", icon: Share2, color: "bg-primary/10 text-primary" },
  { id: "youtube", name: "YouTube", icon: Youtube, color: "bg-destructive/10 text-destructive" },
  { id: "instagram", name: "Instagram", icon: Instagram, color: "bg-accent/10 text-accent" },
  { id: "facebook", name: "Facebook", icon: Facebook, color: "bg-primary/10 text-primary" },
  { id: "x", name: "X (Twitter)", icon: Share2, color: "bg-muted text-foreground" },
];

function Connections() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Social</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Plattformen verbinden</h1>
        <p className="mt-2 text-sm text-muted-foreground">Verbinde deine Accounts, um Clips direkt aus VideoCraft zu veröffentlichen.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {platforms.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className={`grid h-10 w-10 place-items-center rounded-lg ${p.color}`}>
                <p.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="font-mono text-[10px] text-muted-foreground">Nicht verbunden</div>
              </div>
            </div>
            <button disabled className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground opacity-70">
              Bald
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
        Die OAuth-Verbindungen zu TikTok, YouTube & Co. benötigen offizielle Developer-Freigaben.
        Sag Bescheid, sobald du deine App-Keys hast — wir aktivieren dann den jeweiligen Publish-Flow.
      </div>
    </div>
  );
}
