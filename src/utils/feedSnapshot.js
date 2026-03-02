const FEED_SNAPSHOT_KEY = "incampus:feed:snapshot:universal";
const FEED_SNAPSHOT_TTL = 5 * 60 * 1000;

export const readFeedSnapshotPosts = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FEED_SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - parsed.ts > FEED_SNAPSHOT_TTL) return [];
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
};
