const STORAGE_PREFIX = "incampus:anon-posts:";

const resolveIdValue = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") {
    const id = String(value).trim();
    return id || "";
  }
  if (typeof value === "object") {
    if (value.$oid) return String(value.$oid);
    const nested =
      value._id || value.id || value.postId || value.post_id || value.value || "";
    if (nested) return resolveIdValue(nested);
  }
  return "";
};

const normalizeEntry = (entry) => {
  if (!entry) return null;
  if (typeof entry === "string" || typeof entry === "number") {
    const id = resolveIdValue(entry);
    return id ? { id } : null;
  }
  if (typeof entry === "object") {
    const id = resolveIdValue(entry.id || entry._id || entry.postId || entry.post_id);
    if (id) return { id, post: entry.post || entry };
  }
  return null;
};

const readList = (userId) => {
  if (!userId || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(normalizeEntry).filter(Boolean)
      : [];
  } catch {
    return [];
  }
};

const writeList = (userId, list) => {
  if (!userId || typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(list));
  } catch {
    // ignore storage errors
  }
};

export const readAnonymousPostIds = (userId) => {
  return readList(userId)
    .map((entry) => String(entry?.id || "").trim())
    .filter(Boolean);
};

export const readAnonymousPosts = (userId) => {
  const uid = String(userId || "").trim();
  return readList(uid)
    .map((entry) => {
      const post = entry?.post;
      if (!post || typeof post !== "object") return null;
      const normalized = { ...post };
      if (!normalized.isAnonymous && !normalized.is_anonymous && !normalized.anonymous) {
        normalized.isAnonymous = true;
      }
      if (uid) {
        normalized.__localAuthorId = uid;
        if (!normalized.authorId && !normalized.author?.id && !normalized.author?._id) {
          normalized.authorId = uid;
        }
      }
      return normalized;
    })
    .filter(Boolean);
};

export const rememberAnonymousPost = (userId, post) => {
  const id = resolveIdValue(
    post?._id || post?.id || post?.postId || post?.post_id || post || ""
  );
  const uid = String(userId || "").trim();
  if (!uid || !id) return;
  const normalized =
    post && typeof post === "object"
      ? {
          ...post,
          isAnonymous: true,
          __localAuthorId: uid,
          authorId: post.authorId || uid,
        }
      : post;
  const existing = readList(uid);
  const index = existing.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    const next = [...existing];
    next[index] = {
      id,
      post: typeof normalized === "object" ? normalized : next[index].post,
    };
    writeList(uid, next);
    return;
  }
  writeList(
    uid,
    [
      { id, post: typeof normalized === "object" ? normalized : undefined },
      ...existing,
    ].slice(0, 200)
  );
};

export const forgetAnonymousPost = (userId, postId) => {
  const id = String(postId || "").trim();
  const uid = String(userId || "").trim();
  if (!uid || !id) return;
  const next = readList(uid).filter((entry) => String(entry?.id || "") !== id);
  writeList(uid, next);
};
