import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion as Motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/useApp";
import { useAuth } from "../context/authContext";
import { searchAll, searchUsers, likePost } from "../services/api";
import Header from "../components/common/Header";
import BottomNav from "../components/common/BottomNav";
import CreatePostModal from "../components/feed/CreatePostModal";
import UserProfileModal from "../components/profile/UserProfileModal";
import CommentModal from "../components/feed/CommentModal";
import PostModal from "../components/profile/PostModal";
import ShareSheet from "../components/common/ShareSheet";
import ShareToChatModal from "../components/common/ShareToChatModal";
import StoryViewer from "../components/stories/StoryViewer";
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
} from "../utils/userProfile";
import { getOptimizedMediaUrl, getMediaSrcSet } from "../utils/media";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_CACHE_LIMIT = 5;
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

const getLikeCount = (post) => {
  if (Array.isArray(post.likes)) return post.likes.length;
  return Number(post.likes || post.likeCount || post.likesCount || 0);
};

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
      return { user, rank: match.rank, label: match.label };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.label.localeCompare(b.label);
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
  const [trendingVisibleCount, setTrendingVisibleCount] = useState(12);
  const [friendActionLoading, setFriendActionLoading] = useState({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [commentPost, setCommentPost] = useState(null);
  const [sharePost, setSharePost] = useState(null);
  const [shareChatPost, setShareChatPost] = useState(null);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState(null);
  const searchRef = useRef(null);
  const trendingLoadMoreRef = useRef(null);
  const searchAbortRef = useRef(null);
  const searchRequestRef = useRef(0);
  const searchCacheRef = useRef(new Map());

  const setActionLoading = useCallback((userId, value) => {
    if (!userId) return;
    setFriendActionLoading((prev) => ({ ...prev, [userId]: value }));
  }, []);

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
    cache.set(query, data);
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
      cache.forEach((_, key) => {
        if (query.startsWith(key) && key.length > bestKey.length) {
          bestKey = key;
        }
      });
      if (!bestKey) return null;
      const base = cache.get(bestKey);
      const baseUsers = Array.isArray(base?.users) ? base.users : [];
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
      setSearchData(cached);
      setSearchLoading(false);
      return;
    }

    const prefixCached = getCachedPrefixResults(normalizedSearchQuery);
    if (prefixCached) {
      setSearchData(prefixCached);
    }

    setSearchLoading(true);
    const controller = new AbortController();
    searchAbortRef.current = controller;

    const timeoutId = setTimeout(async () => {
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
    }, SEARCH_DEBOUNCE_MS);

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
    if (!loadPosts && !loadStories) return;
    if (loadPosts) loadPosts();
    if (loadStories) loadStories();
    const interval = setInterval(() => {
      if (loadPosts) loadPosts();
      if (loadStories) loadStories();
    }, 120000);
    return () => clearInterval(interval);
  }, [loadPosts, loadStories]);

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

  const scoredPosts = useMemo(() => {
    return postsArray.map((post) => ({
      type: resolveContentType(post),
      item: post,
      score: calculateTrendingScore(post),
    }));
  }, [postsArray]);

  const scoredStories = useMemo(() => {
    return storiesArray.map((story) => ({
      type: "story",
      item: story,
      score: calculateTrendingScore(story, { isStory: true }),
    }));
  }, [storiesArray]);

  const trendingItems = useMemo(() => {
    return [...scoredPosts, ...scoredStories].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return getTimestamp(b.item) - getTimestamp(a.item);
    });
  }, [scoredPosts, scoredStories]);

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
  const hasMoreTrending = trendingVisibleCount < filteredTrendingItems.length;
  const displayedTrendingItems = filteredTrendingItems.slice(0, trendingVisibleCount);
  const showTrendingSkeletons = loading && filteredTrendingItems.length === 0;
  const isTrendingEmpty = !loading && filteredTrendingItems.length === 0;

  useEffect(() => {
    setTrendingVisibleCount(12);
  }, [trendingTab, trendingWindow]);

  useEffect(() => {
    if (!trendingLoadMoreRef.current) return;
    if (!hasMoreTrending) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setTrendingVisibleCount((prev) =>
          Math.min(prev + 8, filteredTrendingItems.length)
        );
      },
      { rootMargin: "200px" }
    );
    observer.observe(trendingLoadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMoreTrending, filteredTrendingItems.length]);

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

  const handleOpenStory = (story) => {
    const idx = storyIndexMap.get(story._id);
    if (idx === undefined) return;
    setSelectedStoryIndex(idx);
  };

  const handleToggleLike = async (post) => {
    if (!currentUser?.id) return;
    const postId = post._id || post.id;
    if (!postId) return;
    const baseLikes = Array.isArray(post.likes) ? post.likes : [];
    const hasLiked = baseLikes.includes(currentUser.id);
    const nextLikes = hasLiked
      ? baseLikes.filter((id) => id !== currentUser.id)
      : [...baseLikes, currentUser.id];

    updatePost(postId, { likes: nextLikes, likeCount: nextLikes.length });
    try {
      await likePost(postId);
    } catch (error) {
      updatePost(postId, { likes: baseLikes, likeCount: baseLikes.length });
      console.error("Failed to like post:", error);
    }
  };

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

  const renderTrendingCard = (entry, index) => {
    if (!entry) return null;
    const isStory = entry.type === "story";
    const item = entry.item;
    const contentType = entry.type;
    const mediaUrl = isStory ? resolveStoryMediaUrl(item) : resolvePostMediaUrl(item);
    const storyType = isStory ? resolveStoryMediaType(item, mediaUrl) : "image";
    const isVideo = isStory ? storyType === "video" : isVideoUrl(mediaUrl);
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
    const authorId = item.author?._id || item.authorId || item.author;
    const cachedUser = authorId ? getUserFromCache(authorId) : null;
    const authorName = isStory
      ? item.authorDisplayName ||
        item.author?.displayName ||
        item.author?.fullName ||
        cachedUser?.displayName ||
        "User"
      : isAnonymous
        ? "Anonymous Student"
        : item.author?.displayName ||
          item.author?.fullName ||
          item.authorName ||
          cachedUser?.displayName ||
          "User";
    const avatar = isAnonymous
      ? ANONYMOUS_AVATAR
      : (isStory ? item.authorProfilePic : item.author?.profilePicUrl) ||
        cachedUser?.profilePicUrl ||
        item.author?.profilePicUrl ||
        ANONYMOUS_AVATAR;
    const snippet = isStory ? item.caption || "Story preview" : item.content || "Campus update";
    const badge = resolveTrendingBadge(entry.score);

    return (
      <Motion.div
        key={`${entry.type}-${item._id || item.id || index}`}
        className={`relative aspect-square overflow-hidden rounded-2xl glass-card border border-white/10 ${
          index === 0 ? "glow-border" : ""
        }`}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (isStory) handleOpenStory(item);
          else setSelectedPost(item);
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
      >
        {mediaUrl ? (
          isVideo ? (
            <video src={mediaUrl} className="h-full w-full object-cover" muted playsInline />
          ) : (
            <img src={mediaUrl} alt="Trending" className="h-full w-full object-cover" />
          )
        ) : (
          <div className="h-full w-full bg-white/5 p-4 flex items-end">
            <p className="text-sm text-[#faf0e6] line-clamp-3">{snippet}</p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
        <div className="absolute top-3 left-3 flex items-center gap-2 max-w-[75%]">
          <img
            src={avatar}
            alt={authorName}
            className="h-7 w-7 rounded-full border border-white/30 object-cover"
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[#faf0e6] truncate">
              {authorName}
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
              <i className="fa-solid fa-heart"></i>
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
  };

  const renderDoomItem = (entry, index) => {
    if (!entry) return null;
    if (entry.type === "story") {
      const item = entry.item;
      const mediaUrl = resolveStoryMediaUrl(item);
      const storyType = resolveStoryMediaType(item, mediaUrl);
      const isVideo = storyType === "video";
      const authorId = item.authorId || item.author?._id || item.author;
      const cachedUser = authorId ? getUserFromCache(authorId) : null;
      const authorName =
        item.authorDisplayName ||
        item.author?.displayName ||
        item.author?.fullName ||
        cachedUser?.displayName ||
        "User";
      const avatar =
        item.authorProfilePic ||
        cachedUser?.profilePicUrl ||
        item.author?.profilePicUrl ||
        ANONYMOUS_AVATAR;
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
                <video src={mediaUrl} className="h-full w-full object-cover" muted playsInline />
              ) : (
                <img src={mediaUrl} alt="Story" className="h-full w-full object-cover" />
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
                <p className="text-sm font-semibold text-[#faf0e6]">{authorName}</p>
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
  };

  const renderUserCard = (user, { variant = "default" } = {}) => {
    if (!user) return null;
    const userId = user._id || user.id;
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
    const avatarUrl = getOptimizedMediaUrl(user.profilePicUrl, { width: 96, height: 96 });
    const status = getFriendStatus(userId);
    const isSelf = String(userId) === String(currentUser?.id);
    const isLoading = friendActionLoading[userId];
    const mutualCount = Number(
      user.mutualFriendsCount || user.mutualFriends?.length || 0
    );
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
      if (mutualCount > 0) stats.push(`${mutualCount} mutual`);
      if (!Number.isNaN(publicPostCount)) stats.push(`${publicPostCount} posts`);
    }

    return (
      <div
        key={userId}
        className={`w-full rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/10 ${
          variant === "top" ? "glow-border" : ""
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <button
            type="button"
            onClick={() => setSelectedUser(user)}
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
                <p className="font-semibold text-sm text-[#faf0e6] truncate">
                  {displayName}
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
                    className="text-[10px] px-3 py-1 rounded-full bg-[#b9b4c7]/20 text-[#faf0e6] hover:bg-[#b9b4c7]/30 transition-colors"
                  >
                    Add Friend
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSelectedUser(user)}
                  className="h-7 w-7 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] hover:bg-white/10"
                  aria-label="More actions"
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

  const renderPostCard = (post, { variant = "grid" } = {}) => {
    if (!post) return null;
    const postId = post._id || post.id || post.postId;
    const mediaUrl = resolvePostMediaUrl(post);
    const optimizedMediaUrl = getOptimizedMediaUrl(mediaUrl, {
      width: variant === "featured" ? 1200 : 720,
    });
    const mediaSrcSet = getMediaSrcSet(mediaUrl, [360, 540, 720, 1080]);
    const isVideo =
      isVideoUrl(mediaUrl) ||
      String(post.mediaType || post.type || "").toLowerCase().includes("video");
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

    return (
      <button
        key={postId}
        type="button"
        onClick={() => setSelectedPost(post)}
        className={`relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left ${
          variant === "featured" ? "w-full" : ""
        }`}
      >
        <div className={`relative w-full ${aspectClass}`}>
          {mediaUrl ? (
            isVideo ? (
              <video
                src={mediaUrl}
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
    <div className="min-h-screen flex flex-col pb-24 sm:pb-6">
      <Header />
      <main className="max-w-6xl mx-auto w-full py-6 px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.25em] text-[#b9b4c7]">
            Trending + Search
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#faf0e6]">
            Explore campus discovery
          </h1>
        </div>

        <div ref={searchRef} className="sticky top-20 z-20">
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-[#b9b4c7]"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
                              ? renderPostCard(topResult, { variant: "featured" })
                              : renderUserCard(topResult, { variant: "top" })}
                          </section>
                        )}

                        {peoplePreview.length > 0 && (
                          <section className="space-y-3">
                            <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                              People
                            </h3>
                            <div className="space-y-3">
                              {peoplePreview.map((user) => renderUserCard(user))}
                            </div>
                          </section>
                        )}

                        {postsPreview.length > 0 && (
                          <section className="space-y-3">
                            <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                              Posts
                            </h3>
                            <div className="grid grid-cols-3 gap-2">
                              {postsPreview.map((post) => renderPostCard(post))}
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
                          {peoplePreview.map((user) => renderUserCard(user))}
                        </div>
                      </section>
                    )}

                    {searchTab === "posts" && (
                      <section className="space-y-3">
                        <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                          Posts
                        </h3>
                        <div className="grid grid-cols-3 gap-2">
                          {postsPreview.map((post) => renderPostCard(post))}
                        </div>
                      </section>
                    )}

                    {searchTab === "communities" && (
                      <section className="space-y-3">
                        <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em]">
                          Communities
                        </h3>
                        <div className="space-y-3">
                          {communityPreview.map((user) => renderUserCard(user))}
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
                  {displayedTrendingItems.map((entry, index) =>
                    renderTrendingCard(entry, index)
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {displayedTrendingItems.map((entry, index) =>
                    renderDoomItem(entry, index)
                  )}
                </div>
              )}
              {hasMoreTrending && (
                <div
                  ref={trendingLoadMoreRef}
                  className="h-10 flex items-center justify-center text-xs text-[#b9b4c7]"
                >
                  Loading more...
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

      <UserProfileModal
        isOpen={!!selectedUser}
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        currentUser={currentUser}
      />

      <CreatePostModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <BottomNav onCreate={() => setShowCreateModal(true)} overlay={showCreateModal} />
    </div>
  );
}
