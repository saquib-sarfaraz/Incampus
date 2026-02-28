import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useApp } from "../../context/useApp";
import {
  getUserById,
  getUserProfileBundle,
  getUserPublicPosts,
  getFriendCount,
  reportUser,
  blockUser,
} from "../../services/api";
import ReportModal from "../moderation/ReportModal";
import BlueTick from "../common/BlueTick";
import PostModal from "./PostModal";
import { isVideoUrl } from "../../utils/storyMedia";
import {
  resolveStudentType,
  formatStudentType,
  resolveCollegeName,
  resolveUserBio,
  resolveUserType,
  formatUserType,
  resolveCommunityName,
  resolveCommunityType,
  formatCommunityType,
  resolveCommunityDescription,
  resolveMemberCount,
  resolveCommunityEmail,
  normalizeUserId,
} from "../../utils/userProfile";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const relationshipCache = new Map();
const PROFILE_CACHE_TTL = 5 * 60 * 1000;
const PROFILE_CACHE_PREFIX = "incampus:profile:cache:";

const isDeletedPlaceholderName = (value) => {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  return (
    normalized === "deleted user" ||
    normalized === "user deleted" ||
    normalized === "deleted account" ||
    normalized === "account deleted" ||
    normalized === "deactivated user" ||
    normalized === "deactivated account"
  );
};

const sanitizeDisplayName = (value) => {
  if (value === null || value === undefined) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  if (lowered === "null" || lowered === "undefined") return "";
  if (isDeletedPlaceholderName(trimmed)) return "";
  return trimmed;
};

const readProfileCache = (userId) => {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${PROFILE_CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - parsed.ts > PROFILE_CACHE_TTL) return null;
    return parsed.data || null;
  } catch {
    return null;
  }
};

const writeProfileCache = (userId, data) => {
  if (!userId || !data || typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${PROFILE_CACHE_PREFIX}${userId}`,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {
    // ignore storage errors
  }
};

const normalizeIdValue = normalizeUserId;

const resolvePostAuthorId = (post) => {
  if (!post) return "";
  const direct =
    post.authorId ||
    post.author_id ||
    post.userId ||
    post.user_id ||
    post.ownerId ||
    post.owner_id ||
    post.createdById ||
    post.created_by ||
    post.postedById ||
    post.creatorId ||
    "";
  const directId = normalizeIdValue(direct);
  if (directId) return directId;
  const author =
    post.author ||
    post.user ||
    post.owner ||
    post.createdBy ||
    post.postedBy ||
    post.creator ||
    null;
  return normalizeIdValue(author);
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

const isPostAnonymous = (post) => {
  return Boolean(
    post?.isAnonymous ||
      post?.is_anonymous ||
      post?.anonymous ||
      post?.author?.isAnonymous ||
      post?.author?.anonymous
  );
};

const isPostPublic = (post) => {
  const visibility = post?.visibility || post?.privacy || post?.access || "";
  if (typeof visibility === "string" && visibility) {
    const value = visibility.toLowerCase();
    if (value.includes("public") || value.includes("universal")) return true;
    if (value.includes("friend") || value.includes("private")) return false;
  }
  if (post?.isPublic === true || post?.public === true) return true;
  if (post?.friendsOnly === true || post?.isPrivate === true) return false;
  return true;
};

const UserProfileModalContent = ({
  user,
  onClose,
  currentUser,
  variant = "modal",
}) => {
  const {
    loadPosts,
    addBlockedUser,
    canChat,
    getUserFromCache,
    cacheUser,
    getFriendStatus,
    ensureFriendStatus,
    sendFriendRequest,
    acceptFriend,
    requestChatOpen,
  } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [showReport, setShowReport] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [profileUser, setProfileUser] = useState(user);
  const [profileLoading, setProfileLoading] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [profilePosts, setProfilePosts] = useState([]);
  const [profilePostsCount, setProfilePostsCount] = useState(null);
  const [visiblePostsCount, setVisiblePostsCount] = useState(9);
  const [profilePostsCursor, setProfilePostsCursor] = useState("");
  const [profilePostsHasMore, setProfilePostsHasMore] = useState(true);
  const [profilePostsLoading, setProfilePostsLoading] = useState(false);
  const [profilePostsLoaded, setProfilePostsLoaded] = useState(false);
  const [profileLoadMorePending, setProfileLoadMorePending] = useState(false);
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [relationshipStatus, setRelationshipStatus] = useState("none");
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [relationshipActionLoading, setRelationshipActionLoading] = useState(false);
  const lastUserIdRef = useRef(null);
  const lastFetchRef = useRef({ id: null, ts: 0 });
  const cacheUserRef = useRef(cacheUser);
  const getUserFromCacheRef = useRef(getUserFromCache);
  const profileLoadMoreRef = useRef(null);
  const PROFILE_POSTS_LIMIT = 12;

  const routeUserId = useMemo(() => {
    const path = location?.pathname || "";
    if (!path.startsWith("/profile/")) return "";
    const parts = path.split("/").filter(Boolean);
    return parts[1] || "";
  }, [location?.pathname]);
  const baseUserId = normalizeUserId(routeUserId || user);

  useEffect(() => {
    cacheUserRef.current = cacheUser;
  }, [cacheUser]);

  useEffect(() => {
    getUserFromCacheRef.current = getUserFromCache;
  }, [getUserFromCache]);

  useEffect(() => {
    if (!user) return;
    setProfileUser((prev) => {
      const prevId = prev?._id || prev?.id;
      const nextId = user?._id || user?.id;
      const hasDetails = Boolean(
        user?.username ||
          user?.fullName ||
          user?.displayName ||
          user?.profilePicUrl ||
          user?.communityName ||
          user?.college ||
          user?.university
      );
      if (prev && String(prevId) === String(nextId) && !hasDetails) {
        return prev;
      }
      return user;
    });
  }, [user]);

  useEffect(() => {
    if (!baseUserId) return;
    const cachedUser = getUserFromCacheRef.current?.(baseUserId);
    if (!cachedUser) return;
    setProfileUser((prev) => ({ ...cachedUser, ...prev }));
  }, [
    baseUserId,
    user?.displayName,
    user?.fullName,
    user?.username,
  ]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    if (!baseUserId) return;
    setProfilePosts([]);
    setProfilePostsCount(null);
    setProfilePostsCursor("");
    setProfilePostsHasMore(true);
    setProfilePostsLoading(false);
    setProfilePostsLoaded(false);
    setProfileLoadMorePending(false);
    setProfileHydrated(false);
    setVisiblePostsCount(PROFILE_POSTS_LIMIT);
  }, [baseUserId]);

  useEffect(() => {
    let isActive = true;
    const loadProfile = async () => {
      if (!baseUserId) return;
      const cachedProfile = readProfileCache(baseUserId);
      if (cachedProfile && isActive) {
        setProfileUser((prev) => ({ ...cachedProfile, ...prev }));
        setProfileHydrated(true);
      }
      lastUserIdRef.current = baseUserId;
      const lastFetch = lastFetchRef.current;
      const sameUser = String(lastFetch.id || "") === String(baseUserId);
      const now = Date.now();
      if (sameUser && now - (lastFetch.ts || 0) < 1500) {
        if (isActive) {
          setProfileLoading(false);
          setProfileHydrated(true);
        }
        return;
      }
      lastFetchRef.current = { id: baseUserId, ts: now };
      setProfileLoading(true);
      try {
        const cachedUser = getUserFromCacheRef.current?.(baseUserId);
        let bundle = await getUserProfileBundle(baseUserId);
        let data = bundle?.user || null;
        const rawProfile =
          bundle?.raw?.profile ||
          bundle?.raw?.data?.profile ||
          bundle?.raw?.userProfile ||
          bundle?.raw?.data?.userProfile ||
          null;
        if (rawProfile && typeof rawProfile === "object") {
          data = data ? { ...rawProfile, ...data } : rawProfile;
        }
        if (bundle?.publicPostsCount && profilePostsCount === null) {
          setProfilePostsCount(bundle.publicPostsCount ?? null);
        }
        const postsForProfile = Array.isArray(bundle?.publicPosts)
          ? bundle.publicPosts
          : [];
        const postAuthor =
          postsForProfile.length > 0
            ? postsForProfile[0]?.author ||
              postsForProfile[0]?.user ||
              postsForProfile[0]?.owner ||
              postsForProfile[0]?.createdBy ||
              null
            : null;
        if (postAuthor && typeof postAuthor === "object") {
          data = data ? { ...postAuthor, ...data } : postAuthor;
        }
        if (!data) {
          data = await getUserById(baseUserId);
        }
        if (cachedUser) {
          data = data ? { ...cachedUser, ...data } : cachedUser;
        }
        if (data) {
          cacheUserRef.current?.(data);
        }
        if (data) {
          const fallbackName = sanitizeDisplayName(
            user?.fullName || user?.displayName || user?.username || ""
          );
          const nextName = sanitizeDisplayName(
            data?.fullName || data?.displayName || data?.username || ""
          );
          if (!nextName && fallbackName) {
            data = {
              ...data,
              fullName: user?.fullName || data.fullName,
              displayName: user?.displayName || data.displayName,
              username: user?.username || data.username,
            };
          }
          const rawCount =
            data.friendCount ??
            data.friendsCount ??
            data.friends_count ??
            (Array.isArray(data.friends) ? data.friends.length : null);
          if (rawCount === null || rawCount === undefined) {
            const fetchedCount = await getFriendCount(baseUserId);
            if (Number.isFinite(fetchedCount)) {
              data = {
                ...data,
                friendCount: fetchedCount,
                friendsCount: fetchedCount,
              };
            }
          }
        }
        if (isActive && data) {
          setProfileUser(data);
          writeProfileCache(baseUserId, data);
        }
      } catch (_error) {
        void _error;
      } finally {
        if (isActive) {
          setProfileLoading(false);
          setProfileHydrated(true);
        }
      }
    };
    loadProfile();
    return () => {
      isActive = false;
    };
  }, [
    baseUserId,
    user?.displayName,
    user?.fullName,
    user?.username,
    profilePostsCount,
  ]);

  const resolvedUser = useMemo(() => {
    const preview = user && typeof user === "object" ? user : {};
    const hydrated = profileUser && typeof profileUser === "object" ? profileUser : {};
    return { ...preview, ...hydrated };
  }, [profileUser, user]);
  const resolvedUserId = resolvedUser?._id || resolvedUser?.id || baseUserId;
  const resolvedUserIdValue = normalizeIdValue(resolvedUserId);

  const loadPublicPosts = useCallback(
    async ({ reset = false } = {}) => {
      if (!resolvedUserIdValue) return;
      if (profilePostsLoading) return;
      if (!profilePostsHasMore && !reset) return;
      setProfilePostsLoading(true);
      try {
        const params = {
          limit: PROFILE_POSTS_LIMIT,
          ...(reset || !profilePostsCursor ? {} : { cursor: profilePostsCursor }),
        };
        const data = await getUserPublicPosts(resolvedUserIdValue, params);
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.posts)
              ? data.posts
              : Array.isArray(data?.publicPosts)
                ? data.publicPosts
                : Array.isArray(data?.data?.items)
                  ? data.data.items
                  : Array.isArray(data?.data?.posts)
                    ? data.data.posts
                    : Array.isArray(data?.data?.publicPosts)
                      ? data.data.publicPosts
                      : [];
        const nextCursor =
          data?.nextCursor ||
          data?.next_cursor ||
          data?.cursor ||
          data?.data?.nextCursor ||
          data?.data?.next_cursor ||
          data?.data?.cursor ||
          "";
        const hasMore =
          typeof data?.hasMore === "boolean"
            ? data.hasMore
            : typeof data?.data?.hasMore === "boolean"
              ? data.data.hasMore
              : items.length >= PROFILE_POSTS_LIMIT;
        const nextCount =
          data?.publicPostsCount ||
          data?.publicPostCount ||
          data?.public_posts_count ||
          data?.data?.publicPostsCount ||
          data?.data?.publicPostCount ||
          profilePostsCount;

        setProfilePosts((prev) => (reset ? items : [...prev, ...items]));
        setVisiblePostsCount((prev) =>
          reset ? items.length : Math.max(prev, (reset ? 0 : prev) + items.length)
        );
        if (nextCount !== null && nextCount !== undefined) {
          setProfilePostsCount(nextCount);
        }
        setProfilePostsHasMore(Boolean(hasMore));
        setProfilePostsCursor(nextCursor || "");
        setProfilePostsLoaded(true);
      } catch (_error) {
        void _error;
        setProfilePostsHasMore(false);
        setProfilePostsLoaded(true);
      } finally {
        setProfilePostsLoading(false);
      }
    },
    [
      resolvedUserIdValue,
      profilePostsCursor,
      profilePostsHasMore,
      profilePostsLoading,
      PROFILE_POSTS_LIMIT,
      profilePostsCount,
    ]
  );

  useEffect(() => {
    if (!resolvedUserIdValue || !profileHydrated) return;
    setProfileLoadMorePending(false);
    loadPublicPosts({ reset: true });
  }, [resolvedUserIdValue, profileHydrated, loadPublicPosts]);

  const isVerified = Boolean(
    resolvedUser?.isVerified ||
      resolvedUser?.isVerifiedCommunity ||
      resolvedUser?.verifiedCommunity ||
      resolvedUser?.communityVerified
  );
  const resolvedUsername = String(resolvedUser?.username || "").trim();
  const shouldShowUpdating =
    profileLoading &&
    !resolvedUser?.fullName &&
    !resolvedUser?.displayName &&
    !resolvedUsername;

  const publicPosts = useMemo(() => {
    if (!resolvedUserIdValue) return [];
    return (Array.isArray(profilePosts) ? profilePosts : [])
      .filter((post) => {
        const authorId = resolvePostAuthorId(post);
        if (authorId && String(authorId) !== String(resolvedUserIdValue)) return false;
        if (isPostAnonymous(post)) return false;
        if (!isPostPublic(post)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [resolvedUserIdValue, profilePosts]);

  useEffect(() => {
    setVisiblePostsCount((prev) => {
      const next = publicPosts.length || 0;
      if (next === 0) return 0;
      const baseline = PROFILE_POSTS_LIMIT;
      return Math.min(Math.max(baseline, prev), next);
    });
  }, [publicPosts.length, PROFILE_POSTS_LIMIT]);

  const visiblePublicPosts = useMemo(
    () => publicPosts.slice(0, visiblePostsCount),
    [publicPosts, visiblePostsCount]
  );
  const hasMorePublicPosts = profilePostsHasMore;
  const showProfileLoadSkeletons =
    publicPosts.length > 0 &&
    hasMorePublicPosts &&
    (profilePostsLoading || profileLoadMorePending);
  const showInitialPostsLoading = !profilePostsLoaded && publicPosts.length === 0;

  const requestMorePublicPosts = useCallback(async () => {
    if (profilePostsLoading || !profilePostsHasMore) return;
    setProfileLoadMorePending(true);
    try {
      await loadPublicPosts();
    } finally {
      setProfileLoadMorePending(false);
    }
  }, [profilePostsLoading, profilePostsHasMore, loadPublicPosts]);

  useEffect(() => {
    if (!profileLoadMoreRef.current) return;
    if (!hasMorePublicPosts) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        requestMorePublicPosts();
      },
      { rootMargin: "240px" }
    );
    observer.observe(profileLoadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMorePublicPosts, requestMorePublicPosts]);

  const isSelf = String(resolvedUserId) === String(currentUser?.id);
  const userType = resolveUserType(resolvedUser);
  const isCommunity = userType === "community";
  const rawAccountType = String(
    resolvedUser?.accountType ||
      resolvedUser?.account_type ||
      resolvedUser?.userType ||
      resolvedUser?.user_type ||
      resolvedUser?.type ||
      ""
  )
    .trim()
    .toLowerCase();
  const studentTypeLabel = formatStudentType(resolveStudentType(resolvedUser));
  const bioText = resolveUserBio(resolvedUser) || "No bio shared yet.";
  const communityName = resolveCommunityName(resolvedUser);
  const communityTypeValue = resolveCommunityType(resolvedUser);
  const baseDisplayName =
    communityName ||
    resolvedUser?.fullName ||
    resolvedUser?.displayName ||
    resolvedUser?.username ||
    "";
  const resolvedDisplayName = sanitizeDisplayName(baseDisplayName) || "User";
  const communityTypeLabel = formatCommunityType(communityTypeValue);
  const communityDescription =
    resolveCommunityDescription(resolvedUser) || "No description shared yet.";
  const rawFriendCount =
    resolvedUser.friendCount ??
    resolvedUser.friendsCount ??
    resolvedUser.friends_count ??
    null;
  const friendCountFromList = Array.isArray(resolvedUser.friends)
    ? resolvedUser.friends.length
    : null;
  const resolvedFriendCount =
    rawFriendCount !== null && rawFriendCount !== undefined && rawFriendCount !== ""
      ? Number(rawFriendCount)
      : friendCountFromList;
  const showFriendCount = Number.isFinite(resolvedFriendCount);
  const memberCount = Number(resolveMemberCount(resolvedUser) || 0);
  const fallbackPublicCount = Number(
    profilePostsCount ??
      resolvedUser.publicPostCount ??
      resolvedUser.publicPostsCount ??
      resolvedUser.postCount ??
      0
  );
  const publicPostCount =
    publicPosts.length > 0 || profilePostsLoaded
      ? publicPosts.length
      : fallbackPublicCount;
  const contactEmail = resolveCommunityEmail(resolvedUser);
  const roleLower = String(resolvedUser?.role || "").toLowerCase();
  const isCommunityAccount =
    isCommunity ||
    rawAccountType === "community" ||
    roleLower.includes("community");
  const resolvedUserType = isCommunityAccount ? "community" : userType;
  const userTypeBadge = formatUserType(resolvedUserType);
  const showStudentTypeBadge =
    !isCommunityAccount && studentTypeLabel !== userTypeBadge;
  const collegeLabel =
    resolveCollegeName(resolvedUser) || (isCommunityAccount ? "" : "College");
  const canMessage =
    Boolean(resolvedUserIdValue) && (isSelf || canChat(resolvedUserIdValue));

  const handleMessage = () => {
    if (!canMessage) return;
    if (resolvedUserIdValue) {
      requestChatOpen?.(resolvedUserIdValue);
    }
    navigate("/chat");
  };

  const handleAddFriend = async () => {
    if (!resolvedUserIdValue) return;
    if (relationshipActionLoading || relationshipStatus === "pending_sent") return;
    if (relationshipStatus === "friends") return;
    setRelationshipActionLoading(true);
    try {
      await sendFriendRequest?.(resolvedUserIdValue);
      setRelationshipStatus("pending_sent");
      relationshipCache.set(resolvedUserIdValue, "pending_sent");
    } catch (error) {
      alert(error?.message || "Failed to send friend request");
    } finally {
      setRelationshipActionLoading(false);
    }
  };

  const handleAcceptFriend = async () => {
    if (!resolvedUserIdValue) return;
    if (relationshipActionLoading || relationshipStatus === "friends") return;
    setRelationshipActionLoading(true);
    try {
      await acceptFriend?.(resolvedUserIdValue);
      setRelationshipStatus("friends");
      relationshipCache.set(resolvedUserIdValue, "friends");
    } catch (error) {
      alert(error?.message || "Failed to accept request");
    } finally {
      setRelationshipActionLoading(false);
    }
  };

  const handleConnectCommunity = () => {
    if (!contactEmail) {
      alert("No contact email available for this community.");
      return;
    }
    const subject = encodeURIComponent("Community Connection Request");
    const body = encodeURIComponent(
      "Hi, I would like to connect with your community on InCampus."
    );
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
      contactEmail
    )}&su=${subject}&body=${body}`;
    const opened = window.open(gmailUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = `mailto:${contactEmail}?subject=${subject}&body=${body}`;
    }
  };

  const handleReportUser = () => {
    setOptionsOpen(false);
    setShowReport(true);
  };

  const submitReport = async ({ reason, details }) => {
    if (!resolvedUserId) return;
    try {
      await reportUser(resolvedUserId, {
        reason,
        details,
        context: "user_profile_modal",
      });
      alert("Thanks for reporting. Our team will review it.");
    } catch (error) {
      alert(error.message || "Failed to report user");
      throw error;
    }
  };

  const handleBlockUser = async () => {
    if (!resolvedUserId) return;
    if (!confirm("Block this user? You will no longer see their content.")) return;
    try {
      await blockUser(resolvedUserId, { context: "user_profile_modal" });
      addBlockedUser(resolvedUserId);
      onClose?.();
      alert("User blocked.");
    } catch (error) {
      alert(error.message || "Failed to block user");
    }
  };

  useEffect(() => {
    if (!resolvedUserIdValue || isSelf || isCommunityAccount) return;
    if (relationshipCache.has(resolvedUserIdValue)) {
      setRelationshipStatus(relationshipCache.get(resolvedUserIdValue));
      setRelationshipLoading(false);
      return;
    }
    const immediateStatus = getFriendStatus?.(resolvedUserIdValue) || "none";
    setRelationshipStatus(immediateStatus);
    let active = true;
    setRelationshipLoading(true);
    Promise.resolve(ensureFriendStatus?.(resolvedUserIdValue))
      .then((status) => {
        if (!active || !status) return;
        setRelationshipStatus(status);
        relationshipCache.set(resolvedUserIdValue, status);
      })
      .finally(() => {
        if (active) setRelationshipLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    resolvedUserIdValue,
    isSelf,
    isCommunityAccount,
    getFriendStatus,
    ensureFriendStatus,
  ]);

  if (!resolvedUser) return null;

  const panelClass =
    variant === "modal"
      ? "relative w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl glass-card rounded-none sm:rounded-3xl p-6 sm:p-8 overflow-y-auto"
      : "relative w-full max-w-3xl glass-card rounded-3xl p-6 sm:p-8 shadow-2xl mx-auto";

  const panel = (
    <Motion.div
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 30, opacity: 0 }}
      transition={{ type: "spring", damping: 26, stiffness: 240 }}
      className={panelClass}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <img
                src={
                  resolvedUser.profilePicUrl ||
                  resolvedUser.profilePic ||
                  resolvedUser.avatarUrl ||
                  resolvedUser.avatar ||
                  resolvedUser.photoUrl ||
                  resolvedUser.photo ||
                  resolvedUser.imageUrl ||
                  resolvedUser.image ||
                  ANONYMOUS_AVATAR
                }
                alt={resolvedDisplayName}
                className="h-14 w-14 rounded-full object-cover"
              />
              <div>
                <h3 className="text-lg font-semibold text-[#faf0e6] flex items-center">
                  {resolvedDisplayName}
                  {isVerified && <BlueTick />}
                </h3>
                {resolvedUsername && (
                  <p className="text-[11px] text-[#b9b4c7]">@{resolvedUsername}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] text-[#faf0e6]">
                    {userTypeBadge}
                  </span>
                  {showStudentTypeBadge && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-[#faf0e6]">
                      {studentTypeLabel}
                    </span>
                  )}
                  {collegeLabel && (
                    <span className="text-xs text-[#b9b4c7]">{collegeLabel}</span>
                  )}
                  {isCommunity && communityTypeLabel && (
                    <span className="text-xs text-[#b9b4c7]">{communityTypeLabel}</span>
                  )}
                </div>
                {shouldShowUpdating && (
                  <p className="text-[10px] text-[#b9b4c7] mt-1">Updating profile...</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isSelf && (
                <button
                  onClick={() => setOptionsOpen(true)}
                  className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] hover:bg-white/10"
                  aria-label="More options"
                >
                  <i className="fa-solid fa-circle-info text-sm"></i>
                </button>
              )}
              <button
                onClick={onClose}
                className="text-[#b9b4c7] hover:text-[#faf0e6] text-xl"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 text-center text-[11px] sm:text-xs text-[#b9b4c7] mb-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3">
              <p className="text-base font-semibold text-[#faf0e6]">
                {publicPostCount}
              </p>
              <p>Public Posts</p>
            </div>
            {isCommunity ? (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3">
                  <p className="text-base font-semibold text-[#faf0e6]">{memberCount}</p>
                  <p>Members</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3 col-span-2 sm:col-span-1">
                  <p className="text-[11px] sm:text-xs font-semibold text-[#faf0e6] leading-tight break-normal">
                    {communityTypeLabel || "Community"}
                  </p>
                  <p>Type</p>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3">
                  <p className="text-base font-semibold text-[#faf0e6]">
                    {showFriendCount ? resolvedFriendCount : "—"}
                  </p>
                  <p>Friends</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3 col-span-2 sm:col-span-1">
                  <p className="text-[11px] sm:text-xs font-semibold text-[#faf0e6] leading-tight break-normal">
                    {studentTypeLabel}
                  </p>
                  <p>Student Type</p>
                </div>
              </>
            )}
          </div>

          <div className="mb-6">
            <h4 className="text-sm font-semibold text-[#faf0e6] mb-2">
              {isCommunityAccount ? "About" : "Bio"}
            </h4>
            <p className="text-sm text-[#b9b4c7]">
              {isCommunityAccount ? communityDescription : bioText}
            </p>
          </div>

          <div className="space-y-3 pb-16 sm:pb-4">
            <h4 className="text-sm font-semibold text-[#faf0e6]">Public Posts</h4>
            {showInitialPostsLoading ? (
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6].map((item) => (
                  <div
                    key={`profile-initial-loading-${item}`}
                    className="aspect-square rounded-xl border border-white/10 bg-white/5 animate-pulse"
                  >
                    <div className="h-full w-full rounded-xl bg-white/10" />
                  </div>
                ))}
              </div>
            ) : publicPosts.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-[#b9b4c7]">
                No public posts available.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {visiblePublicPosts.map((post, index) => {
                  const mediaUrl = resolvePostMediaUrl(post);
                  const isVideo =
                    isVideoUrl(mediaUrl) ||
                    String(post.mediaType || post.type || "").toLowerCase().includes("video");
                  return (
                    <button
                      key={post._id || post.id || `public-post-${index}`}
                      type="button"
                      onClick={() => setSelectedPost(post)}
                      className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/5"
                    >
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
                            src={mediaUrl}
                            alt="Post"
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        )
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-white/5 text-[10px] text-[#b9b4c7] px-2 text-center">
                          {post.content ? post.content.slice(0, 40) : "Post"}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent"></div>
                    </button>
                  );
                })}
                {showProfileLoadSkeletons &&
                  [1, 2, 3].map((item) => (
                    <div
                      key={`profile-loading-${item}`}
                      className="aspect-square rounded-xl border border-white/10 bg-white/5 animate-pulse"
                    >
                      <div className="h-full w-full rounded-xl bg-white/10" />
                    </div>
                  ))}
                {hasMorePublicPosts && (
                  <div
                    ref={profileLoadMoreRef}
                    className={`col-span-full h-10 flex items-center justify-center text-[11px] text-[#b9b4c7] transition-opacity ${
                      showProfileLoadSkeletons ? "opacity-100" : "opacity-0"
                    }`}
                    aria-hidden={!showProfileLoadSkeletons}
                  >
                    Loading more...
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-[#b9b4c7]">
              Anonymous posts remain hidden outside the feed.
            </p>
          </div>

          {!isSelf && profileHydrated && (
            <div className="profile-actions sticky bottom-0 left-0 right-0 mt-6 bg-gradient-to-t from-[#120f0a]/95 via-[#120f0a]/85 to-transparent pt-4">
              <div className="flex items-center gap-2">
                {isCommunityAccount ? (
                  <button
                    onClick={handleConnectCommunity}
                    disabled={!contactEmail || relationshipActionLoading}
                    className={`flex-1 liquid-button text-xs font-semibold px-4 py-3 rounded-full text-[#faf0e6] ${
                      contactEmail && !relationshipActionLoading
                        ? ""
                        : "opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <i className="fa-solid fa-link mr-2"></i>
                    Connect
                  </button>
                ) : relationshipStatus === "friends" ? (
                  <button
                    onClick={handleMessage}
                    disabled={!canMessage}
                    className={`flex-1 liquid-button text-xs font-semibold px-4 py-3 rounded-full text-[#faf0e6] ${
                      canMessage ? "" : "opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <i className="fa-solid fa-message mr-2"></i>
                    Message
                  </button>
                ) : relationshipStatus === "pending_received" ? (
                  <button
                    onClick={handleAcceptFriend}
                    disabled={relationshipActionLoading}
                    className={`flex-1 liquid-button text-xs font-semibold px-4 py-3 rounded-full text-[#faf0e6] ${
                      relationshipActionLoading ? "opacity-60 cursor-not-allowed" : ""
                    }`}
                  >
                    <i className="fa-solid fa-user-check mr-2"></i>
                    Accept Friend
                  </button>
                ) : relationshipStatus === "pending_sent" ? (
                  <button
                    disabled
                    className={`flex-1 liquid-button text-xs font-semibold px-4 py-3 rounded-full text-[#faf0e6] ${
                      "opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <i className="fa-solid fa-hourglass-half mr-2"></i>
                    Request Sent
                  </button>
                ) : (
                  <button
                    onClick={handleAddFriend}
                    disabled={relationshipLoading || relationshipActionLoading}
                    className={`flex-1 liquid-button text-xs font-semibold px-4 py-3 rounded-full text-[#faf0e6] ${
                      relationshipLoading || relationshipActionLoading
                        ? "opacity-60 cursor-not-allowed"
                        : ""
                    }`}
                  >
                    <i className="fa-solid fa-user-plus mr-2"></i>
                    Add Friend
                  </button>
                )}
                <button
                  onClick={() => setOptionsOpen(true)}
                  className="h-11 w-11 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] hover:bg-white/10"
                  aria-label="More options"
                >
                  <i className="fa-solid fa-circle-info"></i>
                </button>
              </div>
              {isCommunityAccount && contactEmail && (
                <p className="mt-2 text-[10px] text-[#b9b4c7] text-center">
                  Official email: {contactEmail}
                </p>
              )}
            </div>
          )}
    </Motion.div>
  );

  return (
    <>
      {variant === "modal" ? (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-0 sm:p-4"
          onClick={onClose}
        >
          {panel}
        </Motion.div>
      ) : (
        <div className="w-full px-4 py-6 sm:py-8">{panel}</div>
      )}

      <AnimatePresence>
        {optionsOpen && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-4 sm:items-center"
            onClick={() => setOptionsOpen(false)}
          >
            <Motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 220 }}
              className="w-full max-w-md rounded-3xl glass-card p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[#faf0e6]">More Actions</h3>
                <button
                  onClick={() => setOptionsOpen(false)}
                  className="text-[#b9b4c7] hover:text-[#faf0e6] text-xl"
                >
                  &times;
                </button>
              </div>
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={handleReportUser}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-amber-200 hover:bg-white/10"
                >
                  <i className="fa-solid fa-flag mr-2"></i>
                  Report User
                </button>
                <button
                  type="button"
                  onClick={handleBlockUser}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-rose-200 hover:bg-white/10"
                >
                  <i className="fa-solid fa-ban mr-2"></i>
                  Block User
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-[#faf0e6] hover:bg-white/10"
                >
                  <i className="fa-solid fa-xmark mr-2"></i>
                  Close
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>

      <ReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        onSubmit={submitReport}
        title="Report User"
      />

      {selectedPost && (
        <PostModal
          post={selectedPost}
          isOpen={!!selectedPost}
          onClose={() => setSelectedPost(null)}
          onDelete={() => {}}
        />
      )}
    </>
  );
};

export default function UserProfileModal({
  isOpen,
  user,
  onClose,
  currentUser,
  variant = "modal",
}) {
  if (!user) return null;
  const userKey = user._id || user.id || "user";

  return (
    <AnimatePresence>
      {isOpen && (
        <UserProfileModalContent
          key={String(userKey)}
          user={user}
          onClose={onClose}
          currentUser={currentUser}
          variant={variant}
        />
      )}
    </AnimatePresence>
  );
}
