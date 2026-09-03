// Kuratierte, frei nutzbare Tracks (Pixabay Music, Content-Lizenz kostenfrei
// für kommerzielle Nutzung mit Namensnennung nicht erforderlich).
// Quelle: https://pixabay.com/music/ — Direkt-CDN unter cdn.pixabay.com/audio/…
// Diese Liste kann später gegen Epidemic Sound / Artlist / eigene Uploads
// getauscht werden — API-Anforderungen siehe README-Notiz in-app.

export type MusicMood = "hype" | "chill" | "cinematic" | "energetic" | "emotional" | "none";

export type ViralTrack = {
  id: string;
  title: string;
  artist: string;
  mood: MusicMood;
  bpm: number;
  duration_s: number;
  url: string;
  license: string;
};

export const MUSIC_LIBRARY: ViralTrack[] = [
  {
    id: "px-tropical-house-124",
    title: "Tropical House",
    artist: "Pixabay",
    mood: "hype",
    bpm: 124,
    duration_s: 155,
    url: "https://cdn.pixabay.com/download/audio/2022/03/15/audio_1718aa5be9.mp3",
    license: "Pixabay Content License",
  },
  {
    id: "px-vlog-beat-110",
    title: "Vlog Beat",
    artist: "Pixabay",
    mood: "energetic",
    bpm: 110,
    duration_s: 138,
    url: "https://cdn.pixabay.com/download/audio/2022/10/25/audio_946bc4b1e5.mp3",
    license: "Pixabay Content License",
  },
  {
    id: "px-hiphop-rolling-92",
    title: "Rolling Hip Hop",
    artist: "Pixabay",
    mood: "hype",
    bpm: 92,
    duration_s: 141,
    url: "https://cdn.pixabay.com/download/audio/2023/06/13/audio_1808fbf07a.mp3",
    license: "Pixabay Content License",
  },
  {
    id: "px-lofi-chill-72",
    title: "Lofi Chill",
    artist: "Pixabay",
    mood: "chill",
    bpm: 72,
    duration_s: 168,
    url: "https://cdn.pixabay.com/download/audio/2022/08/02/audio_884fe92c21.mp3",
    license: "Pixabay Content License",
  },
  {
    id: "px-ambient-piano-60",
    title: "Ambient Piano",
    artist: "Pixabay",
    mood: "emotional",
    bpm: 60,
    duration_s: 172,
    url: "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3",
    license: "Pixabay Content License",
  },
  {
    id: "px-cinematic-epic-100",
    title: "Cinematic Epic",
    artist: "Pixabay",
    mood: "cinematic",
    bpm: 100,
    duration_s: 155,
    url: "https://cdn.pixabay.com/download/audio/2022/03/10/audio_c8c8a73467.mp3",
    license: "Pixabay Content License",
  },
  {
    id: "px-inspiring-corp-120",
    title: "Inspiring Corporate",
    artist: "Pixabay",
    mood: "energetic",
    bpm: 120,
    duration_s: 148,
    url: "https://cdn.pixabay.com/download/audio/2023/03/16/audio_2a4a8b7c0e.mp3",
    license: "Pixabay Content License",
  },
  {
    id: "px-drift-emotion-80",
    title: "Emotional Drift",
    artist: "Pixabay",
    mood: "emotional",
    bpm: 80,
    duration_s: 174,
    url: "https://cdn.pixabay.com/download/audio/2022/11/22/audio_63f0f7f4c3.mp3",
    license: "Pixabay Content License",
  },
];

export function tracksForMood(mood: MusicMood): ViralTrack[] {
  if (mood === "none") return [];
  return MUSIC_LIBRARY.filter((t) => t.mood === mood);
}

export function suggestTrackForMood(mood: MusicMood): ViralTrack | null {
  const list = tracksForMood(mood);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}
