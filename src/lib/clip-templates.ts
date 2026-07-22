export type ClipTemplateId =
  | "ugc_hook"
  | "podcast_snippet"
  | "story_time"
  | "talking_head"
  | "fast_reel"
  | "cinematic";

export type ClipTemplate = {
  id: ClipTemplateId;
  label: string;
  emoji: string;
  short: string;
  mode: "auto_cut" | "ugc_shorts" | "long_to_many" | "manual";
  aspect: "9:16" | "16:9" | "1:1";
  defaultCount: number | null;
  captions: boolean;
  musicMood: "hype" | "chill" | "cinematic" | "energetic" | "emotional" | "none";
  captionStyle: "burned_bottom" | "burned_center" | "karaoke" | "none";
  targetLenS: [number, number];
  hookRule: string;
};

export const CLIP_TEMPLATES: ClipTemplate[] = [
  {
    id: "ugc_hook",
    label: "UGC Hook Shorts",
    emoji: "🔥",
    short: "9:16 · 15–35s · starker Opener",
    mode: "ugc_shorts",
    aspect: "9:16",
    defaultCount: 10,
    captions: true,
    musicMood: "hype",
    captionStyle: "burned_center",
    targetLenS: [15, 35],
    hookRule: "Sekunde 0–2 = polarisierende Aussage oder Frage; danach Payoff.",
  },
  {
    id: "podcast_snippet",
    label: "Podcast Snippets",
    emoji: "🎙️",
    short: "9:16 · 30–60s · pointierte Aussage",
    mode: "long_to_many",
    aspect: "9:16",
    defaultCount: 15,
    captions: true,
    musicMood: "chill",
    captionStyle: "karaoke",
    targetLenS: [30, 60],
    hookRule: "Wähle Momente mit klarer These, kontroverser Meinung oder Story-Beat.",
  },
  {
    id: "story_time",
    label: "Story Time",
    emoji: "📖",
    short: "9:16 · 45–75s · narrativer Bogen",
    mode: "long_to_many",
    aspect: "9:16",
    defaultCount: 5,
    captions: true,
    musicMood: "emotional",
    captionStyle: "burned_bottom",
    targetLenS: [45, 75],
    hookRule: "Setup · Konflikt · Auflösung in einem Segment.",
  },
  {
    id: "talking_head",
    label: "Talking Head",
    emoji: "🗣️",
    short: "9:16 · 20–40s · Face-to-Cam",
    mode: "ugc_shorts",
    aspect: "9:16",
    defaultCount: 8,
    captions: true,
    musicMood: "none",
    captionStyle: "burned_center",
    targetLenS: [20, 40],
    hookRule: "Nur Passagen mit direktem Blick in die Kamera und klarer Botschaft.",
  },
  {
    id: "fast_reel",
    label: "Fast Reel",
    emoji: "⚡",
    short: "9:16 · 8–15s · schnelle Cuts",
    mode: "ugc_shorts",
    aspect: "9:16",
    defaultCount: 20,
    captions: false,
    musicMood: "energetic",
    captionStyle: "none",
    targetLenS: [8, 15],
    hookRule: "Nur die visuell stärksten 8–15s Ausschnitte, keine Redundanz.",
  },
  {
    id: "cinematic",
    label: "Cinematic Reel",
    emoji: "🎬",
    short: "16:9 · 30–60s · atmosphärisch",
    mode: "auto_cut",
    aspect: "16:9",
    defaultCount: 3,
    captions: false,
    musicMood: "cinematic",
    captionStyle: "none",
    targetLenS: [30, 60],
    hookRule: "Führe mit einer starken Weitwinkel- oder Detail-Aufnahme, halte Pacing ruhig.",
  },
];

export function templateById(id?: string | null): ClipTemplate | null {
  if (!id) return null;
  return CLIP_TEMPLATES.find((t) => t.id === id) ?? null;
}
