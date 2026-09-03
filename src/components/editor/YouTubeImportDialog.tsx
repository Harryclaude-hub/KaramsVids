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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <AlertTriangle className="h-4 w-4 text-primary" />
          <div className="text-sm font-medium">{host.toUpperCase()}-Link erkannt</div>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <p className="text-muted-foreground">
            Direkter Download von {host}-Videos ist im Browser rechtlich & technisch nicht möglich.
            Wähle einen Weg:
          </p>

          <div className="rounded-xl border border-border bg-background p-4 space-y-2">
            <div className="text-xs font-medium">
              Option A · Ich habe schon eine Direkt-URL (.mp4/.mov/.webm)
            </div>
            <div className="flex gap-2">
              <input
                value={direct}
                onChange={(e) => setDirect(e.target.value)}
                placeholder="https://cdn.example.com/video.mp4"
                className="flex-1 rounded-md border border-border bg-input px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button
                onClick={() => direct && onUseDirectUrl(direct)}
                disabled={!direct}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Öffnen
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background p-4 space-y-3">
            <div className="text-xs font-medium">
              Option B · MP4 herunterladen & uploaden (empfohlen)
            </div>
            <div className="relative">
              <pre className="max-h-56 overflow-x-auto rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {snippet}
              </pre>
              <button
                onClick={copy}
                className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] hover:bg-secondary"
              >
                {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}{" "}
                {copied ? "Kopiert" : "Kopieren"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="https://cobalt.tools/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-secondary"
              >
                <ExternalLink className="h-3 w-3" /> cobalt.tools (Web-Downloader)
              </a>
              <button
                onClick={onUploadFile}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
              >
                Datei jetzt hochladen
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
