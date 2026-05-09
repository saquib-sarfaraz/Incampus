const safeJsonParse = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeList = (value) => (Array.isArray(value) ? value : []);

const clampList = (items, limit) => {
  const list = normalizeList(items);
  if (!Number.isFinite(limit) || limit <= 0) return list;
  return list.slice(0, limit);
};

const FEED_TTL_MS = 15 * 60 * 1000;
const FEED_LIMIT = 30;
const TRENDING_TTL_MS = 15 * 60 * 1000;
const TRENDING_LIMIT = 12;

const keyPart = (value) => (value ? String(value).trim() : "");

const buildFeedKey = ({ userId, scope }) => {
  const uid = keyPart(userId) || "anon";
  const sc = keyPart(scope) || "universal";
  return `incampus:inbuzz:feed:${uid}:${sc}`;
};

const buildTrendingKey = ({ userId }) => {
  const uid = keyPart(userId) || "anon";
  return `incampus:inbuzz:trending:${uid}`;
};

export const readInBuzzFeedSnapshot = ({ userId, scope } = {}) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(buildFeedKey({ userId, scope }));
    const parsed = safeJsonParse(raw, null);
    if (!parsed?.ts || Date.now() - parsed.ts > FEED_TTL_MS) return null;
    const items = clampList(parsed.items, FEED_LIMIT);
    return {
      items,
      nextCursor: parsed.nextCursor || "",
      hasMore: typeof parsed.hasMore === "boolean" ? parsed.hasMore : undefined,
    };
  } catch {
    return null;
  }
};

export const writeInBuzzFeedSnapshot = ({ userId, scope, items, nextCursor, hasMore } = {}) => {
  if (typeof window === "undefined") return;
  try {
    const payload = {
      ts: Date.now(),
      items: clampList(items, FEED_LIMIT),
      nextCursor: nextCursor || "",
      hasMore: typeof hasMore === "boolean" ? hasMore : undefined,
    };
    localStorage.setItem(buildFeedKey({ userId, scope }), JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
};

export const readInBuzzTrendingSnapshot = ({ userId } = {}) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(buildTrendingKey({ userId }));
    const parsed = safeJsonParse(raw, null);
    if (!parsed?.ts || Date.now() - parsed.ts > TRENDING_TTL_MS) return null;
    return clampList(parsed.items, TRENDING_LIMIT);
  } catch {
    return null;
  }
};

export const writeInBuzzTrendingSnapshot = ({ userId, items } = {}) => {
  if (typeof window === "undefined") return;
  try {
    const payload = { ts: Date.now(), items: clampList(items, TRENDING_LIMIT) };
    localStorage.setItem(buildTrendingKey({ userId }), JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
};

