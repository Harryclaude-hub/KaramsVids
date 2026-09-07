import { X, Copy, Check, ExternalLink, AlertTriangle } from "lucide-react";
import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  host: string;
  onUseDirectUrl: (url: string) => void;
  onUploadFile: () => void;
};

export function YouTubeImportDialog({ open, onClose, host, onUseDirectUrl, onUploadFile }: Props) {
  const [copied, setCopied] = useState(false);
  const [direct, setDirect] = useState("");
  if (!open) return null;

  const snippet = `# 1. yt-dlp installieren (einmalig):\n#    brew install yt-dlp   # macOS\n#    pip install yt-dlp    # Windows/Linux\n\n# 2. Video als MP4 laden:\nyt-dlp -f "bv*+ba/best" --merge-output-format mp4 "DEIN_LINK"\n\n# 3. Datei per Drag & Drop in den Editor ziehen.`;

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-[18px] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <div className="text-[19px] font-semibold tracking-tight">{host.toUpperCase()}-Link erkannt</div>
          <button onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-6 text-[15px]">
          <p className="text-muted-foreground">
            Direkter Download von {host}-Videos ist im Browser rechtlich und technisch nicht möglich. Wähle einen Weg:
          </p>

          <div className="rounded-[14px] border border-border bg-background p-4 space-y-3">
            <div className="text-[13px] font-semibold text-muted-foreground">Option A · Ich habe schon eine Direkt-URL (.mp4/.mov/.webm)</div>
            <div className="flex gap-2">
              <input
                value={direct}
                onChange={(e) => setDirect(e.target.value)}
                placeholder="https://cdn.example.com/video.mp4"
                className="h-9 flex-1 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
              />
              <button
                onClick={() => direct && onUseDirectUrl(direct)}
                disabled={!direct}
                className="h-9 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
              >
                Öffnen
              </button>
            </div>
          </div>

          <div className="rounded-[14px] border border-border bg-background p-4 space-y-3">
            <div className="text-[13px] font-semibold text-muted-foreground">Option B · MP4 herunterladen und hochladen (empfohlen)</div>
            <div className="relative">
              <pre className="max-h-56 overflow-x-auto rounded-[11px] border border-border bg-card p-3 font-mono text-[12px] leading-relaxed text-muted-foreground">{snippet}</pre>
              <button onClick={copy} className="absolute right-2 top-2 inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-secondary">
                {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />} {copied ? "Kopiert" : "Kopieren"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="https://cobalt.tools/" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[11px] border border-border bg-card px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-secondary">
                <ExternalLink className="h-3 w-3" /> cobalt.tools (Web-Downloader)
              </a>
              <button onClick={onUploadFile} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
                Datei jetzt hochladen
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
