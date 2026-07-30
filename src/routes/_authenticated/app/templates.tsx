import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Save, Sparkles, Trash2 } from "lucide-react";
import {
  RENDER_TEMPLATES,
  overridesFromTemplate,
  mergeTemplate,
  renderTemplateFor,
  type TemplateOverrides,
} from "@/lib/creatomate-templates";
import {
  deleteTemplatePreset,
  listTemplatePresets,
  saveTemplatePreset,
} from "@/lib/render.functions";

export const Route = createFileRoute("/_authenticated/app/templates")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Render-Vorlagen – Untertitel, Musik & Übergänge" },
      {
        name: "description",
        content:
          "Stelle Untertitel-Stil, Musik-Intensität, Übergänge und Ken-Burns pro Vorlage visuell ein und speichere sie für dein Massen-Rendering.",
      },
      { property: "og:title", content: "Render-Vorlagen visuell einstellen" },
      {
        property: "og:description",
        content: "Untertitel, Musik, Übergänge und Ken-Burns pro Vorlage konfigurieren.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TemplatesPage,
});

const BASE_IDS = Object.keys(RENDER_TEMPLATES);

const CAPTION_STYLES = [
  ["karaoke", "Karaoke (Wort für Wort)"],
  ["highlight", "Highlight (Großbuchstaben)"],
  ["block", "Block (mit Box)"],
  ["none", "Ohne Untertitel"],
] as const;

const IN_TRANSITIONS = [
  ["fade", "Weiche Blende"],
  ["slide-up", "Slide nach oben"],
  ["scale-up", "Zoom-In"],
  ["wipe-right", "Wipe"],
  ["none", "Kein Übergang"],
] as const;

const OUT_TRANSITIONS = [
  ["fade", "Ausblenden"],
  ["scale-down", "Zoom-Out"],
  ["none", "Hart"],
] as const;

const MOTION = [
  ["none", "Statisch"],
  ["slow-zoom", "Langsamer Zoom (Ken Burns)"],
  ["punch-in", "Punch-In"],
] as const;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function TemplatesPage() {
  const qc = useQueryClient();
  const save = useServerFn(saveTemplatePreset);
  const remove = useServerFn(deleteTemplatePreset);

  const presetsQ = useQuery({ queryKey: ["template-presets"], queryFn: () => listTemplatePresets() });

  const [presetId, setPresetId] = useState<string | null>(null);
  const [name, setName] = useState("Meine Vorlage");
  const [baseId, setBaseId] = useState<string>("ugc_hook");
  const [cfg, setCfg] = useState<TemplateOverrides>(() =>
    overridesFromTemplate(RENDER_TEMPLATES.ugc_hook),
  );
  const [busy, setBusy] = useState(false);

  // Basiswerte übernehmen, wenn eine neue Grundvorlage gewählt wird
  useEffect(() => {
    if (presetId) return;
    setCfg(overridesFromTemplate(renderTemplateFor(baseId)));
  }, [baseId, presetId]);

  const merged = useMemo(
    () => mergeTemplate(renderTemplateFor(baseId), cfg),
    [baseId, cfg],
  );

  function set<K extends keyof TemplateOverrides>(k: K, v: TemplateOverrides[K]) {
    setCfg((c) => ({ ...c, [k]: v }));
  }

  function loadPreset(p: { id: string; name: string; base_template_id: string; config: unknown }) {
    setPresetId(p.id);
    setName(p.name);
    setBaseId(p.base_template_id);
    setCfg((p.config ?? {}) as TemplateOverrides);
  }

  function newPreset() {
    setPresetId(null);
    setName("Meine Vorlage");
    setCfg(overridesFromTemplate(renderTemplateFor(baseId)));
  }

  async function onSave() {
    setBusy(true);
    try {
      const res = await save({
        data: { id: presetId, name, baseTemplateId: baseId, config: cfg },
      });
      setPresetId(res.id);
      toast.success("Vorlage gespeichert — sie wird beim nächsten Massen-Rendering benutzt.");
      qc.invalidateQueries({ queryKey: ["template-presets"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    try {
      await remove({ data: { id } });
      if (id === presetId) newPreset();
      qc.invalidateQueries({ queryKey: ["template-presets"] });
      toast.success("Vorlage gelöscht.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen");
    }
  }

  const inputCls =
    "w-full rounded border border-border bg-input px-2 py-1.5 text-xs outline-none focus:border-primary";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-xl font-semibold">Render-Vorlagen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Untertitel-Stil, Musik-Intensität, Übergänge und Ken-Burns pro Vorlage einstellen. Die
          zuletzt gespeicherte Vorlage einer Grundvorlage wird beim Massen-Rendering automatisch
          verwendet.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Row>
            <Row label="Grundvorlage">
              <select value={baseId} onChange={(e) => setBaseId(e.target.value)} className={inputCls}>
                {BASE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </Row>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Untertitel-Stil">
              <select
                value={merged.caption.style}
                onChange={(e) => set("captionStyle", e.target.value as never)}
                className={inputCls}
              >
                {CAPTION_STYLES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Aktive Wortfarbe">
              <input
                type="color"
                value={merged.caption.activeColor}
                onChange={(e) => set("captionActiveColor", e.target.value)}
                className="h-8 w-full rounded border border-border bg-input"
              />
            </Row>
            <Row label={`Schriftgröße · ${merged.caption.fontSizePct.toFixed(1)}`}>
              <input
                type="range"
                min={3}
                max={12}
                step={0.2}
                value={merged.caption.fontSizePct}
                onChange={(e) => set("captionSizePct", Number(e.target.value))}
                className="w-full accent-primary"
              />
            </Row>
            <Row label={`Position · ${merged.caption.y}`} hint="Abstand von oben">
              <input
                type="range"
                min={20}
                max={92}
                step={1}
                value={parseInt(merged.caption.y, 10) || 70}
                onChange={(e) => set("captionY", `${e.target.value}%`)}
                className="w-full accent-primary"
              />
            </Row>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Row label={`Musik-Lautstärke · ${merged.music.volumePct}%`}>
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                value={merged.music.volumePct}
                onChange={(e) => set("musicVolumePct", Number(e.target.value))}
                className="w-full accent-primary"
              />
            </Row>
            <Row label="Musik unter Stimme absenken">
              <button
                type="button"
                onClick={() => set("musicDuck", !merged.music.duck)}
                className={`w-full rounded border px-2 py-1.5 text-xs ${merged.music.duck ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
              >
                {merged.music.duck ? "Ducking aktiv" : "Ducking aus"}
              </button>
            </Row>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Row label="Übergang rein">
              <select
                value={merged.transition.in}
                onChange={(e) => set("transitionIn", e.target.value as never)}
                className={inputCls}
              >
                {IN_TRANSITIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Übergang raus">
              <select
                value={merged.transition.out}
                onChange={(e) => set("transitionOut", e.target.value as never)}
                className={inputCls}
              >
                {OUT_TRANSITIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={`Dauer · ${merged.transition.durationS.toFixed(2)}s`}>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={merged.transition.durationS}
                onChange={(e) => set("transitionDurationS", Number(e.target.value))}
                className="w-full accent-primary"
              />
            </Row>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Bildbewegung">
              <select
                value={merged.motion.kind}
                onChange={(e) => set("motionKind", e.target.value as never)}
                className={inputCls}
              >
                {MOTION.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={`Stärke · ${merged.motion.amountPct}%`}>
              <input
                type="range"
                min={0}
                max={25}
                step={1}
                value={merged.motion.amountPct}
                onChange={(e) => set("motionAmountPct", Number(e.target.value))}
                className="w-full accent-primary"
              />
            </Row>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {presetId ? "Vorlage aktualisieren" : "Vorlage speichern"}
            </button>
            <button
              onClick={newPreset}
              className="rounded-md border border-border px-3 py-2 text-xs hover:border-primary/50"
            >
              Neu
            </button>
          </div>
        </section>

        <aside className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Live-Vorschau
            </div>
            <div className="relative mx-auto aspect-[9/16] w-40 overflow-hidden rounded-md bg-gradient-to-b from-zinc-700 to-zinc-900">
              <div
                className="absolute inset-x-2 text-center text-[9px] font-bold leading-tight"
                style={{
                  top: merged.caption.y,
                  transform: "translateY(-50%)",
                  color: merged.caption.style === "none" ? "transparent" : "#fff",
                  fontSize: `${merged.caption.fontSizePct * 1.4}px`,
                  background: merged.caption.background ?? "transparent",
                  textTransform: merged.caption.style === "highlight" ? "uppercase" : "none",
                }}
              >
                Dein <span style={{ color: merged.caption.activeColor }}>Untertitel</span> hier
              </div>
              <div className="absolute bottom-1 left-1 right-1 flex justify-between font-mono text-[7px] text-white/60">
                <span>{merged.motion.kind}</span>
                <span>♪ {merged.music.volumePct}%</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 text-xs font-medium">Gespeicherte Vorlagen</div>
            <div className="space-y-1">
              {(presetsQ.data ?? []).map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-1 rounded border px-2 py-1.5 text-[11px] ${p.id === presetId ? "border-primary/60 bg-primary/5" : "border-border"}`}
                >
                  <button onClick={() => loadPreset(p)} className="min-w-0 flex-1 truncate text-left">
                    {p.name}
                    <span className="ml-1 font-mono text-[9px] text-muted-foreground">
                      {p.base_template_id}
                    </span>
                  </button>
                  <button
                    onClick={() => onDelete(p.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Vorlage löschen"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {presetsQ.data?.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Noch keine eigene Vorlage gespeichert.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
