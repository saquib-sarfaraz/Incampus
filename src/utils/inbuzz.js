const inBuzzReelCache = new Map();

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

const cleanHandle = (value) => {
  const text = cleanString(value);
  if (!text) return "";
  return text.startsWith("@") ? text.slice(1) : text;
};

const resolveId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return String(
      value.id ||
        value._id ||
        value.reelId ||
        value.reel_id ||
        value.userId ||
        value.user_id ||
        ""
    );
  }
  return "";
};

export const formatInBuzzCount = (value) => {
  const count = Number(value || 0);
  if (!Number.isFinite(count)) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 100_000 ? 0 : 1)}K`;
  return `${count}`;
};

export const getInBuzzShareUrl = (reelOrId) => {
  if (reelOrId && typeof reelOrId === "object") {
    if (reelOrId.shareUrl) return reelOrId.shareUrl;
    if (reelOrId.publicUrl) return reelOrId.publicUrl;
    if (reelOrId.share_url) return reelOrId.share_url;
    const nextId = resolveId(reelOrId);
    return nextId ? `/inbuzz/${nextId}` : "";
  }
  const reelId = resolveId(reelOrId);
  return reelId ? `/inbuzz/${reelId}` : "";
};

export const extractInBuzzId = (text = "") => {
  if (!text) return "";
  const match = String(text).match(/\b\/inbuzz(?:\/reel)?\/([a-zA-Z0-9_-]+)\b/);
  return match ? match[1] : "";
};

export const normalizeInBuzzAuthor = (author = null) => {
  if (!author || typeof author !== "object") return null;
  const id = resolveId(author);
  const fullName = cleanString(author.fullName) ||
    cleanString(author.full_name) ||
    cleanString(author.displayName) ||
    cleanString(author.display_name) ||
    cleanString(author.name) ||
    cleanString(author.fullname) ||
    [cleanString(author.firstName), cleanString(author.lastName)].filter(Boolean).join(" ") ||
    "";
  const username = cleanHandle(author.username) ||
    cleanHandle(author.userName) ||
    cleanHandle(author.user_name) ||
    cleanHandle(author.handle) ||
    cleanHandle(author.userHandle) ||
    cleanHandle(author.user_handle) ||
    "";
  return {
    ...author,
    id,
    fullName,
    username,
    profilePicUrl:
      author.profilePicUrl ||
      author.profilePic ||
      author.profile_picture ||
      author.profile_pic ||
      author.avatarUrl ||
      author.avatar ||
      author.photoURL ||
      author.photoUrl ||
      author.picture ||
      author.profileImage ||
      author.profile_image ||
      author.imageUrl ||
      "",
    collegeTagId: author.collegeTagId || author.college_id || author.collegeId || "",
    collegeTagName:
      author.collegeTagName || author.collegeName || author.college || author.university || "",
    isVerified: Boolean(author.isVerified),
  };
};

export const normalizeInBuzzReel = (raw = null) => {
  if (!raw || typeof raw !== "object") return null;
  const id = resolveId(raw);
  if (!id) return null;

  const authorSource =
    (raw.author && typeof raw.author === "object" ? raw.author : null) ||
    (raw.userId && typeof raw.userId === "object" ? raw.userId : null) ||
    (raw.user && typeof raw.user === "object" ? raw.user : null) ||
    (raw.creator && typeof raw.creator === "object" ? raw.creator : null);
  const author = normalizeInBuzzAuthor(authorSource);
  const userId =
    resolveId(raw.userId) ||
    resolveId(raw.user_id) ||
    resolveId(raw.authorId) ||
    resolveId(raw.author_id) ||
    author?.id ||
    "";
  const thumbnailUrl =
    raw.thumbnailUrl || raw.thumbnail_url || raw.thumbnail || raw.poster || "";
  const streamUrl = `/api/inbuzz/stream/${encodeURIComponent(id)}`;
  const shareUrl = getInBuzzShareUrl(raw);
  const rawUsername = cleanHandle(raw.username) ||
    cleanHandle(raw.userName) ||
    cleanHandle(raw.user_name) ||
    cleanHandle(raw.handle) ||
    cleanHandle(raw.userHandle) ||
    cleanHandle(raw.user_handle) ||
    cleanHandle(raw.creatorUsername) ||
    cleanHandle(raw.creator_handle) ||
    "";
  const rawDisplayName = cleanString(raw.displayName) ||
    cleanString(raw.display_name) ||
    cleanString(raw.fullName) ||
    cleanString(raw.full_name) ||
    cleanString(raw.name) ||
    [cleanString(raw.firstName), cleanString(raw.lastName)].filter(Boolean).join(" ") ||
    cleanString(raw.creatorName) ||
    cleanString(raw.creator_name) ||
    "";
  const username = author?.username || rawUsername || "";
  const displayName = author?.fullName || rawDisplayName || username || "";
  const profilePicUrl =
    author?.profilePicUrl ||
    raw.profilePicUrl ||
    raw.profilePic ||
    raw.profile_picture ||
    raw.profile_pic ||
    raw.avatarUrl ||
    raw.avatar ||
    raw.photoURL ||
    raw.photoUrl ||
    raw.imageUrl ||
    raw.image ||
    "";

  return {
    ...raw,
    id,
    userId,
    authorId: userId,
    caption: typeof raw.caption === "string" ? raw.caption : "",
    visibility: raw.visibility || "universal",
    collegeId: raw.collegeId || raw.college_id || "",
    thumbnail: thumbnailUrl,
    thumbnailUrl,
    videoUrl: streamUrl,
    streamUrl,
    shareUrl,
    publicUrl: raw.publicUrl || raw.public_url || shareUrl,
    likes: Number(raw.likes ?? raw.likesCount ?? raw.likes_count ?? 0),
    likesCount: Number(raw.likesCount ?? raw.likes_count ?? raw.likes ?? 0),
    comments: Number(raw.comments ?? raw.commentsCount ?? raw.comments_count ?? 0),
    commentsCount: Number(raw.commentsCount ?? raw.comments_count ?? raw.comments ?? 0),
    shares: Number(raw.shares ?? raw.sharesCount ?? raw.shares_count ?? 0),
    sharesCount: Number(raw.sharesCount ?? raw.shares_count ?? raw.shares ?? 0),
    views: Number(raw.views ?? raw.viewsCount ?? raw.views_count ?? 0),
    viewsCount: Number(raw.viewsCount ?? raw.views_count ?? raw.views ?? 0),
    isLiked: Boolean(raw.isLiked ?? raw.liked ?? raw.likedByViewer),
    author,
    username,
    displayName,
    profilePicUrl,
    createdAt: raw.createdAt || raw.created_at || null,
    updatedAt: raw.updatedAt || raw.updated_at || null,
    durationSeconds: Number(raw.durationSeconds || raw.duration || 0),
    isHiddenFromFeed: Boolean(raw.isHiddenFromFeed ?? raw.is_hidden_from_feed),
    isDeleted: Boolean(raw.isDeleted ?? raw.is_deleted),
    isFlagged: Boolean(raw.isFlagged ?? raw.is_flagged),
  };
};

export const cacheInBuzzReels = (reels = []) => {
  (Array.isArray(reels) ? reels : []).forEach((item) => {
    const reel = normalizeInBuzzReel(item);
    if (reel?.id) {
      inBuzzReelCache.set(String(reel.id), reel);
    }
  });
};

export const normalizeInBuzzList = (items = []) => {
  const reels = (Array.isArray(items) ? items : [])
    .map((item) => normalizeInBuzzReel(item))
    .filter(Boolean);
  cacheInBuzzReels(reels);
  return reels;
};

export const getCachedInBuzzReel = (reelId) => {
  if (!reelId) return null;
  return inBuzzReelCache.get(String(reelId)) || null;
};

export const getCachedInBuzzReelsByUser = (userId) => {
  if (!userId) return [];
  return Array.from(inBuzzReelCache.values())
    .filter((reel) => String(reel.userId || reel.author?.id || "") === String(userId))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
};
