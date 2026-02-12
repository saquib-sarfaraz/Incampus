import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion as Motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/useApp";
import { useAuth } from "../context/authContext";
import { searchUsers, likePost } from "../services/api";
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

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

const getLikeCount = (post) => {
  if (Array.isArray(post.likes)) return post.likes.length;
  return Number(post.likes || post.likeCount || post.likesCount || 0);
};

const getCommentCount = (post) => {
  if (Array.isArray(post.comments)) return post.comments.length;
  return Number(post.commentsCount || post.commentCount || 0);
};

const getPostViewCount = (post) => {
  if (Array.isArray(post.views)) return post.views.length;
  return Number(post.views || post.viewCount || post.viewsCount || post.impressions || 0);
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

const getRecencyBoost = (dateString) => {
  if (!dateString) return 0;
  const createdAt = new Date(dateString).getTime();
  if (Number.isNaN(createdAt)) return 0;
  const hours = (Date.now() - createdAt) / 36e5;
  const boostWindow = Math.max(0, 24 - hours);
  return (boostWindow / 24) * 10;
};

const getTrendingScore = (post) => {
  const likes = getLikeCount(post);
  const comments = getCommentCount(post);
  const shares = getShareCount(post);
  const views = getPostViewCount(post);
  return (
    likes * 3 +
    comments * 5 +
    shares * 6 +
    views * 2 +
    getRecencyBoost(post.createdAt)
  );
};

const getStoryScore = (story) => {
  const views = getStoryViewCount(story);
  return views * 2 + getRecencyBoost(story.createdAt);
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
  if (raw.includes("universal") || raw.includes("public")) return "public";
  if (post.friendsOnly === true || post.isPrivate === true || post.private === true) {
    return "friends";
  }
  return "public";
};

export default function Trending() {
  const {
    posts,
    stories,
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
  const [searchResults, setSearchResults] = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [friendActionLoading, setFriendActionLoading] = useState({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [commentPost, setCommentPost] = useState(null);
  const [sharePost, setSharePost] = useState(null);
  const [shareChatPost, setShareChatPost] = useState(null);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState(null);
  const searchRef = useRef(null);
  const showSearchSkeleton = searchLoading && searchResults.length === 0;

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

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleSearch = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        setShowSearchResults(false);
        return;
      }

      setSearchLoading(true);
      setShowSearchResults(true);
      try {
        const users = await searchUsers(searchQuery);
        const filtered = users.filter(
          (user) => {
            const userId = user?._id || user?.id;
            if (isUserBlocked(userId)) return false;
            if (isUserAnonymous(user)) return false;
            return true;
          }
        );
        setSearchResults(filtered);
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    };

    const timeoutId = setTimeout(handleSearch, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, isUserBlocked]);

  useEffect(() => {
    if (!searchResults || searchResults.length === 0) return;
    searchResults.forEach((user) => {
      const userId = user?._id || user?.id;
      if (!userId) return;
      if (String(userId) === String(currentUser?.id)) return;
      ensureFriendStatus(userId);
    });
  }, [searchResults, ensureFriendStatus, currentUser?.id]);

  const postsArray = useMemo(() => {
    const list = Array.isArray(posts) ? posts : [];
    return list.filter((post) => {
      const authorId = post.author?._id || post.authorId || post.author;
      if (isUserBlocked(authorId)) return false;
      const privacy = resolvePostPrivacy(post);
      if (
        privacy === "friends" &&
        String(authorId) !== String(currentUser?.id) &&
        getFriendStatus(authorId) !== "friends"
      ) {
        return false;
      }
      return true;
    });
  }, [posts, isUserBlocked, currentUser?.id, getFriendStatus]);
  const storiesArray = useMemo(() => {
    const list = Array.isArray(stories) ? stories : [];
    return list.filter((story) => {
      if (!isStoryRecent(story)) return false;
      const authorId = story.authorId || story.author?._id || story.author;
      if (isUserBlocked(authorId)) return false;
      return resolveStoryPrivacyType(story) === "universal";
    });
  }, [stories, isUserBlocked]);

  const scoredPosts = useMemo(() => {
    return postsArray.map((post) => ({
      type: "post",
      item: post,
      score: getTrendingScore(post),
    }));
  }, [postsArray]);

  const scoredStories = useMemo(() => {
    return storiesArray.map((story) => ({
      type: "story",
      item: story,
      score: getStoryScore(story),
    }));
  }, [storiesArray]);

  const topTrendingGrid = useMemo(() => {
    return [...scoredPosts, ...scoredStories]
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [scoredPosts, scoredStories]);

  const mostLikedPosts = useMemo(() => {
    return [...postsArray].sort((a, b) => getLikeCount(b) - getLikeCount(a)).slice(0, 8);
  }, [postsArray]);

  const mostCommentedPosts = useMemo(() => {
    return [...postsArray].sort((a, b) => getCommentCount(b) - getCommentCount(a)).slice(0, 8);
  }, [postsArray]);

  const mostViewedStories = useMemo(() => {
    return [...storiesArray]
      .sort((a, b) => getStoryViewCount(b) - getStoryViewCount(a))
      .slice(0, 6);
  }, [storiesArray]);

  const trendingStories = useMemo(() => {
    return [...storiesArray]
      .sort((a, b) => getStoryScore(b) - getStoryScore(a))
      .slice(0, 4);
  }, [storiesArray]);

  const fastestGrowingPosts = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return postsArray
      .filter((post) => {
        const createdAt = new Date(post.createdAt || 0).getTime();
        return createdAt >= cutoff;
      })
      .sort((a, b) => getTrendingScore(b) - getTrendingScore(a))
      .slice(0, 6);
  }, [postsArray]);

  const featuredStory = mostViewedStories[0];

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
              onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
              placeholder="Search students, posts, and campus signals..."
              className="w-full pl-11 pr-4 py-3 rounded-full glass-input"
            />
          </div>

          {showSearchResults && (
            <Motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute left-0 right-0 mt-3 rounded-2xl glass-card max-h-96 overflow-y-auto z-30"
            >
              {showSearchSkeleton ? (
                <div className="p-4 text-center text-[#b9b4c7]">Searching...</div>
              ) : (
                <div className="p-3 space-y-4">
                  {searchLoading && (
                    <div className="px-2 text-[11px] text-[#b9b4c7]">Updating...</div>
                  )}
                  <div>
                    <h3 className="text-xs font-semibold text-[#b9b4c7] uppercase tracking-[0.2em] px-2 py-2 border-b border-white/10">
                      Students
                    </h3>
                    {searchResults.length === 0 ? (
                      <div className="p-3 text-center text-[#b9b4c7] text-sm">
                        No users found
                      </div>
                    ) : (
                      searchResults.map((user) => {
                        const userId = user._id || user.id;
                        const userType = resolveUserType(user);
                        const userTypeBadge = formatUserType(userType);
                        const isCommunity = userType === "community";
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
                        const status = getFriendStatus(userId);
                        const isSelf = String(userId) === String(currentUser?.id);
                        const isLoading = friendActionLoading[userId];
                        return (
                          <div
                            key={userId}
                            className="w-full flex items-start gap-3 p-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedUser(user)}
                              className="flex items-start gap-3 text-left flex-1 min-w-0"
                            >
                              <img
                                src={user.profilePicUrl || ANONYMOUS_AVATAR}
                                alt={user.fullName || user.username}
                                className="w-10 h-10 rounded-full object-cover"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold text-sm text-[#faf0e6]">
                                    {isCommunity
                                      ? resolveCommunityName(user) ||
                                        user.displayName ||
                                        user.username ||
                                        "Community"
                                      : user.fullName ||
                                        user.displayName ||
                                        user.username ||
                                        "User"}
                                  </p>
                                  <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] text-[#faf0e6]">
                                    {userTypeBadge}
                                  </span>
                                </div>
                                <p className="text-xs text-[#b9b4c7]">{secondaryLine}</p>
                                <p className="text-[11px] text-[#b9b4c7] truncate">
                                  {bioPreview}
                                </p>
                              </div>
                            </button>
                            <div className="flex flex-col gap-2 shrink-0">
                              {isSelf ? (
                                <span className="text-[10px] text-[#b9b4c7]">You</span>
                              ) : status === "friends" ? (
                                <button
                                  type="button"
                                  onClick={() => navigate("/chat")}
                                  className="text-[10px] px-3 py-1 rounded-full bg-white/10 text-[#faf0e6] hover:bg-white/20 transition-colors"
                                >
                                  Message
                                </button>
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
                                <button
                                  type="button"
                                  disabled
                                  className="text-[10px] px-3 py-1 rounded-full bg-white/5 text-[#b9b4c7] cursor-not-allowed"
                                >
                                  Blocked
                                </button>
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
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </Motion.div>
          )}
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#faf0e6]">Top Trending Grid</h2>
            <span className="text-xs text-[#b9b4c7]">Live ranking</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {topTrendingGrid.map((entry, index) => {
              const isStory = entry.type === "story";
              const item = entry.item;
              const mediaUrl = isStory ? resolveStoryMediaUrl(item) : item.mediaUrl;
              const storyType = isStory ? resolveStoryMediaType(item, mediaUrl) : "image";
              const isVideo = isStory ? storyType === "video" : isVideoUrl(mediaUrl);
              const label = isStory ? "Story" : isVideo ? "Video" : mediaUrl ? "Image" : "Text";
              const likes = isStory ? 0 : getLikeCount(item);
              const comments = isStory ? 0 : getCommentCount(item);
              const shares = isStory ? 0 : getShareCount(item);
              const views = isStory ? getStoryViewCount(item) : getPostViewCount(item);
              const authorId = item.author?._id || item.authorId || item.author;
              const cachedUser = authorId ? getUserFromCache(authorId) : null;
              const authorName = isStory
                ? item.authorDisplayName ||
                  item.author?.displayName ||
                  item.author?.fullName ||
                  cachedUser?.displayName ||
                  "User"
                : item.isAnonymous
                  ? "Anonymous Student"
                  : item.author?.displayName ||
                    item.author?.fullName ||
                    item.authorName ||
                    cachedUser?.displayName ||
                    "User";
              const avatar = item.isAnonymous
                ? ANONYMOUS_AVATAR
                : (isStory ? item.authorProfilePic : item.author?.profilePicUrl) ||
                  cachedUser?.profilePicUrl ||
                  item.author?.profilePicUrl ||
                  ANONYMOUS_AVATAR;
              const snippet = isStory
                ? item.caption || "Story preview"
                : item.content || "Campus update";

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
                      <video
                        src={mediaUrl}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                      />
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
                  <div className="absolute bottom-3 left-3 flex items-center gap-3 text-[11px] text-[#faf0e6]">
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
                      <i className="fa-regular fa-eye mr-1"></i>
                      {views}
                    </span>
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
            })}
          </div>
        </section>

        {featuredStory && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#faf0e6]">Highlighted Trend Story</h2>
              <span className="text-xs text-[#b9b4c7]">Most viewed</span>
            </div>
            <Motion.button
              type="button"
              onClick={() => handleOpenStory(featuredStory)}
              className="relative overflow-hidden rounded-3xl glass-card border border-white/10 glow-border text-left"
              whileHover={{ scale: 1.01 }}
            >
              <div className="relative aspect-[16/9] w-full overflow-hidden">
                {resolveStoryMediaUrl(featuredStory) ? (
                  resolveStoryMediaType(
                    featuredStory,
                    resolveStoryMediaUrl(featuredStory)
                  ) === "video" ? (
                    <video
                      src={resolveStoryMediaUrl(featuredStory)}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={resolveStoryMediaUrl(featuredStory)}
                      alt="Story preview"
                      className="h-full w-full object-cover"
                    />
                  )
                ) : (
                  <div className="h-full w-full bg-white/5 flex items-center justify-center text-[#faf0e6]">
                    Story preview
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent"></div>
                <div className="absolute bottom-4 left-4">
                  <p className="text-sm font-semibold text-[#faf0e6]">
                    {featuredStory.authorDisplayName ||
                      featuredStory.author?.displayName ||
                      "Campus Story"}
                  </p>
                  <p className="text-xs text-[#b9b4c7]">
                    {getStoryViewCount(featuredStory)} views
                  </p>
                </div>
              </div>
            </Motion.button>
          </section>
        )}

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#faf0e6]">Trending Stories</h2>
            <span className="text-xs text-[#b9b4c7]">Top 4</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {trendingStories.map((story) => (
              <Motion.button
                key={story._id || story.id}
                type="button"
                onClick={() => handleOpenStory(story)}
                className="relative overflow-hidden rounded-2xl glass-card border border-white/10"
                whileHover={{ scale: 1.03 }}
              >
                <div className="relative aspect-square w-full">
                  {resolveStoryMediaUrl(story) ? (
                    resolveStoryMediaType(story, resolveStoryMediaUrl(story)) === "video" ? (
                      <video
                        src={resolveStoryMediaUrl(story)}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                      />
                    ) : (
                      <img
                        src={resolveStoryMediaUrl(story)}
                        alt="Story"
                        className="h-full w-full object-cover"
                      />
                    )
                  ) : (
                    <div className="h-full w-full bg-white/5"></div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>
                  <div className="absolute bottom-3 left-3">
                    <p className="text-xs font-semibold text-[#faf0e6]">
                      {story.authorDisplayName || story.author?.displayName || "Campus Story"}
                    </p>
                    <p className="text-[11px] text-[#b9b4c7]">
                      <i className="fa-regular fa-eye mr-1"></i>
                      {getStoryViewCount(story)}
                    </p>
                  </div>
                </div>
              </Motion.button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#faf0e6]">Most Liked Posts</h2>
            <span className="text-xs text-[#b9b4c7]">Ranked by likes</span>
          </div>
          <div className="space-y-6">
            {mostLikedPosts.map((post) => (
              <Post
                key={post._id || post.id}
                post={post}
                onOpen={() => setSelectedPost(post)}
              />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#faf0e6]">Most Commented Posts</h2>
            <span className="text-xs text-[#b9b4c7]">Ranked by comments</span>
          </div>
          <div className="space-y-6">
            {mostCommentedPosts.map((post) => (
              <Post
                key={post._id || post.id}
                post={post}
                onOpen={() => setSelectedPost(post)}
              />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#faf0e6]">Most Viewed Stories</h2>
            <span className="text-xs text-[#b9b4c7]">Story spotlight</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mostViewedStories.map((story) => (
              <Motion.button
                key={story._id || story.id}
                type="button"
                onClick={() => handleOpenStory(story)}
                className="relative overflow-hidden rounded-2xl glass-card border border-white/10 text-left"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <div className="relative aspect-[4/3] w-full">
                  {resolveStoryMediaUrl(story) ? (
                    resolveStoryMediaType(story, resolveStoryMediaUrl(story)) === "video" ? (
                      <video
                        src={resolveStoryMediaUrl(story)}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                      />
                    ) : (
                      <img
                        src={resolveStoryMediaUrl(story)}
                        alt="Story"
                        className="h-full w-full object-cover"
                      />
                    )
                  ) : (
                    <div className="h-full w-full bg-white/5"></div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>
                  <div className="absolute bottom-3 left-3">
                    <p className="text-sm font-semibold text-[#faf0e6]">
                      {story.authorDisplayName || story.author?.displayName || "Campus Story"}
                    </p>
                    <p className="text-xs text-[#b9b4c7]">
                      <i className="fa-regular fa-eye mr-1"></i>
                      {getStoryViewCount(story)} views
                    </p>
                  </div>
                </div>
              </Motion.button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#faf0e6]">Fastest Growing Posts</h2>
            <span className="text-xs text-[#b9b4c7]">Last 24h spike</span>
          </div>
          <div className="space-y-6">
            {fastestGrowingPosts.map((post) => (
              <Post
                key={post._id || post.id}
                post={post}
                onOpen={() => setSelectedPost(post)}
              />
            ))}
          </div>
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
          postUrl={`${window.location.origin}/feed?post=${sharePost._id || sharePost.id}`}
          postTitle={sharePost.content}
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
          postUrl={`${window.location.origin}/feed?post=${shareChatPost._id || shareChatPost.id}`}
          postTitle={shareChatPost.content}
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
