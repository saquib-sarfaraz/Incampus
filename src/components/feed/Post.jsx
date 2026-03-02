import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import {
  likePost,
  getUserById,
  reportPost,
  blockUser,
  recordPostView,
} from "../../services/api";
import CommentModal from "./CommentModal";
import ShareSheet from "../common/ShareSheet";
import ShareToChatModal from "../common/ShareToChatModal";
import ReportModal from "../moderation/ReportModal";
import BlueTick from "../common/BlueTick";
import {
  getOptimizedMediaUrl,
  getOptimizedVideoUrl,
  getMediaSrcSet,
  getOptimizedFillUrl,
  detectAspectRatio,
  resolveAspectRatioString,
} from "../../utils/media";
import { isVideoUrl } from "../../utils/storyMedia";
import { buildUserPreview, normalizeUserId } from "../../utils/userProfile";
import { splitTextWithLinks } from "../../utils/text";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const VIEW_RATIO_THRESHOLD = 0.5;
const VIEW_MIN_MS = 1200;
const VIEW_COOLDOWN_MS = 5 * 60 * 1000;
const VIEW_STORAGE_PREFIX = "incampus:post:view:";
const CAPTION_PREVIEW_LENGTH = 100;
const viewedPostsSession = new Set();

const toNumber = (value) => {
  if (Array.isArray(value)) return value.length;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolvePostLikesCount = (post) => {
  if (!post) return 0;
  const list = Array.isArray(post.likes)
    ? post.likes
    : Array.isArray(post.likedBy)
      ? post.likedBy
      : Array.isArray(post.liked_by)
        ? post.liked_by
        : null;
  const listCount = list ? list.length : null;
  const numeric = toNumber(post.likesCount ?? post.likeCount ?? post.likes ?? 0);
  if (listCount !== null) {
    if (Number.isFinite(numeric) && numeric > listCount) return numeric;
    return listCount;
  }
  return numeric;
};

const resolvePostCommentsCount = (post) => {
  if (!post) return 0;
  if (Array.isArray(post.comments)) return post.comments.length;
  return toNumber(post.commentsCount ?? post.commentCount ?? post.comments ?? 0);
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

const getStoredViewTimestamp = (postId) => {
  if (!postId || typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${VIEW_STORAGE_PREFIX}${postId}`);
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
};

const canRecordView = (postId) => {
  if (!postId) return false;
  if (viewedPostsSession.has(postId)) return false;
  const lastViewed = getStoredViewTimestamp(postId);
  if (lastViewed && Date.now() - lastViewed < VIEW_COOLDOWN_MS) return false;
  return true;
};

const markViewRecorded = (postId) => {
  if (!postId) return;
  viewedPostsSession.add(postId);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`${VIEW_STORAGE_PREFIX}${postId}`, `${Date.now()}`);
  } catch {
    // Ignore storage errors.
  }
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
  if (raw.includes("public") || raw.includes("universal")) return "public";
  if (post.friendsOnly === true || post.isPrivate === true || post.private === true) {
    return "friends";
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

const resolvePostAspectRatio = (post) => {
  if (!post) return "";
  const direct =
    post.aspectRatio ||
    post.media?.aspectRatio ||
    post.media?.ratio ||
    post.imageAspectRatio ||
    post.mediaAspectRatio ||
    "";
  if (direct) return direct;
  const width =
    post.media?.width ||
    post.media?.w ||
    post.imageWidth ||
    post.mediaWidth ||
    post.width ||
    0;
  const height =
    post.media?.height ||
    post.media?.h ||
    post.imageHeight ||
    post.mediaHeight ||
    post.height ||
    0;
  if (width && height) return detectAspectRatio(Number(width), Number(height));
  return "";
};

const isLikelyId = (value) => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-f0-9]{24}$/i.test(trimmed)) return true;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^\d+$/.test(trimmed)) return true;
  return false;
};

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

const resolvePostAuthorEntity = (post) =>
  post?.author ||
  post?.user ||
  post?.owner ||
  post?.createdBy ||
  post?.postedBy ||
  post?.creator ||
  null;

const normalizeIdValue = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") {
    const raw = String(value).trim();
    return isLikelyId(raw) ? raw : "";
  }
  if (typeof value === "object") {
    if (value.$oid) return normalizeIdValue(value.$oid);
    const nested =
      value._id ||
      value.id ||
      value.userId ||
      value.user_id ||
      value.authorId ||
      value.author_id ||
      "";
    return normalizeIdValue(nested);
  }
  return "";
};

const resolvePostAuthorId = (post) => {
  const direct =
    post?.__localAuthorId ||
    post?.localAuthorId ||
    post?.__localOwnerId ||
    post?.authorId ||
    post?.author_id ||
    post?.userId ||
    post?.user_id ||
    post?.ownerId ||
    post?.owner_id ||
    post?.createdById ||
    post?.created_by ||
    post?.postedById ||
    post?.creatorId ||
    "";
  const resolvedDirect = normalizeIdValue(direct);
  if (resolvedDirect) return resolvedDirect;
  const entity = resolvePostAuthorEntity(post);
  const entityId = normalizeIdValue(entity?._id || entity?.id || entity || "");
  return entityId;
};

const resolvePostAuthorName = (post, entity) => {
  if (typeof entity === "string") {
    return isLikelyId(entity) ? "" : sanitizeDisplayName(entity);
  }
  const candidate =
    post?.authorDisplayName ||
    post?.authorName ||
    post?.authorFullName ||
    post?.userDisplayName ||
    post?.userName ||
    post?.userFullName ||
    entity?.displayName ||
    entity?.fullName ||
    entity?.username ||
    entity?.name ||
    "";
  return sanitizeDisplayName(candidate);
};

const resolvePostAuthorPic = (post, entity) => {
  if (typeof entity === "string") return "";
  return (
    post?.authorProfilePic ||
    post?.authorAvatar ||
    post?.userProfilePic ||
    post?.userAvatar ||
    post?.authorPhoto ||
    post?.authorPhotoUrl ||
    post?.authorImage ||
    post?.authorImageUrl ||
    post?.authorPicture ||
    post?.authorPictureUrl ||
    entity?.profilePicUrl ||
    entity?.profilePic ||
    entity?.avatarUrl ||
    entity?.avatar ||
    entity?.photoUrl ||
    entity?.photo ||
    entity?.imageUrl ||
    entity?.image ||
    entity?.pictureUrl ||
    entity?.picture ||
    ""
  );
};

const resolveAvatarUrl = (author, fallback) => {
  return (
    author?.profilePicUrl ||
    author?.profilePic ||
    author?.avatarUrl ||
    author?.avatar ||
    author?.photoUrl ||
    author?.photo ||
    author?.imageUrl ||
    author?.image ||
    author?.pictureUrl ||
    author?.picture ||
    fallback ||
    ""
  );
};

const resolvePostAuthorVerified = (post, entity) =>
  Boolean(
    post?.authorIsVerified ||
      post?.authorVerified ||
      post?.userIsVerified ||
      post?.userVerified ||
      post?.isVerifiedCommunity ||
      post?.verifiedCommunity ||
      post?.communityVerified ||
      post?.isVerified ||
      post?.verified ||
      post?.is_verified ||
      post?.verification?.status === "verified" ||
      (entity && typeof entity === "object"
        ? entity.isVerified ||
          entity.isVerifiedCommunity ||
          entity.verifiedCommunity ||
          entity.communityVerified ||
          entity.verified ||
          entity.is_verified ||
          entity.verification?.status === "verified"
        : false)
  );

const isPostAnonymous = (post) =>
  Boolean(
    post?.isAnonymous ||
      post?.is_anonymous ||
      post?.anonymous ||
      post?.isAnon ||
      post?.isAnonymousPost ||
      post?.author?.isAnonymous ||
      post?.author?.anonymous
  );

function Post({ post, onOpen, badge, isPreview = false }) {
  const { currentUser } = useAuth();
  const { cacheUser, getUserFromCache, updatePost, addBlockedUser, prefetchUserProfile } = useApp();
  const navigate = useNavigate();
  const [author, setAuthor] = useState(null);
  const [optimisticLiked, setOptimisticLiked] = useState(null);
  const [optimisticLikesCount, setOptimisticLikesCount] = useState(null);
  const [likePending, setLikePending] = useState(false);
  const [likePulse, setLikePulse] = useState(0);
  const [likeAction, setLikeAction] = useState(null);
  const [mediaLikePulse, setMediaLikePulse] = useState(0);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showShareChat, setShowShareChat] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const cardRef = useRef(null);
  const viewTimerRef = useRef(null);
  const viewSentRef = useRef(false);
  const postRef = useRef(post);
  const lastTapRef = useRef(0);
  const likeCommitTimerRef = useRef(null);
  const likeDesiredRef = useRef(null);
  const likeCommitInFlightRef = useRef(false);
  const committedLikedRef = useRef(null);
  const committedCountRef = useRef(null);
  const optimisticCountRef = useRef(null);
  const authorEntity = resolvePostAuthorEntity(post);
  const authorId = resolvePostAuthorId(post);
  const authorName = resolvePostAuthorName(post, authorEntity);
  const authorPic = resolvePostAuthorPic(post, authorEntity);
  const isAnonymous = isPostAnonymous(post);
  const currentUserId = currentUser?.id || currentUser?._id || currentUser?.userId;
  const isOwner =
    Boolean(post?.__isLocalOwner) ||
    (currentUserId &&
      authorId &&
      String(authorId) === String(currentUserId));
  const previewMode = Boolean(isPreview || post?.isPreview);
  const baseLikesRaw = Array.isArray(post.likes)
    ? post.likes
    : Array.isArray(post.likedBy)
      ? post.likedBy
      : Array.isArray(post.liked_by)
        ? post.liked_by
        : null;
  const baseLikeIds = resolveLikeIds(baseLikesRaw);
  const baseLikes = baseLikeIds;
  const baseLikesRawCount = Array.isArray(baseLikesRaw) ? baseLikesRaw.length : 0;
  const baseLikesCount = resolvePostLikesCount(post);
  const shouldUseLikesList =
    Array.isArray(baseLikesRaw) && baseLikesCount <= baseLikesRawCount;
  const baseIsLiked = resolvePostIsLiked(post, currentUser?.id, baseLikeIds);
  const isLiked = optimisticLiked ?? baseIsLiked;
  const likesCount = optimisticLikesCount ?? baseLikesCount;
  const postId = post._id || post.id || post.postId || post.post_id;
  const postUrl = `${window.location.origin}/feed?post=${postId}`;
  const postMediaUrl = resolvePostMediaUrl(post);
  const explicitAspect = resolvePostAspectRatio(post);
  const [mediaAspect, setMediaAspect] = useState(explicitAspect || "4:5");
  useEffect(() => {
    setMediaAspect(explicitAspect || "4:5");
  }, [explicitAspect, postId]);
  const effectiveAspect = explicitAspect || mediaAspect || "4:5";
  const mediaAspectStyle = useMemo(
    () => ({ "--media-aspect": resolveAspectRatioString(effectiveAspect) }),
    [effectiveAspect]
  );
  const canDetectAspect = !explicitAspect;
  const postThumbnail = postMediaUrl;
  const isVideo =
    isVideoUrl(postMediaUrl) ||
    String(post.mediaType || post.type || "").toLowerCase().includes("video");
  const optimizedPostMedia = isVideo
    ? getOptimizedVideoUrl(postMediaUrl)
    : getOptimizedFillUrl(postMediaUrl, { width: 900, aspectRatio: effectiveAspect });
  const postSrcSet = !isVideo ? getMediaSrcSet(postMediaUrl) : null;
  const ownerDisplayName =
    currentUser?.displayName ||
    currentUser?.fullName ||
    currentUser?.username ||
    "You";
  const ownerAvatar = currentUser?.profilePicUrl || ANONYMOUS_AVATAR;
  const resolvedAvatar = isAnonymous && isOwner
    ? ownerAvatar
    : resolveAvatarUrl(author, authorPic);
  const avatarUrl = getOptimizedMediaUrl(resolvedAvatar, { width: 80, height: 80 });
  const postPreviewText =
    post.content && post.content.length > 0
      ? post.content.slice(0, 80)
      : "Campus update";
  const isPrivate = resolvePostPrivacy(post) === "friends";
  const resolvedAuthorName = author?.displayName || authorName || "";
  const authorIsVerified =
    !isAnonymous &&
    Boolean(author?.isVerified ?? resolvePostAuthorVerified(post, authorEntity));
  const authorDisplayName = isAnonymous
    ? isOwner
      ? `${ownerDisplayName} (Anonymous)`
      : "Anonymous Student"
    : sanitizeDisplayName(author?.displayName) ||
      sanitizeDisplayName(authorName) ||
      "User";
  const handleOpenProfile = useCallback(() => {
    if (previewMode) return;
    if (isAnonymous) return;
    const safeAuthorId = normalizeUserId(authorId);
    const targetId = normalizeUserId(
      authorId ||
        author?.id ||
        author?._id ||
        post.authorId ||
        post.author?._id ||
        post.author
    );
    if (targetId) {
      const cachedAuthor = safeAuthorId ? getUserFromCache(safeAuthorId) : null;
      prefetchUserProfile?.(targetId, cachedAuthor || author || authorEntity);
      const preview = buildUserPreview(
        { ...(cachedAuthor || {}), ...(authorEntity || {}), ...(author || {}) },
        {
        _id: targetId,
        fullName: author?.fullName || author?.name || authorName,
        displayName: author?.displayName || authorDisplayName || authorName,
        username: author?.username,
        profilePicUrl: resolveAvatarUrl(author, authorPic),
        isVerified: authorIsVerified,
        isVerifiedCommunity: author?.isVerifiedCommunity,
        }
      );
      navigate(`/profile/${targetId}`, {
        state: { userPreview: preview, modal: true },
      });
    }
  }, [
    navigate,
    isAnonymous,
    previewMode,
    authorId,
    author,
    authorEntity,
    post.authorId,
    post.author,
    authorName,
    authorDisplayName,
    authorPic,
    authorIsVerified,
    getUserFromCache,
    prefetchUserProfile,
  ]);

  useEffect(() => {
    const loadAuthor = async () => {
    if (isAnonymous) {
      if (isOwner) {
        setAuthor({
          displayName: ownerDisplayName,
          profilePicUrl: ownerAvatar,
          isVerified: Boolean(currentUser?.isVerified),
        });
      } else {
        setAuthor({ displayName: "Anonymous Student", profilePicUrl: ANONYMOUS_AVATAR });
      }
      return;
    }

      if (!authorId) return;

      let user = getUserFromCache(authorId);
      if (user) {
        setAuthor(user);
        return;
      }

      const hasDeletedLabel = isDeletedPlaceholderName(authorName);
      if (authorName || authorPic) {
        const previewName = hasDeletedLabel
          ? ""
          : authorName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "";
        const previewAvatar = resolveAvatarUrl(authorEntity, authorPic) || ANONYMOUS_AVATAR;
        setAuthor({
          id: authorId,
          displayName: previewName || "User",
          profilePicUrl: previewAvatar,
          isVerified: resolvePostAuthorVerified(post, authorEntity),
        });
        if (previewName) {
          return;
        }
      }

      if (!user) {
        const userData = await getUserById(authorId);
        if (userData) {
          cacheUser(userData);
          user = {
            id: userData._id,
            displayName: userData.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
            profilePicUrl: userData.profilePicUrl || ANONYMOUS_AVATAR,
            isVerified: Boolean(userData.isVerified),
          };
        }
      }
      setAuthor(
        user || {
          displayName: "User",
          profilePicUrl: ANONYMOUS_AVATAR,
          isVerified: resolvePostAuthorVerified(post, authorEntity),
        }
      );
    };

    loadAuthor();
  }, [
    post,
    isAnonymous,
    isOwner,
    authorId,
    authorName,
    authorPic,
    authorEntity,
    getUserFromCache,
    cacheUser,
    ownerDisplayName,
    ownerAvatar,
    currentUser?.isVerified,
  ]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    if (likeDesiredRef.current !== null || likeCommitInFlightRef.current) return;
    committedLikedRef.current = baseIsLiked;
    committedCountRef.current = baseLikesCount;
  }, [baseIsLiked, baseLikesCount]);

  useEffect(() => {
    if (optimisticLiked !== null && optimisticLiked === baseIsLiked) {
      setOptimisticLiked(null);
    }
    if (optimisticLikesCount !== null && optimisticLikesCount === baseLikesCount) {
      setOptimisticLikesCount(null);
    }
  }, [optimisticLiked, optimisticLikesCount, baseIsLiked, baseLikesCount]);

  useEffect(() => {
    return () => {
      if (likeCommitTimerRef.current) {
        clearTimeout(likeCommitTimerRef.current);
        likeCommitTimerRef.current = null;
      }
    };
  }, []);

  const commitLike = useCallback(async () => {
    if (previewMode) return;
    if (!postId || !currentUser?.id) return;
    if (likeCommitInFlightRef.current) {
      if (likeCommitTimerRef.current) {
        clearTimeout(likeCommitTimerRef.current);
      }
      likeCommitTimerRef.current = setTimeout(() => {
        commitLike();
      }, 250);
      return;
    }
    const desired = likeDesiredRef.current;
    if (desired === null) return;
    const committed = committedLikedRef.current ?? baseIsLiked;
    if (desired === committed) {
      const committedCount = committedCountRef.current ?? baseLikesCount;
      updatePost(postId, {
        likeCount: committedCount,
        likesCount: committedCount,
        likedByMe: committed,
        isLikedByMe: committed,
      });
      likeDesiredRef.current = null;
      optimisticCountRef.current = null;
      setLikeAction(null);
      return;
    }

    likeCommitInFlightRef.current = true;
    setLikePending(true);
    const desiredAtSend = desired;
    try {
      const response = await likePost(postId);
      const updatedPost =
        response?.post || response?.data?.post || response?.data || response || null;
      const fallbackCount = optimisticCountRef.current ?? baseLikesCount;
      let updatedCount = updatedPost ? resolvePostLikesCount(updatedPost) : fallbackCount;
      if (!Number.isFinite(updatedCount)) {
        updatedCount = fallbackCount;
      }
      const updatedLikesRaw =
        updatedPost && Array.isArray(updatedPost.likes)
          ? updatedPost.likes
          : updatedPost && Array.isArray(updatedPost.likedBy)
            ? updatedPost.likedBy
            : updatedPost && Array.isArray(updatedPost.liked_by)
              ? updatedPost.liked_by
              : null;
      const updatedLikes = updatedLikesRaw ? resolveLikeIds(updatedLikesRaw) : null;
      const updates = {
        likeCount: updatedCount,
        likesCount: updatedCount,
        likedByMe: desiredAtSend,
        isLikedByMe: desiredAtSend,
      };
      if (updatedLikes) {
        updates.likes = updatedLikes;
        updates.likedBy = updatedLikes;
      }
      updatePost(postId, updates);
      committedLikedRef.current = desiredAtSend;
      committedCountRef.current = updatedCount;
    } catch {
      const rollbackLiked = committedLikedRef.current ?? baseIsLiked;
      const rollbackCount = committedCountRef.current ?? baseLikesCount;
      updatePost(postId, {
        likeCount: rollbackCount,
        likesCount: rollbackCount,
        likedByMe: rollbackLiked,
        isLikedByMe: rollbackLiked,
      });
      setOptimisticLiked(rollbackLiked);
      setOptimisticLikesCount(rollbackCount);
    } finally {
      likeCommitInFlightRef.current = false;
      setLikePending(false);
      setLikeAction(null);
      if (likeDesiredRef.current === desiredAtSend) {
        likeDesiredRef.current = null;
        optimisticCountRef.current = null;
      }
    }
  }, [postId, currentUser?.id, baseIsLiked, baseLikesCount, updatePost, previewMode]);

  const handleLike = useCallback(() => {
    if (previewMode) return;
    if (!currentUser?.id) return;
    if (!postId) return;
    if (likePending) return;

    const nextLiked = !isLiked;
    const currentCount = optimisticCountRef.current ?? baseLikesCount;
    const nextCount = Math.max(0, currentCount + (nextLiked ? 1 : -1));
    setLikeAction(nextLiked ? "like" : "unlike");
    setLikePulse((prev) => prev + 1);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(12);
    }
    setOptimisticLiked(nextLiked);
    setOptimisticLikesCount(nextCount);
    optimisticCountRef.current = nextCount;
    likeDesiredRef.current = nextLiked;
    const nextLikes = shouldUseLikesList
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
    if (shouldUseLikesList && nextLikes) {
      optimisticUpdates.likes = nextLikes;
      optimisticUpdates.likedBy = nextLikes;
    }
    updatePost(postId, optimisticUpdates);

    if (likeCommitTimerRef.current) {
      clearTimeout(likeCommitTimerRef.current);
    }
    likeCommitTimerRef.current = setTimeout(() => {
      commitLike();
    }, 2000);
  }, [
    currentUser?.id,
    postId,
    likePending,
    isLiked,
    baseLikesCount,
    shouldUseLikesList,
    baseLikes,
    updatePost,
    commitLike,
    previewMode,
  ]);

  const handleReport = () => {
    if (previewMode) return;
    setShowReport(true);
  };

  const handleMediaDoubleTap = useCallback(() => {
    if (previewMode) return;
    setMediaLikePulse((prev) => prev + 1);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([12, 30, 10]);
    }
    if (!isLiked) {
      handleLike();
    }
  }, [isLiked, handleLike, previewMode]);

  const handleMediaTouchEnd = useCallback(() => {
    if (previewMode) return;
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      handleMediaDoubleTap();
    }
    lastTapRef.current = now;
  }, [handleMediaDoubleTap, previewMode]);

  const submitReport = async ({ reason, details }) => {
    if (previewMode) return;
    if (!currentUser) {
      alert("Please sign in to report.");
      return;
    }
    const postId = post._id || post.id;
    if (!postId) return;
    try {
      await reportPost(postId, {
        reason,
        details,
        context: "feed",
        isAnonymous: Boolean(isAnonymous),
      });
      alert("Thanks for reporting. Our team will review it.");
    } catch (error) {
      alert(error.message || "Failed to report post");
      throw error;
    }
  };

  const handleBlock = async () => {
    if (previewMode) return;
    if (!currentUser) {
      alert("Please sign in to block.");
      return;
    }
    const authorId = post.author?._id || post.authorId || post.author;
    if (!authorId) return;
    if (!confirm("Block this user? You will no longer see their content.")) return;
    try {
      await blockUser(authorId, { context: "feed" });
      addBlockedUser(authorId);
      alert("User blocked.");
    } catch (error) {
      alert(error.message || "Failed to block user");
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const resolveCollegeTag = () => {
    return (
      post.collegeTagName ||
      post.college ||
      post.university ||
      post.school ||
      post.collegeName ||
      post.collegeTag ||
      ""
    );
  };

  const collegeTagName = resolveCollegeTag();
  const commentsCount = resolvePostCommentsCount(post);
  const rawCaption = typeof post.content === "string" ? post.content : post.content ? String(post.content) : "";
  const captionText = rawCaption.trim();
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);
  const isCaptionLong = captionText.length > CAPTION_PREVIEW_LENGTH;
  const visibleCaption =
    isCaptionLong && !isCaptionExpanded
      ? `${captionText.slice(0, CAPTION_PREVIEW_LENGTH).trimEnd()}…`
      : captionText;

  const resolveRelationshipTag = () => {
    const badgeLabel = typeof badge === "string" ? badge : badge?.text;
    if (typeof badgeLabel === "string" && badgeLabel.toLowerCase().includes("friend")) {
      return "Friend";
    }
    const studentTypeRaw =
      author?.studentType ||
      author?.student_type ||
      author?.educationType ||
      author?.education_type ||
      post?.author?.studentType ||
      post?.author?.student_type ||
      post?.studentType ||
      post?.student_type ||
      "";
    const userTypeRaw =
      author?.userType ||
      author?.user_type ||
      author?.accountType ||
      author?.account_type ||
      author?.role ||
      author?.type ||
      post?.author?.userType ||
      post?.author?.accountType ||
      post?.author?.role ||
      "";
    if (
      String(studentTypeRaw || "").toLowerCase().includes("alumni") ||
      String(userTypeRaw || "").toLowerCase().includes("alumni")
    ) {
      return "Alumni";
    }
    const normalizedType = String(userTypeRaw || "").toLowerCase();
    if (
      normalizedType.includes("community") ||
      normalizedType.includes("club") ||
      normalizedType.includes("society") ||
      normalizedType.includes("organization") ||
      normalizedType.includes("org") ||
      normalizedType.includes("group")
    ) {
      return "Community";
    }
    return "";
  };

  const resolveAffiliation = () => {
    const company =
      author?.company ||
      author?.companyName ||
      author?.employer ||
      author?.organization ||
      author?.orgName ||
      author?.workplace ||
      post?.company ||
      post?.companyName ||
      post?.organization ||
      post?.orgName ||
      "";
    if (company) return String(company);
    const college =
      author?.collegeName ||
      author?.college ||
      author?.university ||
      author?.school ||
      post?.collegeName ||
      post?.college ||
      post?.university ||
      post?.school ||
      "";
    return String(college || collegeTagName || "");
  };

  const relationshipTag = resolveRelationshipTag();
  const affiliation = resolveAffiliation();
  const postTimestamp =
    post?.createdAt || post?.created_at || post?.timestamp || post?.time || post?.date || "";
  const metaItems = [formatTime(postTimestamp), relationshipTag, affiliation].filter(Boolean);
  const metaLine = metaItems.join(" • ");

  useEffect(() => {
    postRef.current = post;
  }, [post]);

  useEffect(() => {
    setIsCaptionExpanded(false);
  }, [postId]);

  useEffect(() => {
    if (previewMode) return;
    if (!currentUser?.id) return;
    if (!postId) return;
    if (!cardRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    const node = cardRef.current;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (entry.isIntersecting && entry.intersectionRatio >= VIEW_RATIO_THRESHOLD) {
          if (viewTimerRef.current || viewSentRef.current) return;
          if (!canRecordView(postId)) return;

          viewTimerRef.current = setTimeout(async () => {
            viewTimerRef.current = null;
            if (viewSentRef.current) return;
            if (!canRecordView(postId)) return;

            viewSentRef.current = true;
            markViewRecorded(postId);

            try {
              await recordPostView(postId);
            } catch {
              // Ignore view recording errors to avoid blocking UX.
            }
          }, VIEW_MIN_MS);
        } else if (viewTimerRef.current) {
          clearTimeout(viewTimerRef.current);
          viewTimerRef.current = null;
        }
      },
      { threshold: [VIEW_RATIO_THRESHOLD] }
    );

    observer.observe(node);

    return () => {
      if (viewTimerRef.current) {
        clearTimeout(viewTimerRef.current);
        viewTimerRef.current = null;
      }
      observer.disconnect();
    };
  }, [currentUser?.id, postId, previewMode]);

  return (
    <>
      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card glass-hover rounded-3xl p-5 lg:p-3 transition-all duration-300 ease-out relative flex flex-col"
        ref={cardRef}
      >
        {showMenu && (
          <div className="absolute inset-0 rounded-3xl bg-black/25 backdrop-blur-sm z-10 pointer-events-none" />
        )}
        <div className="flex items-center mb-2 lg:mb-1">
          <button
            type="button"
            onClick={handleOpenProfile}
            className="flex items-center text-left"
            disabled={isAnonymous}
          >
            <img
              src={avatarUrl || ANONYMOUS_AVATAR}
              alt={author?.displayName}
              className="w-10 h-10 rounded-full mr-3 object-cover"
              loading="lazy"
              decoding="async"
            />
            <div>
              <p className="font-semibold text-[#faf0e6] flex items-center">
                {authorDisplayName}
                {authorIsVerified && <BlueTick />}
              </p>
              <small className="text-[#b9b4c7] text-xs">
                {metaLine}
              </small>
            </div>
          </button>
        <div className="ml-auto relative z-20" ref={menuRef}>
          <Motion.button
            type="button"
            onClick={() => {
              if (previewMode) return;
              setShowMenu((prev) => !prev);
            }}
            disabled={previewMode}
            className={`h-9 w-9 rounded-full flex items-center justify-center text-[#b9b4c7] hover:text-[#faf0e6] hover:bg-white/5 transition-colors ${
              previewMode ? "opacity-40 cursor-not-allowed" : ""
            }`}
            whileTap={{ scale: previewMode ? 1 : 0.9 }}
            aria-label="Post actions"
          >
            <i className="fa-solid fa-ellipsis-vertical"></i>
          </Motion.button>
          {showMenu && !previewMode && (
            <div className="absolute right-0 mt-2 w-40 rounded-2xl glass-card z-30 overflow-hidden">
              {!isOwner && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        handleReport();
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-amber-200 hover:bg-white/10"
                    >
                      <i className="fa-solid fa-flag mr-2"></i>
                      Report
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        handleBlock();
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-rose-200 hover:bg-white/10"
                    >
                      <i className="fa-solid fa-ban mr-2"></i>
                      Block
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {captionText && (
          <p className="text-[#faf0e6] text-base lg:text-sm mb-3 lg:mb-2 whitespace-pre-wrap">
            {splitTextWithLinks(visibleCaption).map((part, index) =>
              part.type === "link" ? (
                <a
                  key={`caption-link-${index}`}
                  href={part.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300 underline underline-offset-2 break-all"
                  onClick={(event) => event.stopPropagation()}
                >
                  {part.value}
                </a>
              ) : (
                <span key={`caption-text-${index}`}>{part.value}</span>
              )
            )}
            {isCaptionLong && (
              <button
                type="button"
                className="ml-2 text-xs text-[#b9b4c7] hover:text-[#faf0e6] hover:underline underline-offset-2"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsCaptionExpanded((prev) => !prev);
                }}
              >
                {isCaptionExpanded ? "View less" : "View more"}
              </button>
            )}
          </p>
        )}

        {postMediaUrl && (
          <div
            className="mb-3 lg:mb-2 rounded-2xl overflow-hidden border border-white/10 relative bg-black/20 aspect-[var(--media-aspect)] lg:aspect-[5/4]"
            onDoubleClick={(event) => {
              event.preventDefault();
              handleMediaDoubleTap();
            }}
            onTouchEnd={handleMediaTouchEnd}
            style={{ touchAction: "manipulation", ...mediaAspectStyle }}
          >
            {isVideo ? (
              <video
                src={optimizedPostMedia || postMediaUrl}
                className="w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  if (!canDetectAspect) return;
                  const { videoWidth, videoHeight } = event.currentTarget;
                  if (videoWidth && videoHeight) {
                    setMediaAspect(detectAspectRatio(videoWidth, videoHeight));
                  }
                }}
              />
            ) : (
              <img
                src={optimizedPostMedia || postMediaUrl}
                srcSet={postSrcSet || undefined}
                sizes="(max-width: 640px) 90vw, (max-width: 1024px) 70vw, 800px"
                alt="Post media"
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                onLoad={(event) => {
                  if (!canDetectAspect) return;
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth && naturalHeight) {
                    setMediaAspect(detectAspectRatio(naturalWidth, naturalHeight));
                  }
                }}
              />
            )}
            {mediaLikePulse > 0 && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <Motion.span
                  key={`media-like-glow-${mediaLikePulse}`}
                  className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: [0, 0.65, 0], scale: [0.6, 1.35, 1.6] }}
                  transition={{ duration: 0.55, ease: "easeOut" }}
                  style={{ boxShadow: "0 0 45px rgba(248,113,113,0.45)" }}
                  aria-hidden="true"
                />
                <Motion.span
                  key={`media-like-ring-${mediaLikePulse}`}
                  className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rose-200/50"
                  initial={{ opacity: 0.4, scale: 0.4 }}
                  animate={{ opacity: [0.4, 0], scale: [0.4, 1.6] }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  aria-hidden="true"
                />
                <Motion.i
                  key={`media-like-${mediaLikePulse}`}
                  className="fa-solid fa-heart text-6xl sm:text-7xl text-red-300 drop-shadow-[0_0_18px_rgba(248,113,113,0.6)]"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: [0, 1, 0], scale: [0.6, 1.15, 1.3] }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                  aria-hidden="true"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex justify-around text-[#b9b4c7] pt-2 lg:pt-1 border-t border-white/10 lg:text-sm">
          <Motion.button
            onClick={handleLike}
            disabled={likePending || previewMode}
            className={`relative flex items-center gap-2 hover:text-red-300 transition-colors min-h-[44px] lg:min-h-[38px] px-2 disabled:opacity-70 disabled:cursor-not-allowed ${
              isLiked ? "text-red-300" : ""
            }`}
          >
            <Motion.span
              key={`like-icon-${likePulse}`}
              initial={{ scale: 1 }}
              animate={
                likeAction === "like"
                  ? { scale: [1, 1.15, 1] }
                  : { scale: [1, 0.97, 1] }
              }
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="flex items-center"
            >
              <i className={`fa-${isLiked ? "solid" : "regular"} fa-heart`} />
            </Motion.span>
            <span className="tabular-nums min-w-[2ch] text-right">{likesCount}</span>
          </Motion.button>
          <Motion.button
            onClick={() => {
              if (previewMode) return;
              setShowComments(true);
            }}
            disabled={previewMode}
            className="flex items-center space-x-2 hover:text-[#b9b4c7] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            whileTap={{ scale: previewMode ? 1 : 0.9 }}
          >
            <i className="fa-regular fa-comment"></i>
            <span>{commentsCount}</span>
          </Motion.button>
          <Motion.button
            onClick={() => {
              if (previewMode) return;
              setShowShare(true);
            }}
            disabled={previewMode}
            className="flex items-center space-x-2 hover:text-[#b9b4c7] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            whileTap={{ scale: previewMode ? 1 : 0.9 }}
          >
            <i className="fa-solid fa-share-nodes"></i>
            <span>Share</span>
          </Motion.button>
          {onOpen && (
            <Motion.button
              onClick={() => {
                if (previewMode) return;
                onOpen();
              }}
              disabled={previewMode}
              className="flex items-center space-x-2 hover:text-[#b9b4c7] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              whileTap={{ scale: previewMode ? 1 : 0.9 }}
            >
              <i className="fa-regular fa-eye"></i>
              <span>View</span>
            </Motion.button>
          )}
        </div>
      </Motion.div>

      {!previewMode && showComments && (
        <CommentModal
          post={post}
          isOpen={showComments}
          onClose={() => setShowComments(false)}
        />
      )}

      {!previewMode && (
        <>
          <ShareSheet
            isOpen={showShare}
            onClose={() => setShowShare(false)}
            postUrl={postUrl}
            postTitle={post.content}
            postId={postId}
            postThumbnail={postThumbnail}
            postPreviewText={postPreviewText}
            isPrivate={isPrivate}
            isAnonymous={isAnonymous}
            onShareToChat={() => {
              setShowShare(false);
              setShowShareChat(true);
            }}
          />
          <ShareToChatModal
            isOpen={showShareChat}
            onClose={() => setShowShareChat(false)}
            postUrl={postUrl}
            postTitle={post.content}
            postId={postId}
            postThumbnail={postThumbnail}
            postPreviewText={postPreviewText}
            postIsAnonymous={isAnonymous}
            postAuthorName={resolvedAuthorName}
            postAuthorId={authorId}
          />
          <ReportModal
            isOpen={showReport}
            onClose={() => setShowReport(false)}
            onSubmit={submitReport}
            title="Report Post"
          />
        </>
      )}
    </>
  );
}

const arePostPropsEqual = (prev, next) =>
  prev.post === next.post &&
  prev.badge === next.badge &&
  prev.onOpen === next.onOpen &&
  prev.isPreview === next.isPreview;

export default memo(Post, arePostPropsEqual);
