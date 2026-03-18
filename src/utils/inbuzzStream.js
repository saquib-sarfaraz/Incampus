const normalizeBaseUrl = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
};

const normalizeToken = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  return raw.startsWith("Bearer ") ? raw.slice(7) : raw;
};

const resolveApiBase = () => {
  // In dev we prefer the Vite `/api` proxy (avoids CORS and works on LAN phone testing).
  if (import.meta.env.DEV) return "";
  const origin = normalizeBaseUrl(
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || ""
  );
  if (!origin) return "";
  return origin.endsWith("/api") ? origin : `${origin}/api`;
};

// Primary: clean URL without token
// Fallback: append ?token= when provided
export const getStreamUrl = (reelId, token) => {
  const id = reelId === undefined || reelId === null ? "" : String(reelId).trim();
  if (!id) return "";

  const base = resolveApiBase();
  const encodedId = encodeURIComponent(id);
  const path = `/inbuzz/stream/${encodedId}`;

  let url = base ? `${base}${path}` : `/api${path}`;
  const accessToken = normalizeToken(token);
  if (accessToken) {
    url = `${url}?token=${encodeURIComponent(accessToken)}`;
  }
  return url;
};

// Backwards compatibility (older code may import this name).
export const getReelStreamUrl = getStreamUrl;
