import { useState } from "react";
import { Sparkles, X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (opts: { mode: "auto_cut" | "ugc_shorts" | "long_to_many" | "manual"; desiredCount: number | null; captions: boolean; aspect: "9:16" | "16:9" | "1:1" }) => void;
  duration?: number | null;
};

const presets: { label: string; value: number | null; note: string }[] = [
  { label: "Auto", value: null, note: "KI entscheidet nach Länge" },
  { label: "3", value: 3, note: "Nur die stärksten Hooks" },
  { label: "5", value: 5, note: "Klassisch für UGC" },
  { label: "10", value: 10, note: "Long → Many" },
  { label: "Max", value: 20, note: "So viele wie möglich" },
];

export function ClipsCountDialog({ open, onClose, onConfirm, duration }: Props) {
  const [preset, setPreset] = useState<number | null>(null);
  const [custom, setCustom] = useState<string>("");
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [captions, setCaptions] = useState(true);
  const [mode, setMode] = useState<"auto_cut" | "ugc_shorts" | "long_to_many" | "manual">("ugc_shorts");

  if (!open) return null;

  function confirm() {
    const n = custom ? Math.min(20, Math.max(1, parseInt(custom, 10) || 0)) : preset;
    onConfirm({ mode, desiredCount: n ?? null, captions, aspect });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="text-sm font-medium">Wie viele Clips soll die KI machen?</div>
          <button onClick={onClose} className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          {duration && <div className="font-mono text-[10px] text-muted-foreground">Länge: {Math.round(duration)}s</div>}

          <div>
            <div className="mb-2 text-xs font-medium">Anzahl Clips</div>
            <div className="grid grid-cols-5 gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setPreset(p.value); setCustom(""); }}
                  className={`rounded-lg border p-2 text-center transition ${preset === p.value && !custom ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"}`}
                >
                  <div className="text-sm font-semibold">{p.label}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{p.note}</div>
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">oder custom:</span>
              <input
                type="number" min={1} max={20} value={custom}
                onChange={(e) => { setCustom(e.target.value); setPreset(null); }}
                placeholder="1–20"
                className="w-20 rounded-md border border-border bg-input px-2 py-1 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium">Modus</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "ugc_shorts", t: "UGC Shorts", d: "9:16 mit Hooks" },
                { v: "long_to_many", t: "Long → Many", d: "Viele Shorts" },
                { v: "auto_cut", t: "Auto Cut", d: "1 straffer Clip" },
                { v: "manual", t: "Manual", d: "3 Vorschläge" },
              ] as const).map((o) => (
                <button key={o.v} onClick={() => setMode(o.v)} className={`rounded-lg border p-2 text-left ${mode === o.v ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"}`}>
                  <div className="text-xs font-medium">{o.t}</div>
                  <div className="text-[10px] text-muted-foreground">{o.d}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-xs font-medium">Format</div>
              <div className="flex gap-1">
                {(["9:16", "16:9", "1:1"] as const).map((a) => (
                  <button key={a} onClick={() => setAspect(a)} className={`flex-1 rounded-md border px-2 py-1 text-xs ${aspect === a ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary"}`}>{a}</button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-end gap-2 text-xs">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="h-4 w-4 accent-primary" />
              Untertitel generieren
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary">Abbrechen</button>
            <button onClick={confirm} className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
              <Sparkles className="h-3 w-3" /> KI starten
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
