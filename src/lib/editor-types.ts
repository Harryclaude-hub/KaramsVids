/** Farb-/Bildkorrektur pro Clip (wie Premiere Lumetri, vereinfacht) */
export type ClipColor = {
  brightness?: number; // -1 … 1   (ffmpeg eq)
  contrast?: number; // 0 … 3
  saturation?: number; // 0 … 3
  gamma?: number; // 0.1 … 3
};

/** Bewegung/Transform pro Clip — Ken-Burns-Zoom, Skalierung, Rotation */
export type ClipTransform = {
  zoom_start?: number; // 1 = keine Skalierung
  zoom_end?: number; // ≠ zoom_start ⇒ langsamer Zoom über den Clip
  rotate?: 0 | 90 | 180 | 270;
  flip_h?: boolean;
};

export type Segment = {
  start_s: number;
  end_s: number;
  title: string;
  hook?: string;
  captions?: string;

  // --- Profi-Eigenschaften (alle optional, lokal via ffmpeg gerendert) ---
  speed?: number; // 0.25 … 4 (1 = normal)
  volume?: number; // 0 … 2 (Clip-Lautstärke, 1 = normal)
  reverse?: boolean; // Clip rückwärts abspielen
  freeze_s?: number | null; // Standbild ab dieser Sekunde (relativ), 0 = Clipanfang
  fade_in_s?: number; // Bild+Ton einblenden
  fade_out_s?: number; // Bild+Ton ausblenden
  color?: ClipColor;
  transform?: ClipTransform;
  /** Bei Hochformat aus Querformat: Hintergrund unscharf gefüllt statt beschnitten */
  fill_mode?: "crop" | "blur_pad";
  muted?: boolean;
};

/** Marker auf der Timeline (wie Premiere Marker) */
export type Marker = { id: string; t: number; label: string; color?: string };

/** Untertitel-/Text-Stilvorlagen (CapCut-/Hormozi-artig) */
export type CaptionPreset = {
  id: string;
  label: string;
  font_size: number;
  color: string;
  bg: boolean;
  outline?: boolean;
  uppercase?: boolean;
};

export const CAPTION_PRESETS: CaptionPreset[] = [
  { id: "clean", label: "Clean", font_size: 42, color: "#ffffff", bg: true },
  {
    id: "hormozi",
    label: "Hormozi (fett, gelb)",
    font_size: 62,
    color: "#FFE600",
    bg: false,
    outline: true,
    uppercase: true,
  },
  { id: "bold", label: "Bold Weiß", font_size: 56, color: "#ffffff", bg: false, outline: true },
  { id: "neon", label: "Neon Türkis", font_size: 52, color: "#00F0C0", bg: false, outline: true },
  { id: "subtle", label: "Dezent klein", font_size: 32, color: "#ffffff", bg: true },
];

export type TransitionType = "cut" | "fade" | "crossfade";
export type Transition = { after_index: number; type: TransitionType; duration_s: number };

export type TextOverlay = {
  id: string;
  clip_index: number; // clip on video track this belongs to
  start_s: number; // relative to clip start
  end_s: number;
  text: string;
  position: "top" | "center" | "bottom";
  font_size: number;
  color: string;
  bg: boolean;
};

export type AudioTrack = {
  id: string;
  storage_path: string; // leer, wenn source_url gesetzt (Bibliothek/URL)
  source_url?: string; // externer Direkt-URL (z.B. Pixabay/CDN)
  name: string;
  volume: number; // 0..1
  duck: boolean;
};

export type YouTubeHost = "youtube" | "tiktok" | "instagram" | "facebook" | "x" | "vimeo" | null;

export function detectRestrictedHost(url: string): YouTubeHost {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (h.includes("youtube") || h === "youtu.be") return "youtube";
    if (h.includes("tiktok")) return "tiktok";
    if (h.includes("instagram")) return "instagram";
    if (h.includes("facebook") || h === "fb.watch") return "facebook";
    if (h === "x.com" || h.includes("twitter")) return "x";
    if (h.includes("vimeo")) return "vimeo";
    return null;
  } catch {
    return null;
  }
}

export function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|mkv|m4v)(\?|$)/i.test(url);
}
