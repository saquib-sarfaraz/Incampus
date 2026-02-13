import { useState, useEffect, useRef, useCallback, memo } from "react";
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
import { getOptimizedMediaUrl, getMediaSrcSet } from "../../utils/media";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const VIEW_RATIO_THRESHOLD = 0.5;
const VIEW_MIN_MS = 1200;
const VIEW_COOLDOWN_MS = 5 * 60 * 1000;
const VIEW_STORAGE_PREFIX = "incampus:post:view:";
const viewedPostsSession = new Set();

const resolvePostViewsCount = (post) => {
  if (!post) return 0;
  if (Array.isArray(post.views)) return post.views.length;
  const raw =
    post.viewsCount ??
    post.viewCount ??
    post.views ??
    post.viewersCount ??
    0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNumber = (value) => {
  if (Array.isArray(value)) return value.length;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolvePostLikesCount = (post) => {
  if (!post) return 0;
  if (Array.isArray(post.likes)) return post.likes.length;
  if (Array.isArray(post.likedBy)) return post.likedBy.length;
  if (Array.isArray(post.liked_by)) return post.liked_by.length;
  return toNumber(post.likesCount ?? post.likeCount ?? post.likes ?? 0);
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

function Post({ post, onOpen, badge }) {
  const { currentUser } = useAuth();
  const { cacheUser, getUserFromCache, updatePost, addBlockedUser } = useApp();
  const [author, setAuthor] = useState(null);
  const [optimisticLiked, setOptimisticLiked] = useState(null);
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
  const authorId = post.author?._id || post.authorId || post.author || "";
  const authorName =
    post.author?.displayName ||
    post.author?.fullName ||
    post.author?.username ||
    post.author?.name ||
    "";
  const authorPic =
    post.author?.profilePicUrl ||
    post.author?.profilePic ||
    post.author?.avatarUrl ||
    "";
  const baseLikesRaw = Array.isArray(post.likes)
    ? post.likes
    : Array.isArray(post.likedBy)
      ? post.likedBy
      : Array.isArray(post.liked_by)
        ? post.liked_by
        : [];
  const baseLikeIds = resolveLikeIds(baseLikesRaw);
  const baseLikes = baseLikeIds;
  const baseLikesCount = resolvePostLikesCount(post);
  const baseIsLiked =
    currentUser?.id && baseLikes.some((id) => String(id) === String(currentUser.id));
  const isLiked = optimisticLiked ?? baseIsLiked;
  const likesCount =
    baseLikesCount +
    (optimisticLiked === null ? 0 : (optimisticLiked ? 1 : 0) - (baseIsLiked ? 1 : 0));
  const postId = post._id || post.id || post.postId || post.post_id;
  const postUrl = `${window.location.origin}/feed?post=${postId}`;
  const postMediaUrl = resolvePostMediaUrl(post);
  const postThumbnail = postMediaUrl;
  const optimizedPostMedia = getOptimizedMediaUrl(postMediaUrl, { width: 1200 });
  const postSrcSet = getMediaSrcSet(postMediaUrl, [480, 720, 1024, 1400]);
  const avatarUrl = getOptimizedMediaUrl(author?.profilePicUrl, { width: 80, height: 80 });
  const postPreviewText =
    post.content && post.content.length > 0
      ? post.content.slice(0, 80)
      : "Campus update";
  const isPrivate = resolvePostPrivacy(post) === "friends";
  const resolvedAuthorName =
    author?.displayName ||
    authorName ||
    post.authorDisplayName ||
    post.author?.fullName ||
    post.author?.username ||
    "";
  const authorIsVerified = !post.isAnonymous && Boolean(author?.isVerified ?? post.author?.isVerified);
  const authorDisplayName = post.isAnonymous
    ? "Anonymous Student"
    : author?.displayName || "User";

  useEffect(() => {
    const loadAuthor = async () => {
      if (post.isAnonymous) {
        setAuthor({ displayName: "Anonymous Student", profilePicUrl: ANONYMOUS_AVATAR });
        return;
      }

      if (!authorId) return;

      let user = getUserFromCache(authorId);
      if (user) {
        setAuthor(user);
        return;
      }

      if (authorName || authorPic) {
        setAuthor({
          id: authorId,
          displayName:
            authorName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
          profilePicUrl: authorPic || ANONYMOUS_AVATAR,
          isVerified: Boolean(post.author?.isVerified),
        });
        return;
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
          isVerified: Boolean(post.author?.isVerified),
        }
      );
    };

    loadAuthor();
  }, [post.isAnonymous, authorId, authorName, authorPic, getUserFromCache, cacheUser]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const handleLike = async () => {
    if (!currentUser || likePending) return;
    if (!postId) return;

    const nextLiked = !isLiked;
    setLikeAction(nextLiked ? "like" : "unlike");
    setLikePulse((prev) => prev + 1);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(12);
    }
    setLikePending(true);
    setOptimisticLiked(nextLiked);
    const nextLikes = nextLiked
      ? Array.from(new Set([...baseLikes, currentUser.id]))
      : baseLikes.filter((id) => String(id) !== String(currentUser.id));
    updatePost(postId, {
      likes: nextLikes,
      likedBy: nextLikes,
      likeCount: nextLikes.length,
      likesCount: nextLikes.length,
    });

    try {
      const response = await likePost(postId);
      const updatedPost =
        response?.post || response?.data?.post || response?.data || response || null;
      if (updatedPost) {
        const updatedLikesRaw = Array.isArray(updatedPost.likes)
          ? updatedPost.likes
          : Array.isArray(updatedPost.likedBy)
            ? updatedPost.likedBy
            : Array.isArray(updatedPost.liked_by)
              ? updatedPost.liked_by
              : null;
        const updatedLikes = updatedLikesRaw ? resolveLikeIds(updatedLikesRaw) : null;
        const updatedCount = resolvePostLikesCount(updatedPost);
        updatePost(postId, {
          ...(updatedLikes ? { likes: updatedLikes, likedBy: updatedLikes } : {}),
          likeCount: updatedCount,
          likesCount: updatedCount,
        });
      }
    } catch {
      updatePost(postId, {
        likes: baseLikes,
        likedBy: baseLikes,
        likeCount: baseLikes.length,
        likesCount: baseLikes.length,
      });
    } finally {
      setOptimisticLiked(null);
      setLikePending(false);
      setLikeAction(null);
    }
  };

  const handleReport = () => {
    setShowReport(true);
  };

  const handleMediaDoubleTap = useCallback(() => {
    setMediaLikePulse((prev) => prev + 1);
    if (!isLiked && !likePending) {
      handleLike();
    }
  }, [isLiked, likePending, handleLike]);

  const handleMediaTouchEnd = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      handleMediaDoubleTap();
    }
    lastTapRef.current = now;
  }, [handleMediaDoubleTap]);

  const submitReport = async ({ reason, details }) => {
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
        isAnonymous: Boolean(post.isAnonymous),
      });
      alert("Thanks for reporting. Our team will review it.");
    } catch (error) {
      alert(error.message || "Failed to report post");
      throw error;
    }
  };

  const handleBlock = async () => {
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
    const date = new Date(dateString);
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
  const isOwner = String(authorId) === String(currentUser?.id);
  const badgeLabel = typeof badge === "string" ? badge : badge?.text;
  const badgeTone = typeof badge === "object" && badge?.tone ? badge.tone : "";

  useEffect(() => {
    postRef.current = post;
  }, [post]);

  useEffect(() => {
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

            const baseViews = resolvePostViewsCount(postRef.current);
            const optimisticViews = baseViews + 1;
            updatePost(postId, {
              viewsCount: optimisticViews,
              viewCount: optimisticViews,
            });

            try {
              const response = await recordPostView(postId);
              const nextViews = resolvePostViewsCount(
                response?.post || response?.data || response || null
              );
              if (Number.isFinite(nextViews) && nextViews > 0) {
                updatePost(postId, {
                  viewsCount: nextViews,
                  viewCount: nextViews,
                });
              }
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
  }, [currentUser?.id, postId, updatePost]);

  return (
    <>
      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card glass-hover rounded-3xl p-5 transition-all duration-300 ease-out relative"
        ref={cardRef}
      >
        {showMenu && (
          <div className="absolute inset-0 rounded-3xl bg-black/25 backdrop-blur-sm z-10 pointer-events-none" />
        )}
        <div className="flex items-center mb-3">
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
            <small className="text-[#b9b4c7] flex flex-wrap items-center gap-2 text-xs">
              <span>{formatTime(post.createdAt)}</span>
              {badgeLabel && (
                <span
                  className={`inline-flex items-center rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] text-[#faf0e6] ${badgeTone}`}
                >
                  {badgeLabel}
                </span>
              )}
              {collegeTagName && (
                <>
                  <span className="text-[#b9b4c7]">|</span>
                  <span className="inline-flex items-center gap-1 max-w-[220px] truncate">
                    <i className="fa-solid fa-school text-[10px]"></i>
                    <span className="truncate">{collegeTagName}</span>
                  </span>
                </>
              )}
            </small>
          </div>
          <div className="ml-auto relative z-20" ref={menuRef}>
            <Motion.button
              type="button"
              onClick={() => setShowMenu((prev) => !prev)}
              className="h-9 w-9 rounded-full flex items-center justify-center text-[#b9b4c7] hover:text-[#faf0e6] hover:bg-white/5 transition-colors"
              whileTap={{ scale: 0.9 }}
              aria-label="Post actions"
            >
              <i className="fa-solid fa-ellipsis-vertical"></i>
            </Motion.button>
            {showMenu && (
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

        {post.content && (
          <p className="text-[#faf0e6] mb-4 whitespace-pre-wrap">{post.content}</p>
        )}

        {postMediaUrl && (
          <div
            className="mb-4 rounded-2xl overflow-hidden border border-white/10 relative"
            onDoubleClick={(event) => {
              event.preventDefault();
              handleMediaDoubleTap();
            }}
            onTouchEnd={handleMediaTouchEnd}
            style={{ touchAction: "manipulation" }}
          >
            <img
              src={optimizedPostMedia || postMediaUrl}
              srcSet={postSrcSet || undefined}
              sizes="(max-width: 640px) 90vw, (max-width: 1024px) 70vw, 800px"
              alt="Post media"
              className="w-full max-h-96 object-cover"
              loading="lazy"
              decoding="async"
            />
            {mediaLikePulse > 0 && (
              <Motion.i
                key={`media-like-${mediaLikePulse}`}
                className="fa-solid fa-heart text-5xl sm:text-6xl text-red-300 drop-shadow-[0_0_18px_rgba(248,113,113,0.6)] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: [0, 1, 0], scale: [0.6, 1.1, 1.3] }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                aria-hidden="true"
              />
            )}
          </div>
        )}

        <div className="flex justify-around text-[#b9b4c7] pt-4 border-t border-white/10">
          <Motion.button
            onClick={handleLike}
            className={`relative flex items-center gap-2 hover:text-red-300 transition-colors min-h-[44px] px-2 ${
              isLiked ? "text-red-300" : ""
            }`}
            whileTap={{ scale: 0.94 }}
          >
            <Motion.span
              key={`like-glow-${likePulse}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={
                likeAction === "like"
                  ? { opacity: [0, 0.7, 0], scale: [0.8, 1.4, 1.8] }
                  : { opacity: 0, scale: 0.9 }
              }
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="absolute inset-0 -z-10 rounded-full bg-red-300/20 blur-xl"
              aria-hidden="true"
            />
            <Motion.span
              key={`like-icon-${likePulse}`}
              initial={{ scale: 1, opacity: 0.9 }}
              animate={
                likeAction === "like"
                  ? { scale: [1, 0.9, 1.1, 1], opacity: [0.9, 1, 1, 1] }
                  : { scale: [1, 0.95, 1], opacity: [0.9, 1, 1] }
              }
              transition={{ duration: likeAction === "like" ? 0.18 : 0.15, ease: "easeOut" }}
              className="flex items-center"
            >
              <i className={`fa-${isLiked ? "solid" : "regular"} fa-heart`} />
            </Motion.span>
            <Motion.span
              key={`like-count-${likesCount}`}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {likesCount}
            </Motion.span>
          </Motion.button>
          <Motion.button
            onClick={() => setShowComments(true)}
            className="flex items-center space-x-2 hover:text-[#b9b4c7] transition-colors"
            whileTap={{ scale: 0.9 }}
          >
            <i className="fa-regular fa-comment"></i>
            <span>{commentsCount}</span>
          </Motion.button>
          <Motion.button
            onClick={() => setShowShare(true)}
            className="flex items-center space-x-2 hover:text-[#b9b4c7] transition-colors"
            whileTap={{ scale: 0.9 }}
          >
            <i className="fa-solid fa-share-nodes"></i>
            <span>Share</span>
          </Motion.button>
          {onOpen && (
            <Motion.button
              onClick={onOpen}
              className="flex items-center space-x-2 hover:text-[#b9b4c7] transition-colors"
              whileTap={{ scale: 0.9 }}
            >
              <i className="fa-regular fa-eye"></i>
              <span>View</span>
            </Motion.button>
          )}
        </div>
      </Motion.div>

      {showComments && (
        <CommentModal
          post={post}
          isOpen={showComments}
          onClose={() => setShowComments(false)}
        />
      )}

      <ShareSheet
        isOpen={showShare}
        onClose={() => setShowShare(false)}
        postUrl={postUrl}
        postTitle={post.content}
        postId={postId}
        postThumbnail={postThumbnail}
        postPreviewText={postPreviewText}
        isPrivate={isPrivate}
        isAnonymous={post.isAnonymous}
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
        postIsAnonymous={post.isAnonymous}
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
  );
}

const arePostPropsEqual = (prev, next) =>
  prev.post === next.post && prev.badge === next.badge && prev.onOpen === next.onOpen;

export default memo(Post, arePostPropsEqual);
