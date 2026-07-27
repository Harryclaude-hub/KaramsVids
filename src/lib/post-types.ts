// Welche Beitragsarten unterstützt welche Plattform (Reel, Story, Feed, Short …)

export type PostType = "reel" | "story" | "feed" | "short" | "video";

export const POST_TYPE_LABEL: Record<PostType, string> = {
  reel: "Reel",
  story: "Story",
  feed: "Feed-Post",
  short: "Short",
  video: "Video",
};

export const PLATFORM_POST_TYPES: Record<string, PostType[]> = {
  instagram: ["reel", "story", "feed"],
  facebook: ["reel", "story", "feed"],
  tiktok: ["video"],
  youtube: ["short", "video"],
  x: ["video"],
};

/** Standard-Beitragsart einer Plattform */
export function defaultPostType(platform: string): PostType {
  return (PLATFORM_POST_TYPES[platform]?.[0] ?? "video") as PostType;
}

/** Gültige Beitragsart für eine Plattform erzwingen */
export function normalizePostType(platform: string, wanted?: string | null): PostType {
  const allowed = PLATFORM_POST_TYPES[platform] ?? ["video"];
  return (allowed.includes((wanted ?? "") as PostType) ? wanted : allowed[0]) as PostType;
}
