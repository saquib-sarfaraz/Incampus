import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion as Motion } from "framer-motion";
import { useLocation, useSearchParams } from "react-router-dom";
import { useApp } from "../context/useApp";
import { useAuth } from "../context/authContext";
import StoryBar from "../components/stories/StoryBar";
import Post from "../components/feed/Post";
import PostCreator from "../components/feed/PostCreator";
import Header from "../components/common/Header";
import BottomNav from "../components/common/BottomNav";
import CreatePostModal from "../components/feed/CreatePostModal";
import PostModal from "../components/profile/PostModal";
import TrendingSidebar from "../components/feed/TrendingSidebar";
import ChatSidebar from "../components/chat/ChatSidebar";
import { fetchRankedFeedPage } from "../services/api";
import {
  getLikeCount,
  getCommentCount,
  getShareCount,
  getViewCount,
  getTimestamp,
  shouldExcludeContent,
  isContentUnderReview,
  isMutedByUser,
} from "../utils/feedRanking";
import { getSocket } from "../services/socket";

const FEED_PAGE_LIMIT = 20;
const FEED_REFRESH_MS = 90000;
const COLLEGE_REFRESH_MS = 120000;
const FEED_WINDOW_SIZE = 20;
const FEED_ESTIMATED_ITEM_HEIGHT = 420;
const FEED_PREFETCH_THRESHOLD = 2;
const FRIEND_BADGE = {
  text: "👥 Friend",
  tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
};
const CAMPUS_BADGE = {
  text: "🎓 Campus",
  tone: "border-sky-400/30 bg-sky-400/10 text-sky-200",
};
const TRENDING_BADGE = {
  text: "🔥 Trending",
  tone: "border-amber-400/30 bg-amber-400/10 text-amber-200",
};

const resolveBadge = (badgeKey) => {
  if (badgeKey === "friend") return FRIEND_BADGE;
  if (badgeKey === "campus") return CAMPUS_BADGE;
  if (badgeKey === "trending") return TRENDING_BADGE;
  return null;
};

const isLikelyId = (value) => {
  if (value === null || value === undefined) return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  if (/^[a-f0-9]{24}$/i.test(trimmed)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return true;
  }
  if (/^\d+$/.test(trimmed)) return true;
  return false;
};

const getAuthorId = (post) => {
  const candidate =
    post.author?._id ||
    post.author?.id ||
    post.authorId ||
    post.author_id ||
    post.userId ||
    post.user_id ||
    post.author ||
    "";
  return isLikelyId(candidate) ? String(candidate) : "";
};

const resolvePostId = (post, index) => {
  const id = post?._id || post?.id || post?.postId || post?.post_id;
  if (id) return String(id);
  return `post-${index}`;
};

const resolvePostIdentity = (post) => {
  const id = post?._id || post?.id || post?.postId || post?.post_id;
  if (id) return String(id);
  const authorId = getAuthorId(post);
  const createdAt = post?.createdAt || post?.created_at || post?.timestamp || "";
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

const resolvePostKey = (post, index) => {
  const id = resolvePostId(post, index);
  if (id) return String(id);
  const authorId = getAuthorId(post);
  const createdAt = post.createdAt || post.created_at || post.timestamp || "";
  if (authorId || createdAt) return `${authorId || "post"}-${createdAt || index}`;
  return `post-${index}`;
};

const UnderReviewCard = () => {
  return (
    <div className="glass-card rounded-3xl border border-amber-200/20 bg-amber-200/5 p-6 min-h-[220px] flex flex-col justify-center">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-full border border-amber-200/40 bg-amber-200/10 flex items-center justify-center text-amber-100">
          <i className="fa-solid fa-shield-halved text-base"></i>
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-100">Post under review</p>
          <p className="text-xs text-[#b9b4c7]">
            We’re checking this post. It will reappear if approved.
          </p>
        </div>
      </div>
      <p className="mt-4 text-[11px] text-[#b9b4c7]">
        Thanks for helping keep the community safe.
      </p>
    </div>
  );
};

const resolveUserCampus = (user) => {
  return (
    user?.university ||
    user?.college ||
    user?.campus ||
    user?.school ||
    user?.course ||
    ""
  );
};

const resolvePostCampus = (post) => {
  return (
    post.university ||
    post.college ||
    post.campus ||
    post.school ||
    post.collegeTagName ||
    post.collegeTag ||
    post.author?.university ||
    post.author?.college ||
    post.author?.campus ||
    post.author?.school ||
    ""
  );
};

const resolvePostCollegeTag = (post) => {
  return (
    post.collegeTagName ||
    post.collegeTag ||
    post.collegeName ||
    post.college ||
    post.university ||
    ""
  );
};

const resolveUserCollegeId = (user) => {
  return (
    user?.collegeId ||
    user?.collegeTagId ||
    user?.college_group_id ||
    user?.collegeGroupId ||
    user?.collegeGroup ||
    user?.groupId ||
    ""
  );
};

const resolvePostCollegeId = (post) => {
  return (
    post.collegeId ||
    post.collegeTagId ||
    post.college_group_id ||
    post.collegeGroupId ||
    post.collegeGroup ||
    post.groupId ||
    post.college?.id ||
    post.college?._id ||
    ""
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

const matchesCampus = (post, campusLower) => {
  const postCampus = resolvePostCampus(post);
  const postTag = resolvePostCollegeTag(post);
  const campusMatch =
    postCampus && String(postCampus).toLowerCase() === campusLower;
  const tagMatch = postTag && String(postTag).toLowerCase() === campusLower;
  return campusMatch || tagMatch;
};

const isAnonymousPost = (post) =>
  Boolean(
    post?.isAnonymous ||
      post?.anonymous ||
      post?.isAnon ||
      post?.isAnonymousPost ||
      post?.author?.isAnonymous
  );

const toCount = (value) => {
  if (Array.isArray(value)) return value.length;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const getStoryReshareCount = (post) => {
  if (!post) return 0;
  if (Array.isArray(post.storyReshares)) return post.storyReshares.length;
  return toCount(
    post.storyResharesCount ??
      post.storyReshareCount ??
      post.reshareCount ??
      post.reshares ??
      0
  );
};

const getEngagementScore = (post) => {
  const likes = getLikeCount(post);
  const comments = getCommentCount(post);
  const shares = getShareCount(post);
  const reshares = getStoryReshareCount(post);
  const views = getViewCount(post);
  return likes * 2 + comments * 3 + shares * 4 + reshares * 3 + views * 0.2;
};

const resolveFeedOrderKey = (post) => resolvePostIdentity(post) || "";

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

export default function Feed() {
  const { posts, loading, feedScope, isUserBlocked, isFriend, loadPosts, loadStories } =
    useApp();
  const { currentUser } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sharedPost, setSharedPost] = useState(null);
  const [rankedPosts, setRankedPosts] = useState([]);
  const [rankedPage, setRankedPage] = useState(1);
  const [rankedHasMore, setRankedHasMore] = useState(true);
  const [rankedLoading, setRankedLoading] = useState(false);
  const [rankedError, setRankedError] = useState("");
  const [feedBooting, setFeedBooting] = useState(true);
  const [feedCursor, setFeedCursor] = useState({ key: "", page: 0 });
  const [newPostsAvailable, setNewPostsAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadMoreRef = useRef(null);
  const feedViewRef = useRef(null);
  const feedMainRef = useRef(null);
  const scrollRafRef = useRef(null);
  const windowStartRef = useRef(0);
  const heightStatsRef = useRef({ total: 0, count: 0 });
  const heightMapRef = useRef(new Map());
  const prefetchRef = useRef({ cursor: "", data: null, promise: null });
  const rankedPostsRef = useRef([]);
  const rankedLoadingRef = useRef(false);
  const rankedCursorRef = useRef("");
  const latestPostRef = useRef("");
  const sharedPostRef = useRef(null);
  const openedPostRef = useRef("");

  const campusLabel = resolveUserCampus(currentUser);
  const campusId = resolveUserCollegeId(currentUser);
  const shouldFilterByCollege = feedScope === "college";
  const feedKey = useMemo(
    () => `${feedScope}-${campusLabel || ""}-${campusId || ""}`,
    [feedScope, campusLabel, campusId]
  );

  useEffect(() => {
    setFeedBooting(true);
  }, [feedKey]);

  const checkForNewPosts = useCallback(async () => {
    if (shouldFilterByCollege) return false;
    try {
      const response = await fetchRankedFeedPage({ page: 1, limit: 1 });
      const { items: list } = normalizeRankedResponse(response);
      const latest = list[0];
      const latestId = latest ? resolvePostIdentity(latest) : "";
      if (!latestId) return false;
      if (!latestPostRef.current) {
        latestPostRef.current = latestId;
        return false;
      }
      return latestId !== latestPostRef.current;
    } catch {
      return false;
    }
  }, [shouldFilterByCollege]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (refreshing) return;
      const hasNew = await checkForNewPosts();
      if (hasNew) setNewPostsAvailable(true);
    }, shouldFilterByCollege ? COLLEGE_REFRESH_MS : FEED_REFRESH_MS);
    return () => clearInterval(interval);
  }, [checkForNewPosts, shouldFilterByCollege, refreshing]);

  const consumePrefetch = useCallback((cursor) => {
    const cached = prefetchRef.current;
    if (cached.cursor !== cursor || !cached.data) return null;
    prefetchRef.current = { cursor: "", data: null, promise: null };
    return cached.data;
  }, []);

  const prefetchPage = useCallback(async (cursor) => {
    if (!cursor || prefetchRef.current.cursor === cursor) return;
    prefetchRef.current = { cursor, data: null, promise: null };
    try {
      const response = await fetchRankedFeedPage({ cursor, limit: FEED_PAGE_LIMIT });
      const normalized = normalizeRankedResponse(response);
      if (prefetchRef.current.cursor === cursor) {
        prefetchRef.current = { cursor, data: normalized, promise: null };
      }
    } catch {
      if (prefetchRef.current.cursor === cursor) {
        prefetchRef.current = { cursor: "", data: null, promise: null };
      }
    }
  }, []);

  const loadRankedPage = useCallback(
    async (page, { replace = false } = {}) => {
      if (rankedLoadingRef.current) return;
      rankedLoadingRef.current = true;
      setRankedLoading(true);
      setRankedError("");
      try {
        const cursorParam = replace ? "" : rankedCursorRef.current || "";
        const prefetched = consumePrefetch(cursorParam);
        const params = {
          limit: FEED_PAGE_LIMIT,
          ...(cursorParam ? { cursor: cursorParam } : { page: page || 1 }),
        };
        const response = prefetched
          ? prefetched
          : await fetchRankedFeedPage(params);
        const { items: list, nextCursor, hasMore: hasMoreFromBackend } =
          normalizeRankedResponse(response);
        const basePosts = rankedPostsRef.current;
        const existingIds = new Set(
          basePosts.map((post) => resolvePostIdentity(post)).filter(Boolean)
        );
        const uniqueList = list.filter((post) => {
          const id = resolvePostIdentity(post);
          if (!id) return true;
          if (existingIds.has(id)) return false;
          existingIds.add(id);
          return true;
        });
        const nextPosts = replace
          ? [...uniqueList, ...basePosts]
          : [...basePosts, ...uniqueList];
        const shouldPrimeCursor = basePosts.length === 0;
        const resolvedCursor = nextCursor || resolveCursorValue(list[list.length - 1]);
        if ((shouldPrimeCursor || !replace) && resolvedCursor) {
          rankedCursorRef.current = resolvedCursor;
        }
        rankedPostsRef.current = nextPosts;
        setRankedPosts(nextPosts);
        const canLoadMore =
          typeof hasMoreFromBackend === "boolean"
            ? hasMoreFromBackend
            : list.length >= FEED_PAGE_LIMIT;
        if (!replace || shouldPrimeCursor) {
          setRankedHasMore(canLoadMore);
        }
        setRankedPage(page);
        if (canLoadMore && resolvedCursor && (!replace || shouldPrimeCursor)) {
          prefetchPage(resolvedCursor);
        }
      } catch (error) {
        setRankedError(error?.message || "Unable to load feed.");
        setRankedHasMore(false);
      } finally {
        rankedLoadingRef.current = false;
        setRankedLoading(false);
      }
    },
    [consumePrefetch, prefetchPage]
  );

  const handleRefreshFeed = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNewPostsAvailable(false);
    try {
      await loadPosts?.();
      if (loadStories) {
        await loadStories();
      }
      if (!shouldFilterByCollege) {
        await loadRankedPage(1, { replace: true });
      }
    } finally {
      setRefreshing(false);
    }
  }, [loadPosts, loadStories, shouldFilterByCollege, loadRankedPage, refreshing]);

  const loadMoreRanked = useCallback(() => {
    if (rankedLoading || !rankedHasMore) return;
    loadRankedPage(rankedPage + 1);
  }, [rankedLoading, rankedHasMore, rankedPage, loadRankedPage]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !loadPosts) return;
    const handleFeedUpdate = () => {
      setNewPostsAvailable(true);
    };
    socket.off("feed-update", handleFeedUpdate);
    socket.on("feed-update", handleFeedUpdate);
    return () => socket.off("feed-update", handleFeedUpdate);
  }, [loadPosts]);

  useEffect(() => {
    if (shouldFilterByCollege) return;
    const hasExisting = rankedPostsRef.current.length > 0;
    if (!hasExisting) {
      setRankedPosts([]);
      setRankedPage(1);
      setRankedHasMore(true);
      setRankedError("");
      prefetchRef.current = { cursor: "", data: null, promise: null };
      rankedPostsRef.current = [];
      rankedLoadingRef.current = false;
      rankedCursorRef.current = "";
    }
    loadRankedPage(1, { replace: !hasExisting });
  }, [shouldFilterByCollege, loadRankedPage]);

  const scopedPosts = useMemo(() => {
    const postsArray = (Array.isArray(posts) ? posts : []).filter((post) => {
      if (shouldExcludeContent(post)) return false;
      const authorId = getAuthorId(post);
      if (isUserBlocked(authorId)) return false;
      if (isMutedByUser(post, currentUser?.id)) return false;
      const privacy = resolvePostPrivacy(post);
      if (privacy === "friends") {
        if (!shouldFilterByCollege) return false;
        if (!isFriend(authorId) && String(authorId) !== String(currentUser?.id)) {
          return false;
        }
      }
      if (privacy === "college" && !shouldFilterByCollege) {
        return false;
      }
      return true;
    });
    return postsArray;
  }, [
    posts,
    shouldFilterByCollege,
    isUserBlocked,
    isFriend,
    currentUser?.id,
  ]);

  const matchesCollege = useCallback(
    (post) => {
      const postCollegeId = resolvePostCollegeId(post);
      if (campusId && postCollegeId) {
        return String(campusId) === String(postCollegeId);
      }
      if (!campusLabel) return false;
      const campusLower = campusLabel.toLowerCase();
      return matchesCampus(post, campusLower);
    },
    [campusId, campusLabel]
  );

  const isFriendPost = useCallback(
    (post) => {
      const authorId = getAuthorId(post);
      if (!authorId) return false;
      if (String(authorId) === String(currentUser?.id)) return true;
      return isFriend(authorId);
    },
    [isFriend, currentUser?.id]
  );

  const mergeUniquePosts = useCallback((primary, secondary) => {
    const base = Array.isArray(primary) ? primary : [];
    const extras = Array.isArray(secondary) ? secondary : [];
    const combined = [...base];
    const indexById = new Map();
    combined.forEach((post, index) => {
      const id = resolvePostIdentity(post);
      if (id) indexById.set(id, index);
    });
    extras.forEach((post) => {
      const id = resolvePostIdentity(post);
      if (!id) {
        combined.push(post);
        return;
      }
      if (indexById.has(id)) {
        const idx = indexById.get(id);
        const current = combined[idx];
        if (current === post) {
          return;
        }
        let changed = false;
        if (post && typeof post === "object") {
          for (const key of Object.keys(post)) {
            if (post[key] !== current?.[key]) {
              changed = true;
              break;
            }
          }
        } else if (post !== current) {
          changed = true;
        }
        if (changed) {
          combined[idx] = { ...current, ...post };
        }
      } else {
        indexById.set(id, combined.length);
        combined.push(post);
      }
    });
    return combined;
  }, []);

  const collegeFeedPosts = useMemo(() => {
    if (!shouldFilterByCollege) return [];
    if (!campusLabel && !campusId) {
      return [...scopedPosts].sort((a, b) => getTimestamp(b) - getTimestamp(a));
    }
    return scopedPosts
      .filter((post) => {
        const authorId = getAuthorId(post);
        if (String(authorId) === String(currentUser?.id)) return true;
        return matchesCollege(post);
      })
      .sort((a, b) => {
        return getTimestamp(b) - getTimestamp(a);
      });
  }, [
    shouldFilterByCollege,
    scopedPosts,
    campusLabel,
    campusId,
    currentUser?.id,
    matchesCollege,
  ]);

  const universalFeedMeta = useMemo(() => {
    if (shouldFilterByCollege) {
      return { posts: [], badgeMap: new Map(), trendingIds: new Set() };
    }
    const base =
      rankedPosts.length > 0 ? mergeUniquePosts(rankedPosts, scopedPosts) : scopedPosts;
    const filtered = base.filter((post) => {
      if (shouldExcludeContent(post)) return false;
      const authorId = getAuthorId(post);
      if (isUserBlocked(authorId)) return false;
      if (isMutedByUser(post, currentUser?.id)) return false;
      const privacy = resolvePostPrivacy(post);
      return privacy === "public";
    });

    const orderMap = new Map();
    base.forEach((post, index) => {
      const key = resolveFeedOrderKey(post);
      if (key) {
        orderMap.set(key, index);
      }
    });

    const sortedByTime = [...filtered].sort((a, b) => {
      const diff = getTimestamp(b) - getTimestamp(a);
      if (diff !== 0) return diff;
      const aKey = resolveFeedOrderKey(a);
      const bKey = resolveFeedOrderKey(b);
      return (orderMap.get(aKey) ?? 0) - (orderMap.get(bKey) ?? 0);
    });

    const entries = filtered.map((post, index) => {
      const id = resolvePostId(post, index);
      const isFriendEntry = isFriendPost(post);
      const isCollegeEntry = matchesCollege(post);
      const baseScore = getEngagementScore(post);
      return {
        post,
        id,
        baseScore,
        isFriend: isFriendEntry,
        isCollege: isCollegeEntry,
        timestamp: getTimestamp(post),
      };
    });

    const globalCandidates = entries.filter(
      (entry) => !entry.isFriend && !entry.isCollege
    );
    const sortedGlobal = [...globalCandidates].sort(
      (a, b) => b.baseScore - a.baseScore
    );
    const take = Math.max(1, Math.ceil(sortedGlobal.length * 0.1));
    const trendingIds = new Set(sortedGlobal.slice(0, take).map((entry) => entry.id));

    const badgeMap = new Map();
    entries.forEach((entry) => {
      const post = entry.post;
      const hasTrendingFlag = Boolean(
        post?.isTrending ||
          post?.trending ||
          post?.trendingScore ||
          post?.trending_score
      );
      const isTrendingGlobal = trendingIds.has(entry.id) || hasTrendingFlag;
      if (entry.isFriend && !isAnonymousPost(post)) {
        badgeMap.set(entry.id, "friend");
      } else if (entry.isCollege) {
        badgeMap.set(entry.id, "campus");
      } else if (isTrendingGlobal) {
        badgeMap.set(entry.id, "trending");
      }
    });

    return {
      posts: sortedByTime,
      badgeMap,
      trendingIds,
    };
  }, [
    shouldFilterByCollege,
    rankedPosts,
    scopedPosts,
    mergeUniquePosts,
    isUserBlocked,
    currentUser?.id,
    isFriendPost,
    matchesCollege,
  ]);

  const finalFeedPosts = shouldFilterByCollege ? collegeFeedPosts : universalFeedMeta.posts;
  const activePage = feedCursor.key === feedKey ? feedCursor.page : 0;
  const visibleCount = 8 + activePage * 6;
  const showSkeletons = shouldFilterByCollege
    ? (loading || feedBooting) && finalFeedPosts.length === 0
    : (rankedLoading || feedBooting) && finalFeedPosts.length === 0 && !rankedError;
  const hasMore = shouldFilterByCollege
    ? visibleCount < finalFeedPosts.length
    : rankedHasMore;
  const showLoadMoreSkeletons =
    !shouldFilterByCollege && rankedLoading && finalFeedPosts.length > 0 && hasMore;
  const displayedPosts = shouldFilterByCollege
    ? finalFeedPosts.slice(0, visibleCount)
    : finalFeedPosts;
  const showRankedError =
    !shouldFilterByCollege && rankedError && finalFeedPosts.length === 0 && !feedBooting;
  const showEmptyState =
    finalFeedPosts.length === 0 && !showSkeletons && !showRankedError && !feedBooting;
  const postParam = (searchParams.get("post") || "").trim();
  const trendingSidebarItems = useMemo(() => {
    if (!finalFeedPosts.length) return [];
    const entries = finalFeedPosts
      .map((post, index) => {
        const id = resolvePostId(post, index);
        if (!id) return null;
        return {
          id,
          post,
          score: getEngagementScore(post),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    return entries;
  }, [finalFeedPosts]);

  useEffect(() => {
    if (location.state?.sharedPost) {
      sharedPostRef.current = location.state.sharedPost;
    }
  }, [location.state]);

  useEffect(() => {
    if (!postParam) {
      if (sharedPost) setSharedPost(null);
      openedPostRef.current = "";
      return;
    }
    if (openedPostRef.current === postParam) return;
    const found = finalFeedPosts.find(
      (post) =>
        String(post?._id || post?.id || post?.postId || post?.post_id) === String(postParam)
    );
    if (found) {
      setSharedPost(found);
      openedPostRef.current = postParam;
      return;
    }
    const fallback = sharedPostRef.current;
    if (fallback) {
      setSharedPost({ ...fallback, _id: fallback._id || postParam });
      openedPostRef.current = postParam;
    }
  }, [postParam, finalFeedPosts, sharedPost]);

  const handleCloseSharedPost = useCallback(() => {
    setSharedPost(null);
    if (!searchParams.has("post")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("post");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleOpenTrendingPost = useCallback(
    (postId) => {
      if (!postId) return;
      const next = new URLSearchParams(searchParams);
      next.set("post", String(postId));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    const latestId = finalFeedPosts.length
      ? resolvePostIdentity(finalFeedPosts[0]) || ""
      : "";
    if (latestId) {
      latestPostRef.current = latestId;
    }
  }, [finalFeedPosts]);

  useEffect(() => {
    if (!feedBooting) return;
    if (shouldFilterByCollege) {
      if (!loading) setFeedBooting(false);
      return;
    }
    if (!rankedLoading) setFeedBooting(false);
  }, [feedBooting, shouldFilterByCollege, loading, rankedLoading]);

  const [windowStart, setWindowStart] = useState(0);
  const [estimatedItemHeight, setEstimatedItemHeight] = useState(FEED_ESTIMATED_ITEM_HEIGHT);

  const registerItemHeight = useCallback(
    (index, node) => {
      if (!node || index < 0) return;
      const height = Math.round(node.getBoundingClientRect().height || 0);
      if (!Number.isFinite(height) || height <= 0) return;
      const map = heightMapRef.current;
      const prev = map.get(index);
      if (prev && Math.abs(prev - height) < 4) return;
      map.set(index, height);
      const stats = heightStatsRef.current;
      if (prev) {
        stats.total += height - prev;
      } else {
        stats.total += height;
        stats.count += 1;
      }
      if (stats.count >= 3) {
        const nextAvg = Math.round(stats.total / stats.count);
        if (Math.abs(nextAvg - estimatedItemHeight) > 12) {
          setEstimatedItemHeight(nextAvg);
        }
      }
    },
    [estimatedItemHeight]
  );

  const maxWindowStart = Math.max(0, displayedPosts.length - FEED_WINDOW_SIZE);
  const windowEnd = Math.min(windowStart + FEED_WINDOW_SIZE, displayedPosts.length);
  const windowedPosts = useMemo(
    () => displayedPosts.slice(windowStart, windowEnd),
    [displayedPosts, windowStart, windowEnd]
  );
  const topSpacerHeight = windowStart * estimatedItemHeight;
  const bottomSpacerHeight =
    Math.max(0, displayedPosts.length - windowEnd) * estimatedItemHeight;
  const effectiveBottomSpacerHeight = showLoadMoreSkeletons
    ? Math.min(bottomSpacerHeight, estimatedItemHeight * 2)
    : bottomSpacerHeight;

  const renderedWindowedPosts = useMemo(() => {
    return windowedPosts.map((post, index) => {
      const absoluteIndex = windowStart + index;
      const postId = resolvePostId(post, absoluteIndex);
      const postKey = resolvePostKey(post, absoluteIndex);
      if (isContentUnderReview(post)) {
        return (
          <div
            key={`${postKey}-review`}
            ref={(node) => registerItemHeight(absoluteIndex, node)}
          >
            <UnderReviewCard />
          </div>
        );
      }
      let badge = null;
      if (!shouldFilterByCollege) {
        const badgeKey = universalFeedMeta.badgeMap.get(postId);
        badge = resolveBadge(badgeKey);
      } else {
        const friendBadge =
          isFriendPost(post) && !isAnonymousPost(post) ? FRIEND_BADGE : null;
        const campusBadge = friendBadge ? null : matchesCollege(post) ? CAMPUS_BADGE : null;
        badge = friendBadge || campusBadge;
      }
      return (
        <div
          key={postKey}
          ref={(node) => registerItemHeight(absoluteIndex, node)}
        >
          <Post post={post} badge={badge} />
        </div>
      );
    });
  }, [
    windowedPosts,
    windowStart,
    registerItemHeight,
    shouldFilterByCollege,
    universalFeedMeta.badgeMap,
    isFriendPost,
    matchesCollege,
  ]);

  useEffect(() => {
    if (windowStart > maxWindowStart) {
      setWindowStart(maxWindowStart);
    }
  }, [maxWindowStart, windowStart]);

  useEffect(() => {
    if (shouldFilterByCollege) return;
    if (rankedLoading || !rankedHasMore) return;
    const remaining = displayedPosts.length - windowEnd;
    if (remaining <= FEED_PREFETCH_THRESHOLD) {
      loadMoreRanked();
    }
  }, [
    shouldFilterByCollege,
    rankedLoading,
    rankedHasMore,
    displayedPosts.length,
    windowEnd,
    loadMoreRanked,
  ]);

  useEffect(() => {
    setWindowStart(0);
    windowStartRef.current = 0;
    heightMapRef.current.clear();
    heightStatsRef.current = { total: 0, count: 0 };
    setEstimatedItemHeight(FEED_ESTIMATED_ITEM_HEIGHT);
  }, [feedKey]);

  const resolveScrollElement = useCallback(() => {
    if (typeof document === "undefined") return null;
    const mainEl = feedMainRef.current;
    if (mainEl && mainEl.scrollHeight > mainEl.clientHeight + 4) return mainEl;
    const viewEl = feedViewRef.current;
    if (viewEl && viewEl.scrollHeight > viewEl.clientHeight + 4) return viewEl;
    return document.scrollingElement || document.documentElement;
  }, []);

  const getScrollMetrics = useCallback(
    (target) => {
      if (typeof document === "undefined") return null;
      const docEl = document.scrollingElement || document.documentElement;
      const scrollEl = target || resolveScrollElement();
      if (!scrollEl) return null;
      const isDoc = scrollEl === docEl || scrollEl === document.body;
      return {
        scrollEl,
        scrollTop: isDoc ? docEl.scrollTop : scrollEl.scrollTop,
        scrollHeight: isDoc ? docEl.scrollHeight : scrollEl.scrollHeight,
        clientHeight: isDoc ? window.innerHeight : scrollEl.clientHeight,
      };
    },
    [resolveScrollElement]
  );

  useEffect(() => {
    windowStartRef.current = windowStart;
  }, [windowStart]);

  const handleWindowScroll = useCallback(
    (event) => {
      if (scrollRafRef.current) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const target =
          event && event.currentTarget && event.currentTarget !== window
            ? event.currentTarget
            : null;
        const metrics = getScrollMetrics(target);
        if (!metrics) return;
        const { scrollTop, scrollHeight, clientHeight } = metrics;
        const approxIndex = Math.floor(
          scrollTop / Math.max(estimatedItemHeight, 1)
        );
        const buffer = Math.max(4, Math.floor(FEED_WINDOW_SIZE / 3));
        const nextStart = Math.min(
          maxWindowStart,
          Math.max(0, approxIndex - buffer)
        );
        if (nextStart !== windowStart) {
          setWindowStart(nextStart);
        }
      });
    },
    [
      getScrollMetrics,
      estimatedItemHeight,
      maxWindowStart,
      windowStart,
    ]
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onScroll = () => handleWindowScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [handleWindowScroll]);

  useEffect(() => {
    setNewPostsAvailable(false);
  }, [feedKey]);

  useEffect(() => {
    if (!loadMoreRef.current) return;
    if (!hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (shouldFilterByCollege) {
          setFeedCursor((prev) => {
            const basePage = prev.key === feedKey ? prev.page : 0;
            const maxPage = Math.max(0, Math.ceil((finalFeedPosts.length - 8) / 6));
            const nextPage = Math.min(basePage + 1, maxPage);
            return { key: feedKey, page: nextPage };
          });
        } else {
          loadMoreRanked();
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [
    hasMore,
    finalFeedPosts.length,
    feedKey,
    shouldFilterByCollege,
    loadMoreRanked,
  ]);

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

  return (
    <div
      id="feed-view"
      ref={feedViewRef}
      onScroll={handleWindowScroll}
      className="min-h-[100dvh] flex flex-col pb-24 sm:pb-6 sm:h-[100dvh] sm:overflow-y-auto sm:overscroll-contain"
    >
      <Header />
      <main
        id="feed"
        ref={feedMainRef}
        onScroll={handleWindowScroll}
        className="w-full py-4 sm:py-6 lg:py-4 px-3 sm:px-4 lg:px-0 sm:flex-1 sm:min-h-0 sm:overflow-y-auto sm:overscroll-contain"
      >
        <div className="mx-auto w-full max-w-6xl lg:max-w-screen-2xl flex flex-col lg:flex-row lg:justify-center lg:gap-6 lg:px-6">
          <aside className="hidden lg:block lg:w-[260px] xl:w-[280px] lg:sticky lg:top-24 h-fit self-start">
            <TrendingSidebar
              items={trendingSidebarItems}
              onOpenPost={handleOpenTrendingPost}
            />
          </aside>

          <div className="w-full lg:w-[720px] xl:w-[760px] flex-shrink-0">
            <div className="mb-4 lg:mb-2 space-y-3 lg:space-y-2">
              <div className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-[0.25em] text-[#b9b4c7]">
                  {feedScope === "college" ? "🏫 Your Campus Feed" : "🌍 Campus Network"}
                </p>
                {!shouldFilterByCollege && universalFeedMeta.trendingIds.size > 0 && (
                  <span className="inline-flex w-fit items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">
                    🔥 Trending
                  </span>
                )}
                {feedScope === "college" && !campusLabel && (
                  <p className="text-sm text-[#b9b4c7]">
                    Set your university to filter your feed. Showing all posts for now.
                  </p>
                )}
              </div>
              {newPostsAvailable && (
                <button
                  type="button"
                  onClick={handleRefreshFeed}
                  className="glass-card border border-sky-400/30 bg-sky-400/10 text-sky-100 px-4 py-2 rounded-2xl text-sm font-semibold w-fit"
                >
                  New posts available ↑ Tap to refresh
                </button>
              )}
            </div>

            <section className="space-y-4 lg:space-y-2">
              <div className="hidden sm:block">
                <PostCreator />
              </div>
              <StoryBar />

      {showSkeletons ? (
        <div className="space-y-4 lg:space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="glass-card rounded-3xl p-6 lg:p-4 animate-pulse"
            >
                      <div className="h-4 bg-white/10 rounded w-3/4 mb-4"></div>
                      <div className="h-28 bg-white/10 rounded mb-4"></div>
                      <div className="h-4 bg-white/10 rounded w-1/2"></div>
                    </div>
                  ))}
                </div>
      ) : showRankedError ? (
        <div className="text-center py-12 glass-card rounded-3xl">
          <i className="fa-solid fa-triangle-exclamation text-3xl text-[#b9b4c7] mb-3"></i>
          <p className="text-[#b9b4c7]">{rankedError}</p>
        </div>
      ) : showEmptyState ? (
                <div className="text-center py-12 glass-card rounded-3xl">
                  <i className="fa-solid fa-inbox text-3xl text-[#b9b4c7] mb-3"></i>
                  <p className="text-[#b9b4c7]">
                    No posts yet. Be the first to share!
                  </p>
                </div>
              ) : (
        <div className="space-y-4 lg:space-y-2">
          {topSpacerHeight > 0 && (
            <div
              aria-hidden="true"
              style={{ height: `${topSpacerHeight}px` }}
            />
          )}
          {renderedWindowedPosts}
          {hasMore && (
            <div
              ref={loadMoreRef}
              className="h-10 flex items-center justify-center text-xs text-[#b9b4c7]"
            >
              Loading more...
            </div>
          )}
          {showLoadMoreSkeletons && (
            <div className="space-y-4 lg:space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={`feed-loading-${i}`}
                  className="glass-card rounded-3xl p-6 lg:p-4 animate-pulse"
                >
                  <div className="h-4 bg-white/10 rounded w-3/4 mb-4"></div>
                  <div className="h-28 bg-white/10 rounded mb-4"></div>
                  <div className="h-4 bg-white/10 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          )}
          {bottomSpacerHeight > 0 && (
            <div
              aria-hidden="true"
              style={{ height: `${effectiveBottomSpacerHeight}px` }}
            />
          )}
                </div>
              )}
            </section>
          </div>

          <aside className="hidden lg:block lg:w-[320px] xl:w-[340px] lg:sticky lg:top-24 h-fit self-start">
            <ChatSidebar />
          </aside>
        </div>
      </main>
      <Motion.button
        type="button"
        onClick={() => setShowCreateModal(true)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={`hidden sm:flex fixed bottom-6 right-6 z-40 create-fab liquid-button h-14 w-14 items-center justify-center text-[#faf0e6] ${
          showCreateModal ? "opacity-0 pointer-events-none" : ""
        }`}
        aria-label="Create post"
      >
        <i className="fa-solid fa-plus text-lg"></i>
      </Motion.button>
      {sharedPost && (
        <PostModal
          post={sharedPost}
          isOpen={!!sharedPost}
          onClose={handleCloseSharedPost}
          onDelete={() => {}}
        />
      )}
      <CreatePostModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <BottomNav onCreate={() => setShowCreateModal(true)} overlay={showCreateModal} />
    </div>
  );
}
