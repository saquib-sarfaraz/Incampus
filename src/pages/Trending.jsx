import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion as Motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/useApp";
import { useAuth } from "../context/authContext";
import { searchAll, searchUsers, likePost, fetchRankedFeedPage } from "../services/api";
import Header from "../components/common/Header";
import BottomNav from "../components/common/BottomNav";
import CreatePostModal from "../components/feed/CreatePostModal";
import CommentModal from "../components/feed/CommentModal";
import PostModal from "../components/profile/PostModal";
import ShareSheet from "../components/common/ShareSheet";
import ShareToChatModal from "../components/common/ShareToChatModal";
import StoryViewer from "../components/stories/StoryViewer";
import BlueTick from "../components/common/BlueTick";
import Post from "../components/feed/Post";
import {
  isVideoUrl,
  resolveStoryMediaType,
  resolveStoryMediaUrl,
  isStoryRecent,
  resolveStoryPrivacyType,
} from "../utils/storyMedia";
import {
  getTrendingScore as calculateTrendingScore,
  getTimestamp,
  resolveContentType,
  shouldExcludeContent,
  isContentUnderReview,
  isMutedByUser,
} from "../utils/feedRanking";
import {
  resolveStudentType,
  formatStudentType,
  resolveCollegeName,
  resolveUserBio,
  isUserAnonymous,
  resolveUserType,
  formatUserType,
  resolveCommunityType,
  formatCommunityType,
  resolveCommunityDescription,
  resolveCommunityName,
  buildUserPreview,
  normalizeUserId,
} from "../utils/userProfile";
import { getOptimizedMediaUrl, getOptimizedVideoUrl, getMediaSrcSet } from "../utils/media";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_CACHE_LIMIT = 5;
const SEARCH_CACHE_TTL = 60 * 1000;
const TRENDING_TTL = 60 * 1000;
const TRENDING_WINDOW_OPTIONS = [
  { id: "48h", label: "Last 48 Hours", hours: 48 },
  { id: "7d", label: "Last 7 Days", hours: 168 },
];
const TRENDING_TABS = [
  { id: "all", label: "🔥 All" },
  { id: "thoughts", label: "📝 Thoughts" },
  { id: "posts", label: "📸 Posts" },
  { id: "stories", label: "🎬 Stories" },
];
const TRENDING_VIEWS = [
  { id: "grid", label: "Grid" },
  { id: "doom", label: "Doom Scroll" },
];
const TRENDING_BATCH = 20;
const TRENDING_MAX_VISIBLE = Number.MAX_SAFE_INTEGER;
const TRENDING_PAGE_LIMIT = 20;
const TRENDING_PREFETCH_THRESHOLD = 2;

const resolvePostIdentity = (post) => {
  if (!post) return "";
  const id = post?._id || post?.id || post?.postId || post?.post_id;
  if (id) return String(id);
  const authorId =
    post?.authorId ||
    post?.author_id ||
    post?.userId ||
    post?.user_id ||
    post?.author?._id ||
    post?.author?.id ||
    "";
  const createdAt =
    post?.createdAt || post?.created_at || post?.timestamp || post?.time || "";
  if (authorId || createdAt) return `${authorId || "post"}-${createdAt || "time"}`;
  return "";
};

const resolveCursorValue = (post) => {
  if (!post) return "";
  const id = post?._id || post?.id || post?.postId || post?.post_id;
  if (id) return String(id);
  const createdAt = post?.createdAt || post?.created_at || post?.timestamp || "";
  if (createdAt) return String(createdAt);
  return "";
};

const mergePostsById = (primary, secondary) => {
  const first = Array.isArray(primary) ? primary : [];
  const second = Array.isArray(secondary) ? secondary : [];
  if (first.length === 0) return second;
  if (second.length === 0) return first;
  const next = [];
  const seen = new Set();
  first.forEach((post) => {
    const id = resolvePostIdentity(post);
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    next.push(post);
  });
  second.forEach((post) => {
    const id = resolvePostIdentity(post);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    next.push(post);
  });
  return next;
};

const appendUniquePosts = (base, incoming) => {
  const current = Array.isArray(base) ? base : [];
  const next = [...current];
  const seen = new Set(current.map(resolvePostIdentity).filter(Boolean));
  (Array.isArray(incoming) ? incoming : []).forEach((post) => {
    const id = resolvePostIdentity(post);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    next.push(post);
  });
  return next;
};

const normalizeRankedResponse = (response) => {
  if (Array.isArray(response)) {
    return { items: response, nextCursor: "", hasMore: undefined };
  }
  const items = Array.isArray(response?.items)
    ? response.items
    : Array.isArray(response?.posts)
      ? response.posts
      : Array.isArray(response?.data)
        ? response.data
        : [];
  return {
    items,
    nextCursor: response?.nextCursor || response?.next_cursor || response?.cursor || "",
    hasMore:
      typeof response?.hasMore === "boolean"
        ? response.hasMore
        : typeof response?.data?.hasMore === "boolean"
          ? response.data.hasMore
          : undefined,
  };
};

const resolveAuthorEntity = (item) =>
  item?.author ||
  item?.user ||
  item?.owner ||
  item?.createdBy ||
  item?.postedBy ||
  item?.creator ||
  null;

const resolveAuthorId = (item) => {
  const direct =
    item?.authorId ||
    item?.author_id ||
    item?.userId ||
    item?.user_id ||
    item?.ownerId ||
    item?.owner_id ||
    item?.createdById ||
    item?.created_by ||
    item?.postedById ||
    item?.creatorId ||
    "";
  if (direct) return direct;
  const entity = resolveAuthorEntity(item);
  return entity?._id || entity?.id || entity || "";
};

const resolveAuthorName = (item, cachedUser, isAnonymous) => {
  if (isAnonymous) return "Anonymous Student";
  const entity = resolveAuthorEntity(item);
  return (
    item?.authorDisplayName ||
    item?.authorName ||
    item?.authorFullName ||
    item?.userDisplayName ||
    item?.userName ||
    item?.userFullName ||
    entity?.displayName ||
    entity?.fullName ||
    entity?.name ||
    entity?.username ||
    cachedUser?.displayName ||
    cachedUser?.fullName ||
    cachedUser?.name ||
    cachedUser?.username ||
    "User"
  );
};

const resolveAuthorAvatar = (item, cachedUser, isAnonymous) => {
  if (isAnonymous) return ANONYMOUS_AVATAR;
  const entity = resolveAuthorEntity(item);
  return (
    item?.authorProfilePic ||
    item?.authorAvatar ||
    item?.userProfilePic ||
    item?.userAvatar ||
    entity?.profilePicUrl ||
    entity?.profilePic ||
    entity?.avatarUrl ||
    entity?.avatar ||
    cachedUser?.profilePicUrl ||
    ANONYMOUS_AVATAR
  );
};

const resolveAuthorVerified = (item, cachedUser, isAnonymous) => {
  if (isAnonymous) return false;
  const entity = resolveAuthorEntity(item);
  return Boolean(
    item?.authorIsVerified ||
      item?.authorVerified ||
      item?.userIsVerified ||
      item?.userVerified ||
      item?.isVerifiedCommunity ||
      item?.verifiedCommunity ||
      item?.communityVerified ||
      item?.isVerified ||
      item?.verified ||
      item?.is_verified ||
      item?.verification?.status === "verified" ||
      entity?.isVerified ||
      entity?.isVerifiedCommunity ||
      entity?.verifiedCommunity ||
      entity?.communityVerified ||
      entity?.verified ||
      entity?.is_verified ||
      entity?.verification?.status === "verified" ||
      cachedUser?.isVerified ||
      cachedUser?.isVerifiedCommunity ||
      cachedUser?.verifiedCommunity ||
      cachedUser?.communityVerified ||
      cachedUser?.verified ||
      cachedUser?.is_verified ||
      cachedUser?.verification?.status === "verified"
  );
};

const resolveLikeIds = (likes = []) => {
  if (!Array.isArray(likes)) return [];
  return likes
    .map((like) =>
      String(
        like?._id ||
          like?.id ||
          like?.userId ||
          like?.user ||
          like?.authorId ||
          like?.author ||
          like ||
          ""
      )
    )
    .filter(Boolean);
};

const resolvePostIsLiked = (post, currentUserId, likeIds = []) => {
  if (!post || !currentUserId) return false;
  const normalizedIds = Array.isArray(likeIds) ? likeIds : [];
  const hasLikeId = normalizedIds.some(
    (id) => String(id) === String(currentUserId)
  );
  const directFlag =
    post.likedByMe ??
    post.isLikedByMe ??
    post.liked_by_me ??
    post.isLiked ??
    post.liked ??
    post.hasLiked;
  if (typeof directFlag === "boolean") return hasLikeId || directFlag;
  return hasLikeId;
};

const resolveLikesMeta = (post) => {
  if (!post) return { ids: [], count: 0, shouldUseList: false };
  const rawList = Array.isArray(post.likes)
    ? post.likes
    : Array.isArray(post.likedBy)
      ? post.likedBy
      : Array.isArray(post.liked_by)
        ? post.liked_by
        : null;
  const ids = resolveLikeIds(rawList);
  const listCount = rawList ? rawList.length : null;
  const numeric = Number(post.likesCount ?? post.likeCount ?? post.likes ?? 0);
  const count =
    listCount !== null
      ? Number.isFinite(numeric) && numeric > listCount
        ? numeric
        : listCount
      : Number.isFinite(numeric)
        ? numeric
        : 0;
  const shouldUseList =
    Array.isArray(rawList) && (!Number.isFinite(numeric) || numeric <= listCount);
  return { ids, count, shouldUseList };
};

const getLikeCount = (post) => resolveLikesMeta(post).count;

const getCommentCount = (post) => {
  if (Array.isArray(post.comments)) return post.comments.length;
  return Number(post.commentsCount || post.commentCount || 0);
};

const getSaveCount = (post) => {
  if (Array.isArray(post.saves)) return post.saves.length;
  return Number(
    post.savesCount ||
      post.saveCount ||
      post.bookmarksCount ||
      post.bookmarkCount ||
      post.bookmarks ||
      0
  );
};

const getShareCount = (post) => {
  if (Array.isArray(post.shares)) return post.shares.length;
  return Number(
    post.shareCount ||
      post.sharesCount ||
      post.shares ||
      post.repostsCount ||
      post.repostCount ||
      0
  );
};

const getStoryViewCount = (story) => {
  return Number(
    story.viewsCount ||
      story.viewCount ||
      (Array.isArray(story.views) ? story.views.length : 0) ||
      (Array.isArray(story.viewers) ? story.viewers.length : 0) ||
      0
  );
};

const resolvePostPrivacy = (post) => {
  const raw = String(
    post.visibility ||
      post.privacy ||
      post.privacyType ||
      post.postVisibility ||
      post.audience ||
      ""
  ).toLowerCase();
  if (raw.includes("friend") || raw.includes("private")) return "friends";
  if (raw.includes("college") || raw.includes("campus")) return "college";
  if (raw.includes("universal") || raw.includes("public")) return "public";
  if (post.friendsOnly === true || post.isPrivate === true || post.private === true) {
    return "friends";
  }
  if (post.collegeOnly === true || post.campusOnly === true) {
    return "college";
  }
  return "public";
};

const resolvePostMediaUrl = (post) => {
  if (!post) return "";
  return (
    post.mediaUrl ||
    post.media?.url ||
    post.media?.secure_url ||
    post.media?.secureUrl ||
    post.media?.publicUrl ||
    post.imageUrl ||
    post.image ||
    post.videoUrl ||
    post.video ||
    post.fileUrl ||
    post.file ||
    ""
  );
};

const resolveTrendingId = (item) =>
  item?._id ||
  item?.id ||
  item?.storyId ||
  item?.story_id ||
  item?.postId ||
  item?.post_id ||
  "";

const resolveTrendingKey = (item, type, index = 0) => {
  const id = resolveTrendingId(item);
  if (id) return `${type}:${id}`;
  const timestamp = getTimestamp(item);
  return `${type}:${timestamp || "idx"}:${index}`;
};

const DEFAULT_SEARCH_RESULTS = {
  users: [],
  posts: [],
  communities: [],
  topResult: null,
};

const extractList = (payload, keys) => {
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
};

const isUserLike = (item) => {
  if (!item || typeof item !== "object") return false;
  return Boolean(
    item.fullName ||
      item.displayName ||
      item.username ||
      item.profilePicUrl ||
      item.userType ||
      item.studentType
  );
};

const isPostLike = (item) => {
  if (!item || typeof item !== "object") return false;
  return Boolean(
    item.content ||
      item.mediaUrl ||
      item.imageUrl ||
      item.videoUrl ||
      item.isAnonymous !== undefined ||
      item.visibility ||
      item.postId
  );
};

const splitMixedResults = (items) => {
  const users = [];
  const posts = [];
  const communities = [];

  items.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const type = String(item.type || item.kind || "").toLowerCase();
    if (type === "community" || type === "group") {
      communities.push(item);
      return;
    }
    if (type === "post") {
      posts.push(item);
      return;
    }
    if (type === "user" || type === "profile") {
      users.push(item);
      return;
    }
    const looksLikePost = isPostLike(item);
    const looksLikeUser = isUserLike(item);
    if (looksLikePost && !looksLikeUser) {
      posts.push(item);
      return;
    }
    if (looksLikeUser && !looksLikePost) {
      users.push(item);
      return;
    }
    if (looksLikeUser) {
      users.push(item);
      return;
    }
    if (looksLikePost) {
      posts.push(item);
    }
  });

  return { users, posts, communities };
};

const normalizeSearchPayload = (payload) => {
  if (!payload) return { ...DEFAULT_SEARCH_RESULTS };
  if (Array.isArray(payload)) {
    return { ...DEFAULT_SEARCH_RESULTS, users: payload };
  }

  let users = extractList(payload, [
    "users",
    "people",
    "profiles",
    "userResults",
    "userItems",
  ]);
  let posts = extractList(payload, ["posts", "postResults", "postItems"]);
  let communities = extractList(payload, ["communities", "groups"]);
  let topResult = payload.topResult || payload.top || payload.bestMatch || null;

  const items = extractList(payload, ["items", "results", "data"]);
  if (items.length) {
    const split = splitMixedResults(items);
    if (!users.length) users = split.users;
    if (!posts.length) posts = split.posts;
    if (!communities.length) communities = split.communities;
    if (!topResult && items[0]) topResult = items[0];
  }

  if (!topResult) {
    topResult = users[0] || posts[0] || communities[0] || null;
  }

  return { users, posts, communities, topResult };
};

const normalizeSearchTerm = (value) => String(value || "").trim().toLowerCase();

const getUserSearchFields = (user) => {
  if (!user || typeof user !== "object") return [];
  const communityName = resolveCommunityName(user);
  return [
    user.username,
    user.displayName,
    user.fullName,
    communityName,
  ]
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter(Boolean);
};

const getUserPrimaryName = (user) => {
  if (!user || typeof user !== "object") return "";
  return String(
    resolveCommunityName(user) ||
      user.displayName ||
      user.fullName ||
      user.username ||
      ""
  )
    .trim()
    .toLowerCase();
};

const isUserVerified = (user) => {
  if (!user || typeof user !== "object") return false;
  return Boolean(
    user.isVerified ||
      user.isVerifiedCommunity ||
      user.verifiedCommunity ||
      user.communityVerified ||
      user.verified ||
      user.is_verified ||
      user.verifiedBadge ||
      user.verifiedAt ||
      user.verification?.status === "verified"
  );
};

const getMatchRank = (value, query) => {
  if (!value || !query) return null;
  const text = String(value).toLowerCase();
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  if (text.includes(query)) return 2;
  return null;
};

const rankUsersByQuery = (users, query) => {
  if (!query || !Array.isArray(users)) return [];
  return users
    .map((user) => {
      const match = resolveUserMatch(user, query);
      if (!match) return null;
      return {
        user,
        rank: match.rank,
        label: match.label,
        verified: isUserVerified(user),
        nameKey: getUserPrimaryName(user),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.nameKey !== b.nameKey) return a.nameKey.localeCompare(b.nameKey);
      if (a.verified !== b.verified) {
        return a.verified ? -1 : 1;
      }
      if (a.label !== b.label) return a.label.localeCompare(b.label);
      return 0;
    })
    .map((entry) => entry.user);
};

const resolveUserMatch = (user, query) => {
  const fields = getUserSearchFields(user);
  if (!fields.length) return null;
  let bestRank = null;
  let bestField = "";
  fields.forEach((field) => {
    const rank = getMatchRank(field, query);
    if (rank === null) return;
    if (bestRank === null || rank < bestRank) {
      bestRank = rank;
      bestField = field;
    }
  });
  if (bestRank === null) return null;
  return { rank: bestRank, label: bestField.toLowerCase() };
};

export default function Trending() {
  const {
    posts,
    stories,
    loading,
    loadPosts,
    loadStories,
    updatePost,
    getUserFromCache,
    prefetchUserProfile,
    isUserBlocked,
    getFriendStatus,
    ensureFriendStatus,
    sendFriendRequest,
    acceptFriend,
    rejectFriend,
  } = useApp();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTab, setSearchTab] = useState("all");
  const [searchData, setSearchData] = useState(DEFAULT_SEARCH_RESULTS);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [trendingTab, setTrendingTab] = useState("all");
  const [trendingWindow, setTrendingWindow] = useState("48h");
  const [trendingView, setTrendingView] = useState("grid");
  const [trendingVisibleCount, setTrendingVisibleCount] = useState(TRENDING_BATCH);
  const [trendingSnapshot, setTrendingSnapshot] = useState([]);
  const [trendingNeedsRefresh, setTrendingNeedsRefresh] = useState(false);
  const [trendingRefreshing, setTrendingRefreshing] = useState(false);
  const [trendingExtraPosts, setTrendingExtraPosts] = useState([]);
  const [trendingPostsHasMore, setTrendingPostsHasMore] = useState(true);
  const [trendingPostsLoading, setTrendingPostsLoading] = useState(false);
  const [friendActionLoading, setFriendActionLoading] = useState({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [commentPost, setCommentPost] = useState(null);
  const [sharePost, setSharePost] = useState(null);
  const [shareChatPost, setShareChatPost] = useState(null);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState(null);
  const searchRef = useRef(null);
  const trendingLoadMoreRef = useRef(null);
  const postsArrayRef = useRef([]);
  const storiesArrayRef = useRef([]);
  const searchAbortRef = useRef(null);
  const searchRequestRef = useRef(0);
  const searchCacheRef = useRef(new Map());
  const trendingBuiltAtRef = useRef(0);
  const trendingCursorRef = useRef("");
  const trendingPostsLoadingRef = useRef(false);

  const setActionLoading = useCallback((userId, value) => {
    if (!userId) return;
    setFriendActionLoading((prev) => ({ ...prev, [userId]: value }));
  }, []);

  const handlePrefetchProfile = useCallback(
    (user) => {
      const targetId = user?._id || user?.id;
      if (!targetId) return;
      prefetchUserProfile?.(targetId, user);
    },
    [prefetchUserProfile]
  );

  const handleAddFriend = useCallback(
    async (userId) => {
      if (!userId) return;
      setActionLoading(userId, true);
      try {
        await sendFriendRequest(userId);
      } catch (error) {
        alert(error.message || "Failed to send request");
      } finally {
        setActionLoading(userId, false);
      }
    },
    [sendFriendRequest, setActionLoading]
  );

  const handleAcceptFriend = useCallback(
    async (userId) => {
      if (!userId) return;
      setActionLoading(userId, true);
      try {
        await acceptFriend(userId);
      } catch (error) {
        alert(error.message || "Failed to accept request");
      } finally {
        setActionLoading(userId, false);
      }
    },
    [acceptFriend, setActionLoading]
  );

  const handleRejectFriend = useCallback(
    async (userId) => {
      if (!userId) return;
      setActionLoading(userId, true);
      try {
        await rejectFriend(userId);
      } catch (error) {
        alert(error.message || "Failed to reject request");
      } finally {
        setActionLoading(userId, false);
      }
    },
    [rejectFriend, setActionLoading]
  );

  const trimmedSearchQuery = searchQuery.trim();
  const normalizedSearchQuery = normalizeSearchTerm(trimmedSearchQuery);
  const hasSearchQuery = trimmedSearchQuery.length >= 1;

  const searchUsersResults = useMemo(() => {
    const list = Array.isArray(searchData.users) ? searchData.users : [];
    const filtered = list.filter((user) => {
      const userId = user?._id || user?.id;
      if (userId && isUserBlocked(userId)) return false;
      if (isUserAnonymous(user)) return false;
      if (!normalizedSearchQuery) return false;
      return Boolean(resolveUserMatch(user, normalizedSearchQuery));
    });
    return rankUsersByQuery(filtered, normalizedSearchQuery);
  }, [searchData.users, isUserBlocked, normalizedSearchQuery]);

  const searchCommunities = useMemo(() => {
    return searchUsersResults.filter(
      (user) => resolveUserType(user) === "community"
    );
  }, [searchUsersResults]);

  const searchPeople = useMemo(() => {
    return searchUsersResults.filter(
      (user) => resolveUserType(user) !== "community"
    );
  }, [searchUsersResults]);

  const searchPostsResults = useMemo(() => {
    const list = Array.isArray(searchData.posts) ? searchData.posts : [];
    return list.filter((post) => {
      if (!post) return false;
      const authorId = post.author?._id || post.authorId || post.author;
      if (authorId && isUserBlocked(authorId)) return false;
      return resolvePostPrivacy(post) === "public";
    });
  }, [searchData.posts, isUserBlocked]);

  const topResult = useMemo(() => {
    const candidate = searchData.topResult;
    if (isUserLike(candidate)) {
      const userId = candidate?._id || candidate?.id;
      if ((!userId || !isUserBlocked(userId)) && !isUserAnonymous(candidate)) {
        return candidate;
      }
    }
    if (isPostLike(candidate)) {
      const authorId = candidate.author?._id || candidate.authorId || candidate.author;
      if ((!authorId || !isUserBlocked(authorId)) && resolvePostPrivacy(candidate) === "public") {
        return candidate;
      }
    }
    return searchPeople[0] || searchPostsResults[0] || searchCommunities[0] || null;
  }, [searchData.topResult, searchPeople, searchPostsResults, searchCommunities, isUserBlocked]);

  const topResultType = useMemo(() => {
    if (!topResult) return null;
    if (isUserLike(topResult)) return "user";
    if (isPostLike(topResult)) return "post";
    return null;
  }, [topResult]);

  const topUserId =
    topResultType === "user" ? topResult?._id || topResult?.id : null;
  const topPostId =
    topResultType === "post"
      ? topResult?._id || topResult?.id || topResult?.postId
      : null;

  const peopleWithoutTop = useMemo(() => {
    if (!topUserId) return searchPeople;
    return searchPeople.filter((user) => {
      const userId = user?._id || user?.id;
      return String(userId) !== String(topUserId);
    });
  }, [searchPeople, topUserId]);

  const postsWithoutTop = useMemo(() => {
    if (!topPostId) return searchPostsResults;
    return searchPostsResults.filter((post) => {
      const postId = post?._id || post?.id || post?.postId;
      return String(postId) !== String(topPostId);
    });
  }, [searchPostsResults, topPostId]);

  const peoplePreview = useMemo(() => {
    return searchTab === "all" ? peopleWithoutTop.slice(0, 4) : peopleWithoutTop;
  }, [peopleWithoutTop, searchTab]);

  const postsPreview = useMemo(() => {
    return searchTab === "all"
      ? postsWithoutTop.slice(0, 6)
      : postsWithoutTop;
  }, [postsWithoutTop, searchTab]);

  const communityPreview = useMemo(() => {
    return searchTab === "all"
      ? searchCommunities.slice(0, 4)
      : searchCommunities;
  }, [searchCommunities, searchTab]);

  const searchHasResults =
    Boolean(topResult) ||
    searchPeople.length > 0 ||
    searchPostsResults.length > 0 ||
    searchCommunities.length > 0;
  const showSearchSkeleton = searchLoading && !searchHasResults;

  const searchTabs = [
    { id: "all", label: "All" },
    { id: "people", label: "People" },
    { id: "posts", label: "Posts" },
    { id: "communities", label: "Communities" },
  ];

  const isEmptyState = useMemo(() => {
    if (showSearchSkeleton || searchError) return false;
    if (searchTab === "all") {
      return !topResult && peoplePreview.length === 0 && postsPreview.length === 0;
    }
    if (searchTab === "people") return peoplePreview.length === 0;
    if (searchTab === "posts") return postsPreview.length === 0;
    if (searchTab === "communities") return communityPreview.length === 0;
    return false;
  }, [
    communityPreview.length,
    peoplePreview.length,
    postsPreview.length,
    searchError,
    searchTab,
    showSearchSkeleton,
    topResult,
  ]);

  const searchSuggestions = useMemo(() => {
    const suggestions = [];
    const seen = new Set();
    const source = Array.isArray(searchUsersResults)
      ? searchUsersResults.slice(0, 6)
      : [];
    source.forEach((user) => {
      const name =
        resolveCommunityName(user) ||
        user.displayName ||
        user.fullName ||
        user.username ||
        "";
      if (!name) return;
      const username = user.username ? `@${user.username}` : "";
      const value = user.username || name;
      if (seen.has(value)) return;
      seen.add(value);
      suggestions.push({
        label: name,
        meta: username,
        value,
        kind: resolveUserType(user) === "community" ? "community" : "person",
      });
    });
    if (!suggestions.length && trimmedSearchQuery) {
      suggestions.push({
        label: `Search "${trimmedSearchQuery}"`,
        meta: "",
        value: trimmedSearchQuery,
        kind: "query",
      });
    }
    return suggestions;
  }, [searchUsersResults, trimmedSearchQuery]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const updateSearchCache = useCallback((query, data) => {
    if (!query) return;
    const cache = searchCacheRef.current;
    if (cache.has(query)) cache.delete(query);
    cache.set(query, { data, ts: Date.now() });
    if (cache.size > SEARCH_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
  }, []);

  const getCachedPrefixResults = useCallback(
    (query) => {
      if (!query) return null;
      const cache = searchCacheRef.current;
      if (!cache.size) return null;
      let bestKey = "";
      const now = Date.now();
      cache.forEach((value, key) => {
        if (!value || typeof value !== "object") return;
        if (now - value.ts > SEARCH_CACHE_TTL) {
          cache.delete(key);
          return;
        }
        if (query.startsWith(key) && key.length > bestKey.length) {
          bestKey = key;
        }
      });
      if (!bestKey) return null;
      const base = cache.get(bestKey);
      const baseData = base?.data || base;
      const baseUsers = Array.isArray(baseData?.users) ? baseData.users : [];
      const filteredUsers = rankUsersByQuery(baseUsers, query);
      if (filteredUsers.length === 0) return null;
      return {
        ...DEFAULT_SEARCH_RESULTS,
        users: filteredUsers,
        topResult: filteredUsers[0] || null,
      };
    },
    []
  );

  useEffect(() => {
    if (!hasSearchQuery) {
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
      setSearchLoading(false);
      setSearchError("");
      setSearchData(DEFAULT_SEARCH_RESULTS);
      setShowSearchResults(false);
      return;
    }

    setShowSearchResults(true);
    setSearchError("");

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const requestId = ++searchRequestRef.current;

    const cached = searchCacheRef.current.get(normalizedSearchQuery);
    if (cached) {
      const now = Date.now();
      const cachedData = cached?.data || cached;
      const cachedTs = cached?.ts || 0;
      if (cachedTs && now - cachedTs <= SEARCH_CACHE_TTL) {
        setSearchData(cachedData);
        setSearchLoading(false);
        return;
      }
      searchCacheRef.current.delete(normalizedSearchQuery);
    }

    const prefixCached = getCachedPrefixResults(normalizedSearchQuery);
    if (prefixCached) {
      setSearchData(prefixCached);
    }

    setSearchLoading(true);
    const controller = new AbortController();
    searchAbortRef.current = controller;

    const runSearch = () => {
      let usersDone = false;
      let allDone = false;
      let usersSucceeded = false;
      let allSucceeded = false;
      let lastError = null;

      const finalize = () => {
        if (requestId !== searchRequestRef.current) return;
        if (usersDone && allDone) {
          setSearchLoading(false);
          if (!usersSucceeded && !allSucceeded) {
            setSearchData(DEFAULT_SEARCH_RESULTS);
            setSearchError(lastError?.message || "Search unavailable.");
          }
        }
      };

      searchUsers(trimmedSearchQuery, { signal: controller.signal })
        .then((users) => {
          if (requestId !== searchRequestRef.current) return;
          usersSucceeded = true;
          setSearchData((prev) => {
            if (allSucceeded) return prev;
            const nextUsers = Array.isArray(users) ? users : [];
            return {
              ...prev,
              users: nextUsers,
              topResult: prev.topResult || nextUsers[0] || null,
            };
          });
          updateSearchCache(normalizedSearchQuery, {
            ...DEFAULT_SEARCH_RESULTS,
            users,
            topResult: users?.[0] || null,
          });
        })
        .catch((error) => {
          if (error?.name === "AbortError") return;
          lastError = error;
        })
        .finally(() => {
          usersDone = true;
          finalize();
        });

      searchAll(trimmedSearchQuery, { type: "all", signal: controller.signal })
        .then((data) => {
          if (requestId !== searchRequestRef.current) return;
          allSucceeded = true;
          const normalized = normalizeSearchPayload(data);
          setSearchData(normalized);
          updateSearchCache(normalizedSearchQuery, normalized);
        })
        .catch((error) => {
          if (error?.name === "AbortError") return;
          lastError = error;
        })
        .finally(() => {
          allDone = true;
          finalize();
        });
    };

    if (SEARCH_DEBOUNCE_MS <= 0) {
      runSearch();
      return () => {
        controller.abort();
      };
    }

    const timeoutId = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    getCachedPrefixResults,
    hasSearchQuery,
    normalizedSearchQuery,
    trimmedSearchQuery,
    updateSearchCache,
  ]);

  useEffect(() => {
    if (!searchUsersResults || searchUsersResults.length === 0) return;
    searchUsersResults.forEach((user) => {
      const userId = user?._id || user?.id;
      if (!userId) return;
      if (String(userId) === String(currentUser?.id)) return;
      ensureFriendStatus(userId);
    });
  }, [searchUsersResults, ensureFriendStatus, currentUser?.id]);

  useEffect(() => {
    if (loadPosts) loadPosts();
    if (loadStories) loadStories();
  }, [loadPosts, loadStories]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTrendingNeedsRefresh(true);
    }, 120000);
    return () => clearInterval(interval);
  }, []);

  const postsArray = useMemo(() => {
    const list = Array.isArray(posts) ? posts : [];
    return list.filter((post) => {
      if (!post) return false;
      if (shouldExcludeContent(post)) return false;
      const authorId = post.author?._id || post.authorId || post.author;
      if (isUserBlocked(authorId)) return false;
      if (isMutedByUser(post, currentUser?.id)) return false;
      const privacy = resolvePostPrivacy(post);
      if (privacy !== "public") return false;
      return true;
    });
  }, [posts, isUserBlocked, currentUser?.id]);
  const storiesArray = useMemo(() => {
    const list = Array.isArray(stories) ? stories : [];
    return list.filter((story) => {
      if (!story) return false;
      if (!isStoryRecent(story)) return false;
      if (shouldExcludeContent(story)) return false;
      const authorId = story.authorId || story.author?._id || story.author;
      if (isUserBlocked(authorId)) return false;
      if (isMutedByUser(story, currentUser?.id)) return false;
      return resolveStoryPrivacyType(story) === "universal";
    });
  }, [stories, isUserBlocked, currentUser?.id]);

  const trendingPosts = useMemo(
    () => mergePostsById(postsArray, trendingExtraPosts),
    [postsArray, trendingExtraPosts]
  );

  useEffect(() => {
    postsArrayRef.current = trendingPosts;
  }, [trendingPosts]);

  useEffect(() => {
    storiesArrayRef.current = storiesArray;
  }, [storiesArray]);

  const rebuildTrendingSnapshot = useCallback(({ force = false } = {}) => {
    const now = Date.now();
    if (!force && trendingBuiltAtRef.current && now - trendingBuiltAtRef.current < TRENDING_TTL) {
      return;
    }
    const entries = [];
    const postsList = postsArrayRef.current || [];
    const storiesList = storiesArrayRef.current || [];

    postsList.forEach((post, index) => {
      const type = resolveContentType(post);
      entries.push({
        type,
        key: resolveTrendingKey(post, type, index),
        score: calculateTrendingScore(post),
        item: post,
        timestamp: getTimestamp(post),
      });
    });

    storiesList.forEach((story, index) => {
      entries.push({
        type: "story",
        key: resolveTrendingKey(story, "story", index),
        score: calculateTrendingScore(story, { isStory: true }),
        item: story,
        timestamp: getTimestamp(story),
      });
    });

    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.timestamp - a.timestamp;
    });

    setTrendingSnapshot(entries);
    trendingBuiltAtRef.current = now;
    setTrendingNeedsRefresh(false);
  }, []);

  const loadMoreTrendingPosts = useCallback(async () => {
    if (trendingPostsLoadingRef.current || !trendingPostsHasMore) return;
    trendingPostsLoadingRef.current = true;
    setTrendingPostsLoading(true);
    try {
      const cursor = trendingCursorRef.current;
      const params = {
        limit: TRENDING_PAGE_LIMIT,
        ...(cursor ? { cursor } : { page: 1 }),
      };
      const response = await fetchRankedFeedPage(params);
      const { items, nextCursor, hasMore } = normalizeRankedResponse(response);
      if (Array.isArray(items) && items.length > 0) {
        setTrendingExtraPosts((prev) => appendUniquePosts(prev, items));
        requestAnimationFrame(() => rebuildTrendingSnapshot({ force: true }));
      }
      const resolvedCursor = nextCursor || resolveCursorValue(items?.[items.length - 1]);
      if (resolvedCursor) {
        trendingCursorRef.current = resolvedCursor;
      }
      if (typeof hasMore === "boolean") {
        setTrendingPostsHasMore(hasMore);
      } else {
        setTrendingPostsHasMore(items.length >= TRENDING_PAGE_LIMIT);
      }
    } catch (_error) {
      void _error;
    } finally {
      trendingPostsLoadingRef.current = false;
      setTrendingPostsLoading(false);
    }
  }, [trendingPostsHasMore, rebuildTrendingSnapshot]);

  const handleTrendingRefresh = useCallback(async () => {
    if (trendingRefreshing) return;
    setTrendingRefreshing(true);
    try {
      await Promise.all([loadPosts?.(), loadStories?.()]);
      requestAnimationFrame(() => rebuildTrendingSnapshot({ force: true }));
      setTrendingNeedsRefresh(false);
    } finally {
      setTrendingRefreshing(false);
    }
  }, [loadPosts, loadStories, rebuildTrendingSnapshot, trendingRefreshing]);

  useEffect(() => {
    if (trendingSnapshot.length > 0) return;
    if (trendingPosts.length === 0 && storiesArray.length === 0) return;
    rebuildTrendingSnapshot();
  }, [
    trendingPosts.length,
    storiesArray.length,
    trendingSnapshot.length,
    rebuildTrendingSnapshot,
  ]);

  useEffect(() => {
    if (trendingWindow) {
      rebuildTrendingSnapshot({ force: true });
    }
  }, [trendingWindow, rebuildTrendingSnapshot]);

  const trendingItems = useMemo(() => {
    if (!trendingSnapshot.length) return [];
    const lookup = new Map();
    trendingPosts.forEach((post, index) => {
      const type = resolveContentType(post);
      const key = resolveTrendingKey(post, type, index);
      lookup.set(key, post);
    });
    storiesArray.forEach((story, index) => {
      const key = resolveTrendingKey(story, "story", index);
      lookup.set(key, story);
    });

    return trendingSnapshot
      .map((entry) => {
        const current = lookup.get(entry.key) || entry.item;
        if (!current) return null;
        return { ...entry, item: current };
      })
      .filter(Boolean);
  }, [trendingSnapshot, trendingPosts, storiesArray]);

  const filteredTrendingItems = useMemo(() => {
    if (trendingTab === "thoughts") {
      return trendingItems.filter((entry) => entry.type === "thought_text");
    }
    if (trendingTab === "posts") {
      return trendingItems.filter((entry) => entry.type === "post");
    }
    if (trendingTab === "stories") {
      return trendingItems.filter((entry) => entry.type === "story");
    }
    return trendingItems;
  }, [trendingItems, trendingTab]);

  const maxTrendingScore = filteredTrendingItems[0]?.score || 0;
  const hasMoreTrending =
    trendingVisibleCount < Math.min(filteredTrendingItems.length, TRENDING_MAX_VISIBLE);
  const showTrendingLoadMore = hasMoreTrending || trendingPostsHasMore;
  const shouldPrefetchTrending =
    trendingPostsHasMore &&
    filteredTrendingItems.length - trendingVisibleCount <= TRENDING_PREFETCH_THRESHOLD;
  const displayedTrendingItems = useMemo(
    () => filteredTrendingItems.slice(0, trendingVisibleCount),
    [filteredTrendingItems, trendingVisibleCount]
  );
  const showTrendingSkeletons = loading && filteredTrendingItems.length === 0;
  const isTrendingEmpty = !loading && filteredTrendingItems.length === 0;

  useEffect(() => {
    setTrendingVisibleCount(
      Math.min(TRENDING_BATCH, filteredTrendingItems.length, TRENDING_MAX_VISIBLE)
    );
  }, [trendingTab, trendingWindow, filteredTrendingItems.length]);

  useEffect(() => {
    if (!shouldPrefetchTrending) return;
    if (trendingPostsLoading) return;
    loadMoreTrendingPosts();
  }, [shouldPrefetchTrending, trendingPostsLoading, loadMoreTrendingPosts]);

  useEffect(() => {
    if (!trendingLoadMoreRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (hasMoreTrending) {
          setTrendingVisibleCount((prev) =>
            Math.min(
              prev + TRENDING_BATCH,
              filteredTrendingItems.length,
              TRENDING_MAX_VISIBLE
            )
          );
        } else if (trendingPostsHasMore) {
          loadMoreTrendingPosts();
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(trendingLoadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMoreTrending, filteredTrendingItems.length, trendingPostsHasMore, loadMoreTrendingPosts]);

  const groupedStories = useMemo(() => {
    const grouped = {};
    storiesArray.forEach((story) => {
      const rawAuthorId = story.authorId || story.author?._id || story.author;
      const authorId = rawAuthorId || `unknown-${story._id || "story"}`;
      const cachedUser = rawAuthorId ? getUserFromCache(rawAuthorId) : null;
      const displayName =
        story.authorDisplayName ||
        story.author?.displayName ||
        story.author?.fullName ||
        cachedUser?.displayName ||
        cachedUser?.name ||
        story.author?.username ||
        cachedUser?.username ||
        "User";
      const profilePicUrl =
        story.authorProfilePic ||
        story.author?.profilePicUrl ||
        cachedUser?.profilePicUrl ||
        ANONYMOUS_AVATAR;
      if (!grouped[authorId]) {
        grouped[authorId] = {
          authorId,
          authorDisplayName: displayName,
          authorProfilePic: profilePicUrl,
          stories: [],
        };
      }
      grouped[authorId].authorDisplayName = displayName;
      grouped[authorId].authorProfilePic = profilePicUrl;
      grouped[authorId].stories.push({
        ...story,
        authorId,
        authorDisplayName: displayName,
        authorProfilePic: profilePicUrl,
      });
    });
    return Object.values(grouped);
  }, [storiesArray, getUserFromCache]);

  const storyIndexMap = useMemo(() => {
    const map = new Map();
    groupedStories.forEach((group, index) => {
      group.stories.forEach((story) => {
        if (story._id) map.set(story._id, index);
      });
    });
    return map;
  }, [groupedStories]);

  const handleOpenStory = useCallback(
    (story) => {
      const idx = storyIndexMap.get(story._id);
      if (idx === undefined) return;
      setSelectedStoryIndex(idx);
    },
    [storyIndexMap]
  );

  const [mediaLikePulse, setMediaLikePulse] = useState({});
  const [likeIconPulse, setLikeIconPulse] = useState({});
  const lastTapRef = useRef(new Map());
  const suppressOpenRef = useRef(new Set());
  const likeCommitTimersRef = useRef(new Map());
  const likeDesiredRef = useRef(new Map());
  const likeCommitInFlightRef = useRef(new Map());
  const committedLikedRef = useRef(new Map());
  const committedCountRef = useRef(new Map());
  const optimisticCountRef = useRef(new Map());

  useEffect(() => {
    const timers = likeCommitTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const unlockIfSafe = () => {
      const hasLockingModal = document.querySelector(
        "#comment-modal, #create-post-modal, #story-viewer-modal"
      );
      if (hasLockingModal) return;
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
    unlockIfSafe();
    const id = window.setInterval(unlockIfSafe, 500);
    return () => window.clearInterval(id);
  }, []);

  const bumpMediaLikePulse = useCallback((postId) => {
    if (!postId) return;
    setMediaLikePulse((prev) => ({
      ...prev,
      [postId]: (prev[postId] || 0) + 1,
    }));
  }, []);

  const bumpLikeIconPulse = useCallback((postId) => {
    if (!postId) return;
    setLikeIconPulse((prev) => ({
      ...prev,
      [postId]: (prev[postId] || 0) + 1,
    }));
  }, []);

  const commitLike = useCallback(
    async (rawPostId) => {
      const postId = String(rawPostId || "");
      if (!postId || !currentUser?.id) return;
      const timers = likeCommitTimersRef.current;
      if (timers.has(postId)) {
        clearTimeout(timers.get(postId));
        timers.delete(postId);
      }
      if (likeCommitInFlightRef.current.get(postId)) {
        timers.set(
          postId,
          setTimeout(() => {
            commitLike(postId);
          }, 250)
        );
        return;
      }
      if (!likeDesiredRef.current.has(postId)) return;

      const desired = likeDesiredRef.current.get(postId);
      const committed = committedLikedRef.current.get(postId);
      if (committed !== undefined && desired === committed) {
        const committedCount = committedCountRef.current.get(postId) ?? 0;
        updatePost(postId, {
          likeCount: committedCount,
          likesCount: committedCount,
          likedByMe: committed,
          isLikedByMe: committed,
        });
        likeDesiredRef.current.delete(postId);
        optimisticCountRef.current.delete(postId);
        return;
      }

      likeCommitInFlightRef.current.set(postId, true);
      const desiredAtSend = desired;
      try {
        const response = await likePost(postId);
        const updatedPost =
          response?.post || response?.data?.post || response?.data || response || null;
        const fallbackCount =
          optimisticCountRef.current.get(postId) ??
          committedCountRef.current.get(postId) ??
          0;
        const updatedCount = updatedPost ? resolveLikesMeta(updatedPost).count : fallbackCount;
        const updatedLikesRaw =
          updatedPost && Array.isArray(updatedPost.likes)
            ? updatedPost.likes
            : updatedPost && Array.isArray(updatedPost.likedBy)
              ? updatedPost.likedBy
              : updatedPost && Array.isArray(updatedPost.liked_by)
                ? updatedPost.liked_by
                : null;
        const updates = {
          likeCount: updatedCount,
          likesCount: updatedCount,
          likedByMe: desiredAtSend,
          isLikedByMe: desiredAtSend,
        };
        if (updatedLikesRaw) {
          const updatedLikeIds = resolveLikeIds(updatedLikesRaw);
          updates.likes = updatedLikeIds;
          updates.likedBy = updatedLikeIds;
        }
        updatePost(postId, updates);
        committedLikedRef.current.set(postId, desiredAtSend);
        committedCountRef.current.set(postId, updatedCount);
      } catch (_error) {
        void _error;
        const rollbackLiked = committedLikedRef.current.get(postId);
        const rollbackCount = committedCountRef.current.get(postId);
        if (rollbackLiked !== undefined && rollbackCount !== undefined) {
          updatePost(postId, {
            likeCount: rollbackCount,
            likesCount: rollbackCount,
            likedByMe: rollbackLiked,
            isLikedByMe: rollbackLiked,
          });
        }
      } finally {
        likeCommitInFlightRef.current.set(postId, false);
        if (likeDesiredRef.current.get(postId) === desiredAtSend) {
          likeDesiredRef.current.delete(postId);
          optimisticCountRef.current.delete(postId);
        }
      }
    },
    [currentUser?.id, updatePost]
  );

  const scheduleLikeCommit = useCallback(
    (postId) => {
      const timers = likeCommitTimersRef.current;
      if (timers.has(postId)) {
        clearTimeout(timers.get(postId));
      }
      timers.set(
        postId,
        setTimeout(() => {
          commitLike(postId);
        }, 2000)
      );
    },
    [commitLike]
  );

  const handleToggleLike = useCallback(
    async (post) => {
      if (!currentUser?.id) return;
      const postId = String(
        post._id || post.id || post.postId || post.post_id || ""
      );
      if (!postId) return;
      bumpLikeIconPulse(String(postId));
      const { ids: baseLikes, count: baseCount, shouldUseList } = resolveLikesMeta(post);
      const hasLiked = resolvePostIsLiked(post, currentUser.id, baseLikes);
      const hasPending =
        likeDesiredRef.current.has(postId) || likeCommitInFlightRef.current.get(postId);
      if (!hasPending) {
        committedLikedRef.current.set(postId, hasLiked);
        committedCountRef.current.set(postId, baseCount);
      }
      const nextLiked = !hasLiked;
      const currentCount = optimisticCountRef.current.get(postId) ?? baseCount;
      const nextCount = Math.max(0, currentCount + (nextLiked ? 1 : -1));
      const nextLikes = shouldUseList
        ? nextLiked
          ? Array.from(new Set([...baseLikes, currentUser.id]))
          : baseLikes.filter((id) => String(id) !== String(currentUser.id))
        : null;
      const optimisticUpdates = {
        likeCount: nextCount,
        likesCount: nextCount,
        likedByMe: nextLiked,
        isLikedByMe: nextLiked,
      };
      if (shouldUseList && nextLikes) {
        optimisticUpdates.likes = nextLikes;
      }
      updatePost(postId, optimisticUpdates);
      optimisticCountRef.current.set(postId, nextCount);
      likeDesiredRef.current.set(postId, nextLiked);
      scheduleLikeCommit(postId);
    },
    [currentUser?.id, updatePost, bumpLikeIconPulse, scheduleLikeCommit]
  );

  const shouldSuppressOpen = useCallback((postId) => {
    if (!postId) return false;
    if (suppressOpenRef.current.has(postId)) {
      suppressOpenRef.current.delete(postId);
      return true;
    }
    return false;
  }, []);

  const handleMediaDoubleTap = useCallback(
    (post) => {
      if (!post || !currentUser?.id) return;
      const postId = String(
        post._id || post.id || post.postId || post.post_id || ""
      );
      if (!postId) return;
      bumpMediaLikePulse(postId);
      const { ids: baseLikes } = resolveLikesMeta(post);
      const hasLiked = resolvePostIsLiked(post, currentUser.id, baseLikes);
      if (!hasLiked) {
        handleToggleLike(post);
      }
    },
    [currentUser?.id, handleToggleLike, bumpMediaLikePulse]
  );

  const handleMediaTouchEnd = useCallback(
    (post) => {
      const postId = String(
        post?._id || post?.id || post?.postId || post?.post_id || ""
      );
      if (!postId) return;
      const now = Date.now();
      const lastTap = lastTapRef.current.get(postId) || 0;
      if (now - lastTap < 280) {
        suppressOpenRef.current.add(postId);
        handleMediaDoubleTap(post);
      }
      lastTapRef.current.set(postId, now);
    },
    [handleMediaDoubleTap]
  );

  const sharePostId = sharePost?._id || sharePost?.id;
  const sharePostUrl = sharePostId
    ? `${window.location.origin}/feed?post=${sharePostId}`
    : "";
  const sharePostThumbnail = sharePost ? resolvePostMediaUrl(sharePost) : "";
  const sharePostPreviewText =
    sharePost?.content && sharePost.content.length > 0
      ? sharePost.content.slice(0, 80)
      : "Campus update";
  const sharePostIsPrivate = sharePost
    ? resolvePostPrivacy(sharePost) === "friends"
    : false;
  const shareChatPostId = shareChatPost?._id || shareChatPost?.id;
  const shareChatPostUrl = shareChatPostId
    ? `${window.location.origin}/feed?post=${shareChatPostId}`
    : "";
  const shareChatPostThumbnail = shareChatPost
    ? resolvePostMediaUrl(shareChatPost)
    : "";
  const shareChatPostPreviewText =
    shareChatPost?.content && shareChatPost.content.length > 0
      ? shareChatPost.content.slice(0, 80)
      : "Campus update";
  const shareChatPostAuthorName =
    shareChatPost?.author?.displayName ||
    shareChatPost?.author?.fullName ||
    shareChatPost?.author?.username ||
    shareChatPost?.authorName ||
    "";
  const shareChatPostAuthorId =
    shareChatPost?.author?._id || shareChatPost?.authorId || shareChatPost?.author;

  const resolveTrendingBadge = useCallback(
    (score) => {
      if (!maxTrendingScore || !score) return null;
      const ratio = score / maxTrendingScore;
      if (ratio >= 0.88) {
        return {
          text: "🔥 Trending",
          tone: "border-amber-300/40 bg-amber-400/20 text-amber-100",
        };
      }
      if (ratio >= 0.7) {
        return {
          text: "📈 Rising",
          tone: "border-emerald-300/40 bg-emerald-400/20 text-emerald-100",
        };
      }
      if (ratio >= 0.55) {
        return {
          text: "⚡ Hot Now",
          tone: "border-sky-300/40 bg-sky-400/20 text-sky-100",
        };
      }
      return null;
    },
    [maxTrendingScore]
  );

  const renderUnderReviewMediaCard = useCallback(
    ({ key, aspectClass = "aspect-square", highlight = false, className = "" } = {}) => {
      return (
        <div
          key={key}
          className={`relative overflow-hidden rounded-2xl glass-card border border-amber-200/20 bg-amber-200/5 ${
            highlight ? "glow-border" : ""
          } ${className}`}
        >
          <div className={`relative w-full ${aspectClass}`}>
            <div className="absolute inset-0 bg-gradient-to-br from-amber-400/10 via-black/30 to-black/70"></div>
            <div className="relative z-10 h-full w-full flex flex-col items-center justify-center gap-2 p-4 text-center">
              <div className="h-10 w-10 rounded-full border border-amber-200/40 bg-amber-200/10 flex items-center justify-center text-amber-100">
                <i className="fa-solid fa-shield-halved text-sm"></i>
              </div>
              <p className="text-sm font-semibold text-amber-100">Under review</p>
              <p className="text-[11px] text-[#b9b4c7]">
                This post is being checked.
              </p>
            </div>
          </div>
        </div>
      );
    },
    []
  );

  const renderUnderReviewWideCard = useCallback(({ key, className = "" } = {}) => {
    return (
      <div
        key={key}
        className={`relative w-full overflow-hidden rounded-3xl glass-card border border-amber-200/20 bg-amber-200/5 ${className}`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-amber-400/10 via-black/30 to-black/60"></div>
        <div className="relative z-10 flex items-center gap-4 p-6">
          <div className="h-12 w-12 rounded-full border border-amber-200/40 bg-amber-200/10 flex items-center justify-center text-amber-100">
            <i className="fa-solid fa-shield-halved text-base"></i>
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-100">Post under review</p>
            <p className="text-xs text-[#b9b4c7]">
              We’re reviewing this post. It will return if approved.
            </p>
          </div>
        </div>
      </div>
    );
  }, []);

  const renderTrendingCard = useCallback(
    (entry, index) => {
      if (!entry) return null;
      const isStory = entry.type === "story";
      const item = entry.item;
      const itemId = String(item?._id || item?.id || item?.postId || item?.post_id || "");
    if (isContentUnderReview(item)) {
      return renderUnderReviewMediaCard({
        key: `review-${entry.type}-${itemId || index}`,
        highlight: index === 0,
      });
    }
    const contentType = entry.type;
    const mediaUrl = isStory ? resolveStoryMediaUrl(item) : resolvePostMediaUrl(item);
    const storyType = isStory ? resolveStoryMediaType(item, mediaUrl) : "image";
    const isVideo = isStory ? storyType === "video" : isVideoUrl(mediaUrl);
    const optimizedMediaUrl = isVideo
      ? getOptimizedVideoUrl(mediaUrl)
      : getOptimizedMediaUrl(mediaUrl, { width: 600 });
    const mediaSrcSet = !isVideo ? getMediaSrcSet(mediaUrl) : null;
    const isThought = contentType === "thought_text";
    const label = isStory ? "Story" : isThought ? "Thought" : isVideo ? "Video" : "Post";
    const likes = isStory ? 0 : getLikeCount(item);
    const comments = isStory ? 0 : getCommentCount(item);
    const shares = isStory ? 0 : getShareCount(item);
    const saves = isStory ? 0 : getSaveCount(item);
    const views = isStory ? getStoryViewCount(item) : 0;
    const isAnonymous = Boolean(
      item.isAnonymous || item.anonymous || item.is_anonymous || item.author?.isAnonymous
    );
    const authorId = resolveAuthorId(item);
    const cachedUser = authorId ? getUserFromCache(authorId) : null;
    const authorName = resolveAuthorName(item, cachedUser, isAnonymous && !isStory);
    const authorIsVerified = resolveAuthorVerified(item, cachedUser, isAnonymous);
    const avatar =
      isStory && !isAnonymous
        ? resolveAuthorAvatar(item, cachedUser, false)
        : resolveAuthorAvatar(item, cachedUser, isAnonymous);
    const snippet = isStory ? item.caption || "Story preview" : item.content || "Campus update";
    const badge = resolveTrendingBadge(entry.score);

    const pulseCount = itemId ? mediaLikePulse[itemId] || 0 : 0;
    const likePulse = itemId ? likeIconPulse[itemId] || 0 : 0;

      return (
        <Motion.div
          key={`${entry.type}-${itemId || index}`}
        className={`relative aspect-square overflow-hidden rounded-2xl glass-card border border-white/10 ${
          index === 0 ? "glow-border" : ""
        }`}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (isStory) {
            handleOpenStory(item);
            return;
          }
          if (shouldSuppressOpen(itemId)) return;
          setSelectedPost(item);
        }}
        onDoubleClick={(event) => {
          if (isStory) return;
          event.preventDefault();
          event.stopPropagation();
          if (itemId) suppressOpenRef.current.add(itemId);
          handleMediaDoubleTap(item);
        }}
        onTouchEnd={() => {
          if (isStory) return;
          handleMediaTouchEnd(item);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (isStory) handleOpenStory(item);
            else setSelectedPost(item);
          }
        }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        style={{ touchAction: "manipulation" }}
      >
        {mediaUrl ? (
          isVideo ? (
            <video
              src={optimizedMediaUrl || mediaUrl}
              className="h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={optimizedMediaUrl || mediaUrl}
              srcSet={mediaSrcSet || undefined}
              sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 260px"
              alt="Trending"
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          )
        ) : (
          <div className="h-full w-full bg-white/5 p-4 flex items-end">
            <p className="text-sm text-[#faf0e6] line-clamp-3">{snippet}</p>
          </div>
        )}
        {!isStory && pulseCount > 0 && (
          <Motion.i
            key={`trend-like-${itemId}-${pulseCount}`}
            className="fa-solid fa-heart text-4xl text-red-300 drop-shadow-[0_0_18px_rgba(248,113,113,0.6)] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 0], scale: [0.6, 1.1, 1.3] }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            aria-hidden="true"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
        <div className="absolute top-3 left-3 flex items-center gap-2 max-w-[75%]">
          <img
            src={avatar}
            alt={authorName}
            className="h-7 w-7 rounded-full border border-white/30 object-cover"
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[#faf0e6] truncate flex items-center gap-1">
              {authorName}
              {authorIsVerified && <BlueTick className="text-[10px]" />}
            </p>
            <p className="text-[9px] uppercase tracking-[0.2em] text-[#b9b4c7]">
              {label}
            </p>
          </div>
        </div>
        {badge && (
          <div
            className={`absolute top-3 right-3 rounded-full border px-2 py-0.5 text-[10px] ${badge.tone}`}
          >
            {badge.text}
          </div>
        )}
        <div className="absolute bottom-3 left-3 flex items-center gap-3 text-[11px] text-[#faf0e6]">
          {isStory ? (
            <span>
              <i className="fa-regular fa-eye mr-1"></i>
              {views}
            </span>
          ) : (
            <>
              <span>
                <i className="fa-solid fa-heart mr-1 text-red-300"></i>
                {likes}
              </span>
              <span>
                <i className="fa-regular fa-comment mr-1"></i>
                {comments}
              </span>
              <span>
                <i className="fa-solid fa-share mr-1"></i>
                {shares}
              </span>
              <span>
                <i className="fa-regular fa-bookmark mr-1"></i>
                {saves}
              </span>
            </>
          )}
        </div>
        {!isStory && (
          <div className="absolute bottom-3 right-3 flex items-center gap-2 text-[11px] text-[#faf0e6]">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleToggleLike(item);
              }}
              className="rounded-full bg-black/40 px-2 py-1 hover:bg-black/60"
            >
              <Motion.span
                key={`trend-like-icon-${itemId || index}-${likePulse}`}
                initial={{ scale: 1 }}
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex items-center"
              >
                <i className="fa-solid fa-heart"></i>
              </Motion.span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setCommentPost(item);
              }}
              className="rounded-full bg-black/40 px-2 py-1 hover:bg-black/60"
            >
              <i className="fa-regular fa-comment"></i>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setSharePost(item);
              }}
              className="rounded-full bg-black/40 px-2 py-1 hover:bg-black/60"
            >
              <i className="fa-solid fa-share-nodes"></i>
            </button>
          </div>
        )}
        </Motion.div>
      );
    },
    [
      getUserFromCache,
      handleMediaDoubleTap,
      handleMediaTouchEnd,
      handleOpenStory,
      likeIconPulse,
      mediaLikePulse,
      handleToggleLike,
      renderUnderReviewMediaCard,
      resolveTrendingBadge,
      shouldSuppressOpen,
    ]
  );

  const renderDoomItem = useCallback(
    (entry, index) => {
      if (!entry) return null;
      const item = entry.item;
      if (isContentUnderReview(item)) {
        return renderUnderReviewWideCard({
          key: `review-doom-${entry.type}-${item?._id || item?.id || index}`,
        });
      }
    if (entry.type === "story") {
      const mediaUrl = resolveStoryMediaUrl(item);
      const storyType = resolveStoryMediaType(item, mediaUrl);
      const isVideo = storyType === "video";
      const optimizedMediaUrl = isVideo
        ? getOptimizedVideoUrl(mediaUrl)
        : getOptimizedMediaUrl(mediaUrl, { width: 600 });
      const mediaSrcSet = !isVideo ? getMediaSrcSet(mediaUrl) : null;
      const authorId = resolveAuthorId(item);
      const cachedUser = authorId ? getUserFromCache(authorId) : null;
      const authorName = resolveAuthorName(item, cachedUser, false);
      const avatar = resolveAuthorAvatar(item, cachedUser, false);
      const authorIsVerified = resolveAuthorVerified(item, cachedUser, false);
      const badge = resolveTrendingBadge(entry.score);
      const views = getStoryViewCount(item);

      return (
        <Motion.button
          key={`doom-story-${item._id || item.id || index}`}
          type="button"
          onClick={() => handleOpenStory(item)}
          className="relative w-full overflow-hidden rounded-3xl glass-card border border-white/10 text-left"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            {mediaUrl ? (
              isVideo ? (
                <video
                  src={optimizedMediaUrl || mediaUrl}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img
                  src={optimizedMediaUrl || mediaUrl}
                  srcSet={mediaSrcSet || undefined}
                  sizes="(max-width: 640px) 90vw, 720px"
                  alt="Story"
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              )
            ) : (
              <div className="h-full w-full bg-white/5 flex items-center justify-center text-[#faf0e6]">
                Story preview
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <img
                src={avatar}
                alt={authorName}
                className="h-9 w-9 rounded-full border border-white/30 object-cover"
              />
              <div>
                <p className="text-sm font-semibold text-[#faf0e6] flex items-center gap-1">
                  {authorName}
                  {authorIsVerified && <BlueTick className="text-[11px]" />}
                </p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                  Story
                </p>
              </div>
            </div>
            {badge && (
              <div
                className={`absolute top-4 right-4 rounded-full border px-2 py-0.5 text-[10px] ${badge.tone}`}
              >
                {badge.text}
              </div>
            )}
            <div className="absolute bottom-4 left-4 text-xs text-[#faf0e6]">
              <i className="fa-regular fa-eye mr-1"></i>
              {views} views
            </div>
          </div>
        </Motion.button>
      );
    }

    const badge = resolveTrendingBadge(entry.score);
      return (
        <Post
          key={`doom-post-${entry.item?._id || entry.item?.id || index}`}
          post={entry.item}
          badge={badge}
          onOpen={() => setSelectedPost(entry.item)}
        />
      );
    },
    [
      getUserFromCache,
      handleOpenStory,
      renderUnderReviewWideCard,
      resolveTrendingBadge,
    ]
  );

  const trendingGridItems = useMemo(
    () => displayedTrendingItems.map((entry, index) => renderTrendingCard(entry, index)),
    [displayedTrendingItems, renderTrendingCard]
  );
  const trendingDoomItems = useMemo(
    () => displayedTrendingItems.map((entry, index) => renderDoomItem(entry, index)),
    [displayedTrendingItems, renderDoomItem]
  );

  const renderUserCard = (user, { variant = "default", index } = {}) => {
    if (!user) return null;
    const userId = normalizeUserId(user);
    const hasUserId = userId !== undefined && userId !== null && userId !== "";
    const userKey = hasUserId ? String(userId) : `user-${variant}-${index ?? "unknown"}`;
    const cachedUser = hasUserId ? getUserFromCache?.(userId) : null;
    const previewSource = { ...(cachedUser || {}), ...(user || {}) };
    const userType = resolveUserType(user);
    const isCommunity = userType === "community";
    const userTypeBadge = formatUserType(userType);
    const studentType = formatStudentType(resolveStudentType(user));
    const communityType = formatCommunityType(resolveCommunityType(user));
    const collegeLabel = resolveCollegeName(user);
    const bio = isCommunity
      ? resolveCommunityDescription(user)
      : resolveUserBio(user);
    const bioPreview =
      bio && bio.length > 90 ? `${bio.slice(0, 90)}...` : bio || "No bio yet.";
    const secondaryLine = isCommunity
      ? `${communityType || "Community"}${collegeLabel ? ` • ${collegeLabel}` : ""}`
      : `${studentType}${collegeLabel ? ` • ${collegeLabel}` : ""}`;
    const displayName = isCommunity
      ? resolveCommunityName(user) ||
        user.displayName ||
        user.username ||
        "Community"
      : user.fullName || user.displayName || user.username || "User";
    const isVerified = Boolean(
      user.isVerified ||
        user.verified ||
        user.is_verified ||
        user.verification?.status === "verified"
    );
    const avatarUrl = getOptimizedMediaUrl(user.profilePicUrl, { width: 96, height: 96 });
    const status = getFriendStatus(userId);
    const isSelf = String(userId) === String(currentUser?.id);
    const isLoading = friendActionLoading[userId];
    const mutualCount = Number(
      user.mutualFriendsCount || user.mutualFriends?.length || 0
    );
    const friendCountRaw =
      user.friendCount ??
      user.friendsCount ??
      (Array.isArray(user.friends) ? user.friends.length : undefined);
    const friendCount = Number(friendCountRaw);
    const publicPostCount = Number(
      user.publicPostCount || user.publicPostsCount || user.postCount || 0
    );
    const memberCount = Number(
      user.memberCount || user.membersCount || user.members?.length || 0
    );
    const stats = [];
    if (isCommunity) {
      if (memberCount || memberCount === 0) stats.push(`${memberCount} members`);
    } else {
      if (Number.isFinite(friendCount)) stats.push(`${friendCount} friends`);
      if (mutualCount > 0) stats.push(`${mutualCount} mutual`);
      if (!Number.isNaN(publicPostCount)) stats.push(`${publicPostCount} posts`);
    }

    return (
      <div
        key={userKey}
        className={`w-full rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/10 ${
          variant === "top" ? "glow-border" : ""
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <button
            type="button"
            onMouseEnter={() => handlePrefetchProfile(previewSource)}
            onFocus={() => handlePrefetchProfile(previewSource)}
            onPointerDown={() => handlePrefetchProfile(previewSource)}
            onClick={() => {
              handlePrefetchProfile(previewSource);
              if (!userId) return;
              navigate(`/profile/${userId}`, {
                state: {
                  userPreview: buildUserPreview(previewSource, {
                    _id: userId,
                    fullName: user.fullName || user.name,
                    displayName,
                    username: user.username,
                    profilePicUrl: user.profilePicUrl,
                    isVerified,
                    isVerifiedCommunity: user.isVerifiedCommunity,
                    university: user.university,
                    college: user.college,
                  }),
                  modal: true,
                },
              });
            }}
            className="flex items-start gap-3 text-left flex-1 min-w-0"
          >
            <img
              src={avatarUrl || ANONYMOUS_AVATAR}
              alt={displayName}
              className="w-11 h-11 rounded-full object-cover"
              loading="lazy"
              decoding="async"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-sm text-[#faf0e6] truncate flex items-center gap-1">
                  {displayName}
                  {isVerified && <BlueTick className="text-[11px]" />}
                </p>
                <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] text-[#faf0e6]">
                  {userTypeBadge}
                </span>
              </div>
              <p className="text-xs text-[#b9b4c7] break-words">{secondaryLine}</p>
              <p className="text-[11px] text-[#b9b4c7] line-clamp-2">
                {bioPreview}
              </p>
              {stats.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[#b9b4c7]">
                  {stats.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
          <div className="flex w-full sm:w-auto flex-col items-start sm:items-end gap-2 shrink-0">
            {isSelf ? (
              <span className="text-[10px] text-[#b9b4c7]">You</span>
            ) : (
              <div className="flex flex-wrap items-center justify-start sm:justify-end gap-2">
                {status !== "pending_received" && (
                  <button
                    type="button"
                    onClick={() => navigate("/chat")}
                    disabled={status !== "friends"}
                    className={`text-[10px] px-3 py-1 rounded-full border border-white/10 ${
                      status === "friends"
                        ? "bg-white/10 text-[#faf0e6] hover:bg-white/20"
                        : "bg-white/5 text-[#b9b4c7] cursor-not-allowed"
                    }`}
                  >
                    Message
                  </button>
                )}

                {status === "friends" ? (
                  <span className="text-[10px] px-3 py-1 rounded-full bg-emerald-400/20 text-emerald-200">
                    Friends
                  </span>
                ) : status === "pending_sent" ? (
                  <button
                    type="button"
                    disabled
                    className="text-[10px] px-3 py-1 rounded-full bg-white/5 text-[#b9b4c7] cursor-not-allowed"
                  >
                    Requested
                  </button>
                ) : status === "pending_received" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleAcceptFriend(userId)}
                      disabled={isLoading}
                      className="text-[10px] px-3 py-1 rounded-full bg-emerald-400/20 text-emerald-200 hover:bg-emerald-400/30 transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRejectFriend(userId)}
                      disabled={isLoading}
                      className="text-[10px] px-3 py-1 rounded-full bg-white/5 text-[#b9b4c7] hover:bg-white/10 transition-colors"
                    >
                      Reject
                    </button>
                  </>
                ) : status === "blocked" ? (
                  <span className="text-[10px] px-3 py-1 rounded-full bg-white/5 text-[#b9b4c7]">
                    Blocked
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAddFriend(userId)}
                    disabled={isLoading}
                    className="text-[12px] px-4 py-1.5 rounded-full bg-[#b9b4c7]/20 text-[#faf0e6] hover:bg-[#b9b4c7]/30 transition-colors"
                  >
                    Add Friend
                  </button>
                )}

                <button
                  type="button"
                  onMouseEnter={() => handlePrefetchProfile(previewSource)}
                  onFocus={() => handlePrefetchProfile(previewSource)}
                  onPointerDown={() => handlePrefetchProfile(previewSource)}
                  onClick={() => {
                    handlePrefetchProfile(previewSource);
                    if (!userId) return;
                    navigate(`/profile/${userId}`, {
                      state: {
                        userPreview: buildUserPreview(previewSource, {
                          _id: userId,
                          fullName: user.fullName || user.name,
                          displayName,
                          username: user.username,
                          profilePicUrl: user.profilePicUrl,
                          isVerified,
                          isVerifiedCommunity: user.isVerifiedCommunity,
                          university: user.university,
                          college: user.college,
                        }),
                        modal: true,
                      },
                    });
                  }}
                  className="h-7 w-7 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] hover:bg-white/10"
                  aria-label="View profile"
                >
                  <i className="fa-solid fa-circle-info text-[11px]"></i>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderPostCard = (post, { variant = "grid", index } = {}) => {
    if (!post) return null;
    const postId = post._id || post.id || post.postId || post.post_id;
    if (isContentUnderReview(post)) {
      const aspectClass = variant === "featured" ? "aspect-[16/9]" : "aspect-square";
      return renderUnderReviewMediaCard({
        key: `review-post-${postId || variant}`,
        aspectClass,
        className: variant === "featured" ? "w-full" : "",
      });
    }
    const mediaUrl = resolvePostMediaUrl(post);
    const isVideo =
      isVideoUrl(mediaUrl) ||
      String(post.mediaType || post.type || "").toLowerCase().includes("video");
    const optimizedMediaUrl = isVideo
      ? getOptimizedVideoUrl(mediaUrl)
      : getOptimizedMediaUrl(mediaUrl, { width: 600 });
    const mediaSrcSet = !isVideo ? getMediaSrcSet(mediaUrl) : null;
    const isAnonymous = Boolean(
      post.isAnonymous ||
        post.anonymous ||
        post.is_anonymous ||
        post.author?.isAnonymous
    );
    const label = isAnonymous ? "Anonymous" : "Public";
    const caption =
      post.content && post.content.length > 60
        ? `${post.content.slice(0, 60)}...`
        : post.content || "Campus update";
    const aspectClass = variant === "featured" ? "aspect-[16/9]" : "aspect-square";

    const resolvedId = String(postId || "");
    const pulseCount = resolvedId ? mediaLikePulse[resolvedId] || 0 : 0;

    const postKey = postId ? String(postId) : `post-${variant}-${index ?? "unknown"}`;

    return (
      <button
        key={postKey}
        type="button"
        onClick={() => {
          if (shouldSuppressOpen(resolvedId)) return;
          setSelectedPost(post);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (resolvedId) suppressOpenRef.current.add(resolvedId);
          handleMediaDoubleTap(post);
        }}
        onTouchEnd={() => handleMediaTouchEnd(post)}
        className={`relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left ${
          variant === "featured" ? "w-full" : ""
        }`}
        style={{ touchAction: "manipulation" }}
      >
        <div className={`relative w-full ${aspectClass}`}>
          {mediaUrl ? (
            isVideo ? (
              <video
                src={optimizedMediaUrl || mediaUrl}
                className="h-full w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                src={optimizedMediaUrl || mediaUrl}
                srcSet={mediaSrcSet || undefined}
                sizes={
                  variant === "featured"
                    ? "(max-width: 1024px) 90vw, 900px"
                    : "(max-width: 1024px) 40vw, 260px"
                }
                alt="Search post"
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            )
          ) : (
            <div className="h-full w-full bg-white/5 p-3 flex items-end">
              <p className="text-xs text-[#faf0e6] line-clamp-3">{caption}</p>
            </div>
          )}
          {pulseCount > 0 && (
            <Motion.i
              key={`trend-search-like-${resolvedId}-${pulseCount}`}
              className="fa-solid fa-heart text-3xl text-red-300 drop-shadow-[0_0_16px_rgba(248,113,113,0.6)] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: [0, 1, 0], scale: [0.6, 1.1, 1.3] }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              aria-hidden="true"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
          <div className="absolute bottom-2 left-2 flex items-center gap-2 text-[10px] text-[#faf0e6]">
            <span className="rounded-full border border-white/20 bg-black/40 px-2 py-0.5">
              {isVideo ? "Video" : "Post"}
            </span>
            <span className="rounded-full border border-white/20 bg-black/40 px-2 py-0.5">
              {label}
            </span>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div
      id="trending-view"
      className="min-h-screen flex flex-col pb-24 sm:pb-6 sm:h-[100dvh] sm:overflow-y-auto sm:overscroll-contain"
    >
      <Header />
      <main className="max-w-6xl mx-auto w-full py-6 px-4 sm:px-6 lg:px-8 space-y-10 sm:flex-1 sm:min-h-0 sm:overflow-y-auto sm:overscroll-contain">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.25em] text-[#b9b4c7]">
            Trending + Search
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#faf0e6]">
            Explore campus discovery
          </h1>
        </div>

        {trendingNeedsRefresh && (
          <button
            type="button"
            onClick={handleTrendingRefresh}
            disabled={trendingRefreshing}
            className="glass-card border border-amber-400/30 bg-amber-400/10 text-amber-100 px-4 py-2 rounded-2xl text-sm font-semibold w-fit disabled:opacity-60"
          >
            Trending updated ↑ Tap to refresh
          </button>
        )}

        <div ref={searchRef} className="relative sm:sticky sm:top-20 z-20">
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-[#b9b4c7]"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(true);
              }}
              onFocus={() => hasSearchQuery && setShowSearchResults(true)}
              placeholder="Search students, posts, and campus signals..."
              className="w-full pl-11 pr-4 py-3 rounded-full glass-input"
            />
          </div>

          {showSearchResults && hasSearchQuery && (
            <Motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute left-0 right-0 mt-3 rounded-3xl glass-card overflow-hidden z-30"
            >
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3 bg-black/30 backdrop-blur">
                {searchTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSearchTab(tab.id)}
                    className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
                      searchTab === tab.id
                        ? "bg-white/15 text-[#faf0e6]"
                        : "text-[#b9b4c7] hover:text-[#faf0e6]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {searchSuggestions.length > 0 && (
                <div className="border-b border-white/10 px-4 py-3 bg-white/5">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                    Suggestions
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {searchSuggestions.map((item) => (
                      <button
                        key={`${item.kind}-${item.value}`}
                        type="button"
                        onClick={() => {
                          setSearchQuery(item.value);
                          setShowSearchResults(true);
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-[#faf0e6] hover:bg-white/20 transition-colors"
                      >
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px] text-[#faf0e6]">
                          <i
                            className={`fa-solid ${
                              item.kind === "community"
                                ? "fa-users"
                                : item.kind === "person"
                                  ? "fa-user"
                                  : "fa-magnifying-glass"
                            }`}
                          ></i>
                        </span>
                        <span>{item.label}</span>
                        {item.meta && <span className="text-[10px] text-[#b9b4c7]">{item.meta}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="max-h-[28rem] overflow-y-auto px-4 py-4 space-y-6">
                {searchError ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-sm text-rose-200">
                    Search unavailable
                  </div>
                ) : showSearchSkeleton ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, index) => (
                      <div
                        key={`user-skeleton-${index}`}
                        className="h-20 rounded-2xl border border-white/10 bg-white/5 animate-pulse"
                      ></div>
                    ))}
                    <div className="grid grid-cols-3 gap-2">
                      {[...Array(6)].map((_, index) => (
                        <div
                          key={`post-skeleton-${index}`}
                          className="aspect-square rounded-xl border border-white/10 bg-white/5 animate-pulse"
                        ></div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {searchLoading && searchHasResults && (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-white/20 animate-pulse"></div>
                        <div className="h-2 w-28 rounded-full bg-white/10 animate-pulse"></div>
                      </div>
                    )}

                    {searchTab === "all" && (
                      <>
                        {topResult && (
                          <section className="space-y-3">
                            <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                              Top Result
                            </h3>
                            {topResultType === "post"
                              ? renderPostCard(topResult, {
                                  variant: "featured",
                                  index: "top",
                                })
                              : renderUserCard(topResult, { variant: "top", index: "top" })}
                          </section>
                        )}

                        {peoplePreview.length > 0 && (
                          <section className="space-y-3">
                            <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                              People
                            </h3>
                            <div className="space-y-3">
                              {peoplePreview.map((user, index) =>
                                renderUserCard(user, { index })
                              )}
                            </div>
                          </section>
                        )}

                        {postsPreview.length > 0 && (
                          <section className="space-y-3">
                            <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                              Posts
                            </h3>
                            <div className="grid grid-cols-3 gap-2">
                              {postsPreview.map((post, index) =>
                                renderPostCard(post, { index })
                              )}
                            </div>
                          </section>
                        )}
                      </>
                    )}

                    {searchTab === "people" && (
                      <section className="space-y-3">
                        <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                          People
                        </h3>
                        <div className="space-y-3">
                          {peoplePreview.map((user, index) =>
                            renderUserCard(user, { index })
                          )}
                        </div>
                      </section>
                    )}

                    {searchTab === "posts" && (
                      <section className="space-y-3">
                        <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                          Posts
                        </h3>
                        <div className="grid grid-cols-3 gap-2">
                          {postsPreview.map((post, index) =>
                            renderPostCard(post, { index })
                          )}
                        </div>
                      </section>
                    )}

                    {searchTab === "communities" && (
                      <section className="space-y-3">
                        <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                          Communities
                        </h3>
                        <div className="space-y-3">
                          {communityPreview.map((user, index) =>
                            renderUserCard(user, { index })
                          )}
                        </div>
                      </section>
                    )}

                    {isEmptyState && (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-sm text-[#b9b4c7]">
                        No results found.
                      </div>
                    )}
                  </>
                )}
              </div>
            </Motion.div>
          )}
        </div>

        <section className="space-y-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-[#b9b4c7]">
                  🔥 Trending
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {TRENDING_WINDOW_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setTrendingWindow(option.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      trendingWindow === option.id
                        ? "bg-white/15 text-[#faf0e6]"
                        : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {TRENDING_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTrendingTab(tab.id)}
                  className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
                    trendingTab === tab.id
                      ? "bg-white/15 text-[#faf0e6]"
                      : "text-[#b9b4c7] hover:text-[#faf0e6]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {TRENDING_VIEWS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setTrendingView(view.id)}
                  className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
                    trendingView === view.id
                      ? "bg-white/15 text-[#faf0e6]"
                      : "text-[#b9b4c7] hover:text-[#faf0e6]"
                  }`}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </div>

          {showTrendingSkeletons ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {[...Array(8)].map((_, index) => (
                <div
                  key={`trend-skeleton-${index}`}
                  className="aspect-square rounded-2xl border border-white/10 bg-white/5 animate-pulse"
                ></div>
              ))}
            </div>
          ) : isTrendingEmpty ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-[#b9b4c7]">
              No trending content yet. Check back soon.
            </div>
          ) : (
            <>
              {trendingView === "grid" ? (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  {trendingGridItems}
                </div>
              ) : (
                <div className="space-y-6">
                  {trendingDoomItems}
                </div>
              )}
              {showTrendingLoadMore && (
                <div
                  ref={trendingLoadMoreRef}
                  className="h-10 flex items-center justify-center text-xs text-[#b9b4c7]"
                >
                  {trendingPostsLoading ? "Loading more..." : "Loading more..."}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {selectedStoryIndex !== null && (
        <StoryViewer
          stories={groupedStories}
          initialIndex={selectedStoryIndex}
          onClose={() => setSelectedStoryIndex(null)}
        />
      )}

      {commentPost && (
        <CommentModal
          post={commentPost}
          isOpen={!!commentPost}
          onClose={() => setCommentPost(null)}
        />
      )}

      {selectedPost && (
        <PostModal
          post={selectedPost}
          isOpen={!!selectedPost}
          onClose={() => setSelectedPost(null)}
          onDelete={() => {}}
        />
      )}

      {sharePost && (
        <ShareSheet
          isOpen={!!sharePost}
          onClose={() => setSharePost(null)}
          postUrl={sharePostUrl}
          postTitle={sharePost.content}
          postId={sharePostId}
          postThumbnail={sharePostThumbnail}
          postPreviewText={sharePostPreviewText}
          isPrivate={sharePostIsPrivate}
          isAnonymous={sharePost?.isAnonymous}
          onShareToChat={() => {
            setShareChatPost(sharePost);
            setSharePost(null);
          }}
        />
      )}

      {shareChatPost && (
        <ShareToChatModal
          isOpen={!!shareChatPost}
          onClose={() => setShareChatPost(null)}
          postUrl={shareChatPostUrl}
          postTitle={shareChatPost.content}
          postId={shareChatPostId}
          postThumbnail={shareChatPostThumbnail}
          postPreviewText={shareChatPostPreviewText}
          postIsAnonymous={shareChatPost?.isAnonymous}
          postAuthorName={shareChatPostAuthorName}
          postAuthorId={shareChatPostAuthorId}
        />
      )}


      <CreatePostModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <BottomNav onCreate={() => setShowCreateModal(true)} overlay={showCreateModal} />
    </div>
  );
}
