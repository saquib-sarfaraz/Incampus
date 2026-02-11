export const isVideoUrl = (url = "") => {
  const safeUrl = String(url || "");
  return (
    /\.(mp4|webm|ogg|mov|m4v)$/i.test(safeUrl) ||
    safeUrl.includes("video") ||
    safeUrl.includes("m3u8")
  );
};

export const resolveStoryMediaUrl = (story) => {
  if (!story) return "";
  const nested =
    story.story ||
    story.data ||
    story.item ||
    story.storyData ||
    story.story_item ||
    null;
  if (nested && nested !== story) {
    const nestedUrl = resolveStoryMediaUrl(nested);
    if (nestedUrl) return nestedUrl;
  }
  if (typeof story.media?.url === "string") return story.media.url;
  if (typeof story.media?.secure_url === "string") return story.media.secure_url;
  if (typeof story.media?.secureUrl === "string") return story.media.secureUrl;
  if (typeof story.media?.publicUrl === "string") return story.media.publicUrl;
  if (typeof story.media?.fileUrl === "string") return story.media.fileUrl;
  if (typeof story.media?.path === "string") return story.media.path;
  if (typeof story.media?.src === "string") return story.media.src;
  if (Array.isArray(story.media) && story.media.length > 0) {
    const entry = story.media[0];
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") {
      return (
        entry.url ||
        entry.secure_url ||
        entry.secureUrl ||
        entry.publicUrl ||
        entry.fileUrl ||
        entry.path ||
        entry.src ||
        ""
      );
    }
  }
  const rawUrl =
    story.mediaUrl ||
    story.mediaURL ||
    story.media_url ||
    story.mediaPath ||
    story.media ||
    story.url ||
    story.storyUrl ||
    story.storyMediaUrl ||
    story.story_media_url ||
    story.storyMediaURL ||
    story.mediaSecureUrl ||
    story.secureUrl ||
    story.secure_url ||
    story.fileUrl ||
    story.file ||
    story.imageUrl ||
    story.image ||
    story.imgUrl ||
    story.img ||
    story.videoUrl ||
    story.video ||
    story.video_url ||
    story.assetUrl ||
    story.asset_url ||
    story.downloadUrl ||
    story.download_url ||
    story.publicUrl ||
    story.public_url ||
    "";

  if (!rawUrl) return "";
  if (Array.isArray(rawUrl) && rawUrl.length > 0) {
    const entry = rawUrl[0];
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") {
      return (
        entry.url ||
        entry.secure_url ||
        entry.secureUrl ||
        entry.publicUrl ||
        entry.fileUrl ||
        entry.path ||
        entry.src ||
        ""
      );
    }
  }
  if (typeof rawUrl === "object") {
    return (
      rawUrl.url ||
      rawUrl.secure_url ||
      rawUrl.secureUrl ||
      rawUrl.publicUrl ||
      rawUrl.fileUrl ||
      rawUrl.path ||
      rawUrl.src ||
      ""
    );
  }
  if (typeof rawUrl !== "string") return "";
  if (
    rawUrl.startsWith("http://") ||
    rawUrl.startsWith("https://") ||
    rawUrl.startsWith("blob:") ||
    rawUrl.startsWith("data:")
  ) {
    return rawUrl;
  }
  if (rawUrl.startsWith("//")) {
    return `${window.location.protocol}${rawUrl}`;
  }

  const apiBase = import.meta.env.VITE_API_URL || "";
  const normalizedBase = apiBase.replace(/\/api\/?$/, "");
  const prefix = normalizedBase || window.location.origin;
  const needsSlash = rawUrl.startsWith("/") ? "" : "/";
  return `${prefix}${needsSlash}${rawUrl}`;
};

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (value.$oid) return String(value.$oid);
    if (value._id) return normalizeId(value._id);
    if (value.id) return normalizeId(value.id);
    if (value._bsontype && typeof value.toString === "function") {
      const asString = value.toString();
      if (asString && asString !== "[object Object]") return asString;
    }
    if (typeof value.toString === "function") {
      const asString = value.toString();
      if (asString && asString !== "[object Object]") return asString;
    }
  }
  return "";
};

export const resolveStoryId = (story) => {
  if (!story) return "";
  const direct = normalizeId(
    story._id ||
      story.id ||
      story.storyId ||
      story.story_id ||
      story.mediaId ||
      story.fileId ||
      ""
  );
  if (direct) return direct;
  const nested =
    story.story ||
    story.data ||
    story.item ||
    story.storyData ||
    story.story_item ||
    null;
  if (!nested) return "";
  return normalizeId(
    nested._id ||
      nested.id ||
      nested.storyId ||
      nested.story_id ||
      nested.mediaId ||
      nested.fileId ||
      ""
  );
};

export const resolveStoryMediaType = (story, mediaUrl = "") => {
  if (!story) return "image";
  const rawType =
    story.type ||
    story.mediaType ||
    story.fileType ||
    story.mimeType ||
    story.contentType ||
    story.story?.type ||
    story.story?.mediaType ||
    story.story?.fileType ||
    story.story?.mimeType ||
    story.story?.contentType ||
    "";
  if (typeof rawType === "string") {
    if (rawType.toLowerCase().includes("video")) return "video";
    if (rawType.toLowerCase().includes("image")) return "image";
  }
  return isVideoUrl(mediaUrl) ? "video" : "image";
};

const DAY_MS = 24 * 60 * 60 * 1000;

const resolveStoryTimestamp = (story) => {
  if (!story) return null;
  const raw =
    story.createdAt ||
    story.created_at ||
    story.timestamp ||
    story.created ||
    story.time ||
    story.date ||
    "";
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : time;
};

export const isStoryRecent = (story, now = Date.now()) => {
  const time = resolveStoryTimestamp(story);
  if (time === null) return true;
  return Math.abs(now - time) <= DAY_MS;
};

const resolveStoryViewTimestamp = (view) => {
  if (!view) return null;
  const raw =
    view.viewedAt ||
    view.viewed_at ||
    view.createdAt ||
    view.created_at ||
    view.timestamp ||
    view.time ||
    view.date ||
    "";
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : time;
};

export const isStoryViewRecent = (view, now = Date.now()) => {
  const time = resolveStoryViewTimestamp(view);
  if (time === null) return true;
  return Math.abs(now - time) <= DAY_MS;
};
