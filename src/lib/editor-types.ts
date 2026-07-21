export type Segment = {
  start_s: number;
  end_s: number;
  title: string;
  hook?: string;
  captions?: string;
};

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
  storage_path: string;
  name: string;
  volume: number; // 0..1
  duck: boolean;
};

export type YouTubeHost =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "facebook"
  | "x"
  | "vimeo"
  | null;

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
