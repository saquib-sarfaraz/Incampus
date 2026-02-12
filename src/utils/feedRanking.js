const toNumber = (value) => {
  if (Array.isArray(value)) return value.length;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const resolveCreatedAt = (item) => {
  if (!item) return "";
  return (
    item.createdAt ||
    item.created_at ||
    item.timestamp ||
    item.time ||
    item.date ||
    item.publishedAt ||
    item.created ||
    ""
  );
};

export const getTimestamp = (item) => {
  const raw = resolveCreatedAt(item);
  if (!raw) return 0;
  const ts = new Date(raw).getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

export const hoursSince = (item) => {
  const ts = getTimestamp(item);
  if (!ts) return Number.POSITIVE_INFINITY;
  return (Date.now() - ts) / 36e5;
};

export const isWithinHours = (item, hours) => {
  if (!hours) return true;
  return hoursSince(item) <= hours;
};

export const getLikeCount = (item) => {
  if (!item) return 0;
  if (Array.isArray(item.likes)) return item.likes.length;
  return toNumber(item.likesCount ?? item.likeCount ?? item.likes ?? 0);
};

export const getCommentCount = (item) => {
  if (!item) return 0;
  if (Array.isArray(item.comments)) return item.comments.length;
  return toNumber(item.commentsCount ?? item.commentCount ?? item.comments ?? 0);
};

export const getShareCount = (item) => {
  if (!item) return 0;
  if (Array.isArray(item.shares)) return item.shares.length;
  return toNumber(
    item.sharesCount ??
      item.shareCount ??
      item.shares ??
      item.repostsCount ??
      item.repostCount ??
      0
  );
};

export const getViewCount = (item) => {
  if (!item) return 0;
  if (Array.isArray(item.views)) return item.views.length;
  return toNumber(
    item.viewsCount ??
      item.viewCount ??
      item.views ??
      item.impressions ??
      item.viewersCount ??
      0
  );
};

export const getSaveCount = (item) => {
  if (!item) return 0;
  if (Array.isArray(item.saves)) return item.saves.length;
  return toNumber(
    item.savesCount ??
      item.saveCount ??
      item.saves ??
      item.bookmarksCount ??
      item.bookmarkCount ??
      item.bookmarks ??
      0
  );
};

export const getStoryViewCount = (item) => {
  if (!item) return 0;
  if (Array.isArray(item.views)) return item.views.length;
  if (Array.isArray(item.viewers)) return item.viewers.length;
  return toNumber(item.viewsCount ?? item.viewCount ?? item.storyViews ?? 0);
};

export const getUniversalRecencyBoost = (dateValue) => {
  if (!dateValue) return 0;
  const createdAt = new Date(dateValue).getTime();
  if (Number.isNaN(createdAt)) return 0;
  const hours = (Date.now() - createdAt) / 36e5;
  if (hours < 2) return 40;
  if (hours < 6) return 25;
  if (hours < 24) return 10;
  return 0;
};

export const getUniversalScore = (item) => {
  const likes = getLikeCount(item);
  const comments = getCommentCount(item);
  const shares = getShareCount(item);
  const views = getViewCount(item);
  const createdAt = resolveCreatedAt(item);
  return likes * 3 + comments * 4 + shares * 5 + views * 1 + getUniversalRecencyBoost(createdAt);
};

export const getVelocityBoost = (item, { threshold = 50 } = {}) => {
  if (!item) return 0;
  const lastHour = toNumber(
    item.engagementLastHour ??
      item.engagement_last_hour ??
      item.lastHourEngagement ??
      item.last_hour_engagement ??
      item.velocityLastHour ??
      item.velocity_last_hour ??
      0
  );
  const velocity = toNumber(
    item.engagementVelocity ??
      item.engagement_velocity ??
      item.velocity ??
      item.velocityScore ??
      0
  );
  return lastHour >= threshold || velocity >= threshold ? 50 : 0;
};

export const getTrendingScore = (
  item,
  { isStory = false, velocityThreshold = 50 } = {}
) => {
  if (item && item.trendingScore !== undefined && item.trendingScore !== null) {
    const direct = Number(item.trendingScore);
    if (Number.isFinite(direct)) return direct;
  }
  if (item && item.trending_score !== undefined && item.trending_score !== null) {
    const direct = Number(item.trending_score);
    if (Number.isFinite(direct)) return direct;
  }
  const likes = getLikeCount(item);
  const comments = getCommentCount(item);
  const shares = getShareCount(item);
  const saves = getSaveCount(item);
  const storyViews = isStory ? getStoryViewCount(item) : 0;
  const velocityBoost = getVelocityBoost(item, { threshold: velocityThreshold });
  return likes * 4 + comments * 5 + shares * 6 + saves * 4 + storyViews * 2 + velocityBoost;
};

export const resolveContentType = (item) => {
  if (!item) return "post";
  const raw = String(
    item.contentType ||
      item.type ||
      item.kind ||
      item.postType ||
      item.entryType ||
      item.mediaType ||
      ""
  ).toLowerCase();
  if (raw.includes("story")) return "story";
  if (raw.includes("thought")) return "thought_text";
  if (raw.includes("text")) return "thought_text";
  if (raw.includes("post")) return "post";

  if (item.storyId || item.story_id || item.expiresAt || item.expires_at) {
    return "story";
  }

  const hasMedia = Boolean(
    item.mediaUrl ||
      item.imageUrl ||
      item.videoUrl ||
      item.media?.url ||
      item.media?.secure_url ||
      item.media?.secureUrl
  );
  if (!hasMedia && item.content) return "thought_text";
  return "post";
};

export const shouldExcludeContent = (item) => {
  if (!item || typeof item !== "object") return false;
  const status = String(
    item.status || item.state || item.moderationStatus || item.moderation_state || ""
  ).toLowerCase();
  if (
    [
      "deleted",
      "removed",
      "banned",
      "shadow_banned",
      "shadowbanned",
      "disabled",
    ].includes(status)
  ) {
    return true;
  }
  if (
    item.isDeleted ||
    item.deleted ||
    item.removed ||
    item.isRemoved ||
    item.isShadowBanned ||
    item.shadowBanned ||
    item.shadow_banned
  ) {
    return true;
  }
  if (
    item.isReportedHighRisk ||
    item.reportedHighRisk ||
    item.reportRisk === "high" ||
    item.reportRiskLevel === "high"
  ) {
    return true;
  }
  const reportCount = toNumber(
    item.reportCount ??
      item.reportsCount ??
      item.flagsCount ??
      item.flagCount ??
      item.reportedCount ??
      0
  );
  if (reportCount >= 5) return true;
  const riskScore = Number(item.reportRiskScore ?? item.reportScore ?? item.report_score ?? 0);
  if (!Number.isNaN(riskScore) && riskScore >= 0.8) return true;
  return false;
};

export const isMutedByUser = (item, userId) => {
  if (!item || !userId) return false;
  if (item.isMuted || item.muted === true) return true;
  const mutedBy = item.mutedBy || item.muted_by || item.mutedUsers || [];
  if (Array.isArray(mutedBy)) {
    return mutedBy.some((id) => String(id) === String(userId));
  }
  return false;
};
