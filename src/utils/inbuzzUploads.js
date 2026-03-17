const STORAGE_KEY = "incampus:inbuzz:pendingUploads";
const EVENT_NAME = "inbuzz:pendingUploads";

const safeJsonParse = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeList = (value) => (Array.isArray(value) ? value : []);

export const readPendingInBuzzUploads = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeList(safeJsonParse(raw, []));
  } catch {
    return [];
  }
};

export const writePendingInBuzzUploads = (uploads) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeList(uploads)));
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new Event(EVENT_NAME));
};

export const upsertPendingInBuzzUpload = (upload) => {
  if (!upload || typeof upload !== "object") return;
  const incomingId = upload.id || upload.clientUploadId || upload.jobId || "";
  if (!incomingId) return;
  const id = String(incomingId);
  const uploads = readPendingInBuzzUploads();
  const index = uploads.findIndex((item) => {
    const itemId = String(item?.id || "");
    const itemJob = String(item?.jobId || "");
    return itemId === id || itemJob === id;
  });
  const next = index >= 0
    ? uploads.map((item, idx) => (idx === index ? { ...item, ...upload } : item))
    : [{ ...upload }, ...uploads];
  writePendingInBuzzUploads(next.slice(0, 10)); // guard against unbounded growth
};

export const removePendingInBuzzUpload = (jobOrId) => {
  if (!jobOrId) return;
  const id = String(jobOrId);
  const uploads = readPendingInBuzzUploads();
  const next = uploads.filter((item) => {
    const itemId = String(item?.id || "");
    const itemJob = String(item?.jobId || "");
    return itemId !== id && itemJob !== id;
  });
  writePendingInBuzzUploads(next);
};

export const subscribePendingInBuzzUploads = (listener) => {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener?.();
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
};

export const clearExpiredPendingInBuzzUploads = (maxAgeMs = 6 * 60 * 60 * 1000) => {
  const now = Date.now();
  const uploads = readPendingInBuzzUploads();
  const next = uploads.filter((item) => {
    const createdAt = item?.createdAt || item?.created_at;
    const ts = createdAt ? new Date(createdAt).getTime() : NaN;
    if (Number.isNaN(ts)) return true;
    return now - ts <= maxAgeMs;
  });
  if (next.length !== uploads.length) writePendingInBuzzUploads(next);
};
