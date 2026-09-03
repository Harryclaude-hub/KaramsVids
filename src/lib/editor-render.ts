// ============================================================
// Render-Kern: übersetzt Clip-Eigenschaften in ffmpeg-Filter.
// Läuft komplett lokal (ffmpeg.wasm) — kein API-Key nötig.
// ============================================================

import type { Segment, TextOverlay } from "./editor-types";

export type Aspect = "9:16" | "16:9" | "1:1";

export const ASPECT_SIZE: Record<Aspect, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
};

/** Sicheres Escaping für drawtext-Parameter */
export function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "")
    .replace(/'/g, "")
    .replace(/:/g, "\\:")
    .replace(/%/g, "")
    .replace(/,/g, "\\,");
}

/**
 * Bildkette für einen Clip: Format/Zuschnitt, Farbe, Zoom, Rotation,
 * Ein-/Ausblenden. Gibt eine kommaseparierte Filterkette zurück.
 */
export function buildVideoFilters(seg: Segment, aspect: Aspect, clipDuration: number): string {
  const { w, h } = ASPECT_SIZE[aspect];
  const f: string[] = [];

  // 1) Geschwindigkeit (setpts) — vor allem anderen
  const speed = seg.speed && seg.speed > 0 ? seg.speed : 1;
  if (speed !== 1) f.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);

  // 2) Rotation / Spiegeln
  const tr = seg.transform ?? {};
  if (tr.rotate === 90) f.push("transpose=1");
  else if (tr.rotate === 180) f.push("transpose=1,transpose=1");
  else if (tr.rotate === 270) f.push("transpose=2");
  if (tr.flip_h) f.push("hflip");

  // 3) Formatanpassung: beschneiden ODER unscharfer Hintergrund
  if (seg.fill_mode === "blur_pad") {
    // Querformat in Hochformat ohne Beschnitt: unscharfe Kopie als Hintergrund
    f.push(
      `split[bg][fg];[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=luma_radius=40:luma_power=2[bgb];` +
        `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2`,
    );
  } else if (aspect === "9:16") {
    f.push(`crop=ih*9/16:ih`, `scale=${w}:${h}`);
  } else if (aspect === "1:1") {
    f.push(`crop=ih:ih`, `scale=${w}:${h}`);
  } else {
    f.push(`scale=${w}:${h}`);
  }

  // 4) Farbkorrektur
  const c = seg.color ?? {};
  const eq: string[] = [];
  if (c.brightness !== undefined && c.brightness !== 0) eq.push(`brightness=${c.brightness}`);
  if (c.contrast !== undefined && c.contrast !== 1) eq.push(`contrast=${c.contrast}`);
  if (c.saturation !== undefined && c.saturation !== 1) eq.push(`saturation=${c.saturation}`);
  if (c.gamma !== undefined && c.gamma !== 1) eq.push(`gamma=${c.gamma}`);
  if (eq.length) f.push(`eq=${eq.join(":")}`);

  // 5) Ken-Burns-Zoom über die Clipdauer
  const z0 = tr.zoom_start ?? 1;
  const z1 = tr.zoom_end ?? z0;
  if (z0 !== 1 || z1 !== 1) {
    const frames = Math.max(1, Math.round(clipDuration * 30));
    const step = (z1 - z0) / frames;
    f.push(
      `zoompan=z='min(max(${z0}+${step.toFixed(6)}*on,1),4)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=30`,
    );
  }

  // 6) Ein-/Ausblenden (Bild)
  const fi = seg.fade_in_s ?? 0;
  const fo = seg.fade_out_s ?? 0;
  if (fi > 0) f.push(`fade=t=in:st=0:d=${fi}`);
  if (fo > 0) f.push(`fade=t=out:st=${Math.max(0, clipDuration - fo).toFixed(2)}:d=${fo}`);

  return f.join(",");
}

/** Tonkette für einen Clip: Tempo, Lautstärke, Ein-/Ausblenden */
export function buildAudioFilters(seg: Segment, clipDuration: number): string {
  const f: string[] = [];
  const speed = seg.speed && seg.speed > 0 ? seg.speed : 1;
  if (speed !== 1) {
    // atempo akzeptiert 0.5–2.0 → bei extremen Werten verketten
    let rest = speed;
    while (rest > 2) {
      f.push("atempo=2.0");
      rest /= 2;
    }
    while (rest < 0.5) {
      f.push("atempo=0.5");
      rest /= 0.5;
    }
    if (Math.abs(rest - 1) > 0.001) f.push(`atempo=${rest.toFixed(4)}`);
  }
  const vol = seg.muted ? 0 : (seg.volume ?? 1);
  if (vol !== 1) f.push(`volume=${vol}`);
  const fi = seg.fade_in_s ?? 0;
  const fo = seg.fade_out_s ?? 0;
  if (fi > 0) f.push(`afade=t=in:st=0:d=${fi}`);
  if (fo > 0) f.push(`afade=t=out:st=${Math.max(0, clipDuration - fo).toFixed(2)}:d=${fo}`);
  return f.join(",");
}

/** Text-Overlays eines Clips als drawtext-Kette */
export function buildDrawtext(
  overlays: TextOverlay[],
  clipIdx: number,
  offsetInOutput: number,
): string {
  return overlays
    .filter((o) => o.clip_index === clipIdx)
    .map((o) => {
      const t1 = (offsetInOutput + o.start_s).toFixed(2);
      const t2 = (offsetInOutput + o.end_s).toFixed(2);
      const y =
        o.position === "top" ? "h*0.08" : o.position === "center" ? "(h-text_h)/2" : "h*0.78";
      const box = o.bg ? ":box=1:boxcolor=black@0.55:boxborderw=18" : "";
      // Kontur macht Text ohne Box lesbar (Hormozi-Stil)
      const border = !o.bg ? ":borderw=4:bordercolor=black@0.9" : "";
      const safe = escapeDrawtext(o.text);
      return `drawtext=text='${safe}':fontsize=${o.font_size}:fontcolor=${o.color}${box}${border}:x=(w-text_w)/2:y=${y}:enable='between(t,${t1},${t2})'`;
    })
    .join(",");
}

/** Effektive Ausgabedauer eines Clips (Geschwindigkeit eingerechnet) */
export function outputDuration(seg: Segment): number {
  const raw = Math.max(0, seg.end_s - seg.start_s);
  const speed = seg.speed && seg.speed > 0 ? seg.speed : 1;
  return raw / speed;
}

/** Kurzbeschreibung der aktiven Effekte — für Badges in der UI */
export function effectSummary(seg: Segment): string[] {
  const out: string[] = [];
  if (seg.speed && seg.speed !== 1) out.push(`${seg.speed}×`);
  if (seg.reverse) out.push("rückwärts");
  if (seg.freeze_s != null) out.push("Standbild");
  if (seg.fade_in_s) out.push("Fade in");
  if (seg.fade_out_s) out.push("Fade out");
  if (seg.muted) out.push("stumm");
  else if (seg.volume != null && seg.volume !== 1)
    out.push(`Vol ${Math.round((seg.volume ?? 1) * 100)}%`);
  const c = seg.color ?? {};
  if (c.brightness || (c.contrast && c.contrast !== 1) || (c.saturation && c.saturation !== 1))
    out.push("Farbe");
  const tr = seg.transform ?? {};
  if ((tr.zoom_start ?? 1) !== 1 || (tr.zoom_end ?? 1) !== 1) out.push("Zoom");
  if (tr.rotate) out.push(`${tr.rotate}°`);
  if (tr.flip_h) out.push("gespiegelt");
  if (seg.fill_mode === "blur_pad") out.push("Blur-Rand");
  return out;
}
