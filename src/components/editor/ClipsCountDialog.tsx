import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { CLIP_TEMPLATES, type ClipTemplateId, templateById } from "@/lib/clip-templates";

type Mode = "auto_cut" | "ugc_shorts" | "long_to_many" | "manual";
type Aspect = "9:16" | "16:9" | "1:1";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (opts: {
    mode: Mode;
    desiredCount: number | null;
    captions: boolean;
    aspect: Aspect;
    templateId: ClipTemplateId | null;
  }) => void;
  duration?: number | null;
};

const presets: { label: string; value: number | null; note: string }[] = [
  { label: "Auto", value: null, note: "KI entscheidet" },
  { label: "5", value: 5, note: "Best-of" },
  { label: "10", value: 10, note: "UGC" },
  { label: "20", value: 20, note: "Long → Many" },
  { label: "Max", value: 30, note: "Alles" },
];

export function ClipsCountDialog({ open, onClose, onConfirm, duration }: Props) {
  const [templateId, setTemplateId] = useState<ClipTemplateId | null>("ugc_hook");
  const tpl = templateById(templateId);

  const [preset, setPreset] = useState<number | null>(tpl?.defaultCount ?? 10);
  const [custom, setCustom] = useState<string>("");
  const [aspect, setAspect] = useState<Aspect>(tpl?.aspect ?? "9:16");
  const [captions, setCaptions] = useState<boolean>(tpl?.captions ?? true);
  const [mode, setMode] = useState<Mode>(tpl?.mode ?? "ugc_shorts");

  if (!open) return null;

  function pickTemplate(id: ClipTemplateId) {
    setTemplateId(id);
    const t = templateById(id);
    if (!t) return;
    setPreset(t.defaultCount);
    setCustom("");
    setAspect(t.aspect);
    setCaptions(t.captions);
    setMode(t.mode);
  }

  function confirm() {
    const n = custom ? Math.min(30, Math.max(1, parseInt(custom, 10) || 0)) : preset;
    onConfirm({ mode, desiredCount: n ?? null, captions, aspect, templateId });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-[18px] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="text-[19px] font-semibold tracking-tight">Wie soll die KI clippen?</div>
          <button onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto p-6 text-[15px]">
          {duration && <div className="text-[13px] text-muted-foreground tabular-nums">Länge: {Math.round(duration)}s</div>}

          {/* Vorlagen */}
          <div>
            <div className="mb-2 text-[13px] font-semibold text-muted-foreground">Clip-Vorlage</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CLIP_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickTemplate(t.id)}
                  className={`rounded-[14px] border p-3 text-left transition-colors ${templateId === t.id ? "border-primary bg-card ring-1 ring-primary" : "border-border bg-background hover:bg-secondary/60"}`}
                >
                  <div className="text-[15px]">{t.emoji} <span className="font-semibold">{t.label}</span></div>
                  <div className="mt-1 text-[13px] text-muted-foreground">{t.short}</div>
                </button>
              ))}
            </div>
            {tpl && (
              <p className="mt-2 text-[13px] text-muted-foreground">
                Passt Modus, Format, Untertitel und Sound-Stimmung automatisch an. Du kannst unten alles überschreiben.
              </p>
            )}
          </div>

          {/* Anzahl */}
          <div>
            <div className="mb-2 text-[13px] font-semibold text-muted-foreground">Anzahl Clips</div>
            <div className="grid grid-cols-5 gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setPreset(p.value); setCustom(""); }}
                  className={`rounded-[12px] border p-2 text-center transition-colors ${preset === p.value && !custom ? "border-primary bg-card ring-1 ring-primary" : "border-border bg-background hover:bg-secondary/60"}`}
                >
                  <div className="text-[15px] font-semibold tabular-nums">{p.label}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">{p.note}</div>
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[13px]">
              <span className="text-muted-foreground">oder eigene Anzahl:</span>
              <input
                type="number" min={1} max={30} value={custom}
                onChange={(e) => { setCustom(e.target.value); setPreset(null); }}
                placeholder="1–30"
                className="h-9 w-20 rounded-[9px] border border-border bg-input px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
              />
            </div>
          </div>

          {/* Modus */}
          <div>
            <div className="mb-2 text-[13px] font-semibold text-muted-foreground">Modus</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "ugc_shorts", t: "UGC Shorts", d: "9:16 mit Hooks" },
                { v: "long_to_many", t: "Long → Many", d: "Viele Shorts" },
                { v: "auto_cut", t: "Auto Cut", d: "1 straffer Clip" },
                { v: "manual", t: "Manual", d: "3 Vorschläge" },
              ] as const).map((o) => (
                <button key={o.v} onClick={() => setMode(o.v)} className={`rounded-[12px] border p-3 text-left transition-colors ${mode === o.v ? "border-primary bg-card ring-1 ring-primary" : "border-border bg-background hover:bg-secondary/60"}`}>
                  <div className="text-[15px] font-semibold">{o.t}</div>
                  <div className="text-[13px] text-muted-foreground">{o.d}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-2 text-[13px] font-semibold text-muted-foreground">Format</div>
              <div className="flex gap-1 rounded-[10px] bg-secondary p-[3px]">
                {(["9:16", "16:9", "1:1"] as const).map((a) => (
                  <button key={a} onClick={() => setAspect(a)} className={`flex-1 rounded-[8px] px-2 py-1 text-[13px] font-semibold tabular-nums transition-colors ${aspect === a ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{a}</button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-end gap-3 pb-1 text-[15px]">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="h-[18px] w-[18px] accent-primary" />
              Untertitel generieren
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="h-9 rounded-[11px] border border-border bg-card px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-secondary">Abbrechen</button>
            <button onClick={confirm} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
              <Sparkles className="h-3 w-3" /> KI starten
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
