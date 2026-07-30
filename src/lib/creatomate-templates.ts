// ============================================================
// Creatomate-Render-Templates
//
// Jede Vorlage erzeugt eine fertige Creatomate-"source"-JSON:
//   · Video-Layer (Ausschnitt aus dem Rohvideo, korrektes Format)
//   · Untertitel-Layer (Auto-Transkript ODER SRT-Text)
//   · Musik-Layer (viraler Track, mit Fade + Speech-Ducking)
//   · Übergänge (sauberer In/Out je Vorlage)
//
// Client-safe: keine Secrets, kein Server-Import. Wird sowohl von
// der UI (Vorschau der Einstellungen) als auch vom Render-Worker
// benutzt.
// ============================================================

import type { ClipTemplateId } from "@/lib/clip-templates";

export type Aspect = "9:16" | "16:9" | "1:1";

export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

export type RenderTemplate = {
  id: ClipTemplateId;
  /** Untertitel-Look */
  caption: {
    style: "karaoke" | "block" | "highlight" | "none";
    y: string;
    fontFamily: string;
    fontWeight: number;
    fontSizePct: number;
    fillColor: string;
    activeColor: string;
    background: string | null;
    strokeWidth: string;
  };
  /** Musik-Layer */
  music: { volumePct: number; fadeInS: number; fadeOutS: number; duck: boolean };
  /** Übergänge */
  transition: {
    in: "fade" | "slide-up" | "scale-up" | "wipe-right" | "none";
    out: "fade" | "scale-down" | "none";
    durationS: number;
  };
  /** Ken-Burns / Motion auf dem Video-Layer */
  motion: { kind: "none" | "slow-zoom" | "punch-in"; amountPct: number };
  /** Farb-Look */
  grade: { brightness: number; contrast: number; saturation: number } | null;
};

const BASE_FONT = "Montserrat";

export const RENDER_TEMPLATES: Record<ClipTemplateId, RenderTemplate> = {
  ugc_hook: {
    id: "ugc_hook",
    caption: {
      style: "karaoke",
      y: "52%",
      fontFamily: BASE_FONT,
      fontWeight: 800,
      fontSizePct: 7.2,
      fillColor: "#ffffff",
      activeColor: "#F26A1F",
      background: null,
      strokeWidth: "1.4 vmin",
    },
    music: { volumePct: 16, fadeInS: 0.4, fadeOutS: 0.8, duck: true },
    transition: { in: "scale-up", out: "fade", durationS: 0.35 },
    motion: { kind: "punch-in", amountPct: 6 },
    grade: { brightness: 4, contrast: 12, saturation: 12 },
  },
  podcast_snippet: {
    id: "podcast_snippet",
    caption: {
      style: "karaoke",
      y: "78%",
      fontFamily: BASE_FONT,
      fontWeight: 700,
      fontSizePct: 5.8,
      fillColor: "#ffffff",
      activeColor: "#FFD166",
      background: "rgba(0,0,0,0.42)",
      strokeWidth: "0 vmin",
    },
    music: { volumePct: 9, fadeInS: 0.8, fadeOutS: 1.2, duck: true },
    transition: { in: "fade", out: "fade", durationS: 0.4 },
    motion: { kind: "slow-zoom", amountPct: 4 },
    grade: { brightness: 2, contrast: 6, saturation: 4 },
  },
  story_time: {
    id: "story_time",
    caption: {
      style: "block",
      y: "80%",
      fontFamily: BASE_FONT,
      fontWeight: 700,
      fontSizePct: 5.4,
      fillColor: "#ffffff",
      activeColor: "#ffffff",
      background: "rgba(0,0,0,0.5)",
      strokeWidth: "0 vmin",
    },
    music: { volumePct: 14, fadeInS: 1.2, fadeOutS: 1.6, duck: true },
    transition: { in: "fade", out: "fade", durationS: 0.6 },
    motion: { kind: "slow-zoom", amountPct: 8 },
    grade: { brightness: 0, contrast: 8, saturation: -4 },
  },
  talking_head: {
    id: "talking_head",
    caption: {
      style: "highlight",
      y: "72%",
      fontFamily: BASE_FONT,
      fontWeight: 800,
      fontSizePct: 6.4,
      fillColor: "#ffffff",
      activeColor: "#F26A1F",
      background: null,
      strokeWidth: "1.2 vmin",
    },
    music: { volumePct: 6, fadeInS: 0.3, fadeOutS: 0.6, duck: true },
    transition: { in: "fade", out: "fade", durationS: 0.25 },
    motion: { kind: "punch-in", amountPct: 4 },
    grade: { brightness: 5, contrast: 8, saturation: 6 },
  },
  fast_reel: {
    id: "fast_reel",
    caption: {
      style: "none",
      y: "70%",
      fontFamily: BASE_FONT,
      fontWeight: 800,
      fontSizePct: 6,
      fillColor: "#ffffff",
      activeColor: "#F26A1F",
      background: null,
      strokeWidth: "1.4 vmin",
    },
    music: { volumePct: 28, fadeInS: 0.2, fadeOutS: 0.4, duck: false },
    transition: { in: "wipe-right", out: "scale-down", durationS: 0.2 },
    motion: { kind: "punch-in", amountPct: 10 },
    grade: { brightness: 6, contrast: 18, saturation: 20 },
  },
  cinematic: {
    id: "cinematic",
    caption: {
      style: "block",
      y: "84%",
      fontFamily: BASE_FONT,
      fontWeight: 600,
      fontSizePct: 4.6,
      fillColor: "#f5f0e8",
      activeColor: "#f5f0e8",
      background: null,
      strokeWidth: "0.6 vmin",
    },
    music: { volumePct: 22, fadeInS: 1.5, fadeOutS: 2, duck: true },
    transition: { in: "fade", out: "fade", durationS: 0.9 },
    motion: { kind: "slow-zoom", amountPct: 10 },
    grade: { brightness: -2, contrast: 14, saturation: -10 },
  },
};

export function renderTemplateFor(id?: string | null): RenderTemplate {
  return RENDER_TEMPLATES[(id ?? "ugc_hook") as ClipTemplateId] ?? RENDER_TEMPLATES.ugc_hook;
}

/** Visuell einstellbare Felder des Template-Editors. */
export type TemplateOverrides = {
  captionStyle?: RenderTemplate["caption"]["style"];
  captionY?: string;
  captionSizePct?: number;
  captionActiveColor?: string;
  musicVolumePct?: number;
  musicDuck?: boolean;
  transitionIn?: RenderTemplate["transition"]["in"];
  transitionOut?: RenderTemplate["transition"]["out"];
  transitionDurationS?: number;
  motionKind?: RenderTemplate["motion"]["kind"];
  motionAmountPct?: number;
};

/** Basis-Vorlage + individuelle Einstellungen zusammenführen. */
export function mergeTemplate(
  base: RenderTemplate,
  o?: TemplateOverrides | null,
): RenderTemplate {
  if (!o) return base;
  return {
    ...base,
    caption: {
      ...base.caption,
      style: o.captionStyle ?? base.caption.style,
      y: o.captionY ?? base.caption.y,
      fontSizePct: o.captionSizePct ?? base.caption.fontSizePct,
      activeColor: o.captionActiveColor ?? base.caption.activeColor,
    },
    music: {
      ...base.music,
      volumePct: o.musicVolumePct ?? base.music.volumePct,
      duck: o.musicDuck ?? base.music.duck,
    },
    transition: {
      in: o.transitionIn ?? base.transition.in,
      out: o.transitionOut ?? base.transition.out,
      durationS: o.transitionDurationS ?? base.transition.durationS,
    },
    motion: {
      kind: o.motionKind ?? base.motion.kind,
      amountPct: o.motionAmountPct ?? base.motion.amountPct,
    },
  };
}

/** Overrides aus einer bestehenden Vorlage ableiten (Editor-Startwerte). */
export function overridesFromTemplate(t: RenderTemplate): Required<TemplateOverrides> {
  return {
    captionStyle: t.caption.style,
    captionY: t.caption.y,
    captionSizePct: t.caption.fontSizePct,
    captionActiveColor: t.caption.activeColor,
    musicVolumePct: t.music.volumePct,
    musicDuck: t.music.duck,
    transitionIn: t.transition.in,
    transitionOut: t.transition.out,
    transitionDurationS: t.transition.durationS,
    motionKind: t.motion.kind,
    motionAmountPct: t.motion.amountPct,
  };
}


// ---------- Creatomate-Source-Builder ----------

/* eslint-disable @typescript-eslint/no-explicit-any */

function inAnimation(t: RenderTemplate): any[] {
  const d = t.transition.durationS;
  switch (t.transition.in) {
    case "fade":
      return [{ time: 0, duration: d, easing: "quadratic-out", type: "fade" }];
    case "slide-up":
      return [
        { time: 0, duration: d, easing: "quadratic-out", type: "slide", direction: "up" },
      ];
    case "scale-up":
      return [
        { time: 0, duration: d, easing: "quadratic-out", type: "scale", scope: "element", start_scale: "108%", end_scale: "100%" },
        { time: 0, duration: d * 0.7, easing: "linear", type: "fade" },
      ];
    case "wipe-right":
      return [{ time: 0, duration: d, easing: "quadratic-out", type: "wipe", start_angle: "270°" }];
    default:
      return [];
  }
}

function outAnimation(t: RenderTemplate, clipDur: number): any[] {
  const d = t.transition.durationS;
  const time = Math.max(0, clipDur - d);
  switch (t.transition.out) {
    case "fade":
      return [{ time, duration: d, easing: "quadratic-in", type: "fade", reversed: true }];
    case "scale-down":
      return [
        { time, duration: d, easing: "quadratic-in", type: "scale", scope: "element", start_scale: "100%", end_scale: "94%" },
        { time, duration: d, easing: "linear", type: "fade", reversed: true },
      ];
    default:
      return [];
  }
}

function motionKeyframes(t: RenderTemplate, clipDur: number): any {
  if (t.motion.kind === "none") return {};
  const end = 100 + t.motion.amountPct;
  if (t.motion.kind === "punch-in") {
    return {
      scale: [
        { time: 0, value: `${end}%`, easing: "quadratic-out" },
        { time: Math.min(1.2, clipDur * 0.25), value: "100%" },
      ],
    };
  }
  return {
    scale: [
      { time: 0, value: "100%", easing: "linear" },
      { time: clipDur, value: `${end}%` },
    ],
  };
}

function captionElement(t: RenderTemplate, videoName: string, srt?: string | null): any | null {
  if (t.caption.style === "none") return null;
  const base: any = {
    type: "text",
    name: "Untertitel",
    track: 3,
    y: t.caption.y,
    width: "86%",
    x_alignment: "50%",
    y_alignment: "50%",
    font_family: t.caption.fontFamily,
    font_weight: t.caption.fontWeight,
    font_size: `${t.caption.fontSizePct} vmin`,
    fill_color: t.caption.fillColor,
    line_height: "112%",
    text_transform: t.caption.style === "highlight" ? "uppercase" : "none",
    stroke_color: "#000000",
    stroke_width: t.caption.strokeWidth,
    shadow_color: "rgba(0,0,0,0.45)",
    shadow_blur: "1.2 vmin",
    shadow_y: "0.4 vmin",
    transcript_source: videoName,
    transcript_maximum_length: t.caption.style === "karaoke" ? 22 : 42,
    transcript_color: t.caption.activeColor,
    transcript_effect:
      t.caption.style === "karaoke"
        ? "karaoke"
        : t.caption.style === "highlight"
          ? "highlight"
          : "color",
  };
  if (t.caption.background) {
    base.background_color = t.caption.background;
    base.background_x_padding = "26%";
    base.background_y_padding = "18%";
    base.background_border_radius = "18%";
  }
  // Fallback: liegt bereits ein SRT-Text vor, wird er als statischer Text
  // genutzt (Creatomate transkribiert dann nicht erneut → günstiger).
  if (srt && srt.trim()) {
    delete base.transcript_source;
    delete base.transcript_effect;
    delete base.transcript_maximum_length;
    delete base.transcript_color;
    base.text = srtToPlain(srt).slice(0, 400);
  }
  return base;
}

export function srtToPlain(srt: string): string {
  return srt
    .split(/\r?\n/)
    .filter((l) => !/^\d+$/.test(l.trim()) && !l.includes("-->") && l.trim())
    .join(" ")
    .trim();
}

export type BuildSourceInput = {
  templateId?: string | null;
  aspect: Aspect;
  videoUrl: string;
  startS: number;
  endS: number;
  captionsSrt?: string | null;
  captionsEnabled: boolean;
  musicUrl?: string | null;
  /** Wasserzeichen/Brand-Logo (öffentliche URL) */
  watermarkUrl?: string | null;
  /** Titel-Overlay in den ersten Sekunden (Hook) */
  hookText?: string | null;
};

/** Baut die vollständige Creatomate-Source-JSON für einen Clip. */
export function buildCreatomateSource(input: BuildSourceInput): Record<string, unknown> {
  const t = renderTemplateFor(input.templateId);
  const { width, height } = ASPECT_SIZE[input.aspect];
  const clipDur = Math.max(1, Number((input.endS - input.startS).toFixed(2)));
  const videoName = "Hauptvideo";

  const video: any = {
    type: "video",
    name: videoName,
    track: 1,
    time: 0,
    duration: clipDur,
    source: input.videoUrl,
    trim_start: Math.max(0, input.startS),
    trim_duration: clipDur,
    fit: "cover",
    volume: "100%",
    animations: [...inAnimation(t), ...outAnimation(t, clipDur)],
    ...motionKeyframes(t, clipDur),
  };
  if (t.grade) {
    video.color_filter = "custom";
    video.color_filter_value = 1;
    video.brightness = `${t.grade.brightness}%`;
    video.contrast = `${t.grade.contrast}%`;
    video.saturation = `${t.grade.saturation}%`;
  }

  const elements: any[] = [video];

  if (input.musicUrl) {
    elements.push({
      type: "audio",
      name: "Musik",
      track: 2,
      time: 0,
      duration: clipDur,
      source: input.musicUrl,
      volume: `${t.music.volumePct}%`,
      audio_fade_in: t.music.fadeInS,
      audio_fade_out: t.music.fadeOutS,
      // Speech-Ducking: Musik senkt sich automatisch unter der Stimme
      ...(t.music.duck ? { audio_duck: videoName, audio_duck_level: "-14 dB" } : {}),
      loop: true,
    });
  }

  if (input.captionsEnabled) {
    const cap = captionElement(t, videoName, input.captionsSrt);
    if (cap) elements.push({ ...cap, time: 0, duration: clipDur });
  }

  if (input.hookText) {
    elements.push({
      type: "text",
      name: "Hook",
      track: 4,
      time: 0,
      duration: Math.min(2.6, clipDur),
      y: "16%",
      width: "84%",
      x_alignment: "50%",
      y_alignment: "50%",
      text: input.hookText.slice(0, 90),
      font_family: t.caption.fontFamily,
      font_weight: 800,
      font_size: `${t.caption.fontSizePct * 0.95} vmin`,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: "1.2 vmin",
      animations: [
        { time: 0, duration: 0.4, easing: "quadratic-out", type: "text-slide", scope: "split-clip", split: "word" },
        { time: Math.min(2.2, clipDur - 0.4), duration: 0.4, type: "fade", reversed: true },
      ],
    });
  }

  if (input.watermarkUrl) {
    elements.push({
      type: "image",
      name: "Wasserzeichen",
      track: 5,
      time: 0,
      duration: clipDur,
      source: input.watermarkUrl,
      x: "88%",
      y: "8%",
      width: "16%",
      fit: "contain",
      opacity: "72%",
    });
  }

  return {
    output_format: "mp4",
    frame_rate: 30,
    width,
    height,
    elements,
  };
}
