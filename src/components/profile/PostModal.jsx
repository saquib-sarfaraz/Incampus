import { useEffect, useState, useRef, useCallback } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { getUserById, reportPost, blockUser, likePost } from "../../services/api";
import CommentModal from "../feed/CommentModal";
import ShareSheet from "../common/ShareSheet";
import ShareToChatModal from "../common/ShareToChatModal";
import ReportModal from "../moderation/ReportModal";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

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

export default function PostModal({ post, isOpen, onClose, onDelete }) {
  const { currentUser } = useAuth();
  const { cacheUser, getUserFromCache, addBlockedUser, updatePost } = useApp();
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showShareChat, setShowShareChat] = useState(false);
  const [author, setAuthor] = useState(null);
  const [localIsLiked, setLocalIsLiked] = useState(false);
  const [localLikesCount, setLocalLikesCount] = useState(0);
  const [likePending, setLikePending] = useState(false);
  const [mediaLikePulse, setMediaLikePulse] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const postId = post._id || post.id || post.postId || post.post_id;
  const lastTapRef = useRef(0);
  const postUrl = `${window.location.origin}/feed?post=${postId}`;
  const collegeTagName =
    post.collegeTagName ||
    post.college ||
    post.university ||
    post.school ||
    post.collegeName ||
    post.collegeTag ||
    "";
  const baseLikes = Array.isArray(post.likes) ? post.likes : [];
  const baseLikesCount = Array.isArray(post.likes)
    ? post.likes.length
    : Number(post.likes || post.likeCount || post.likesCount || 0);
  const baseIsLiked = baseLikes.includes(currentUser?.id);
  const isLiked = localIsLiked;
  const likesCount = localLikesCount;
  const postThumbnail = resolvePostMediaUrl(post);
  const postPreviewText =
    post.content && post.content.length > 0
      ? post.content.slice(0, 80)
      : "Campus update";
  const isPrivate = resolvePostPrivacy(post) === "friends";
  const resolvedAuthorName =
    author?.displayName ||
    post.authorDisplayName ||
    post.author?.fullName ||
    post.author?.username ||
    post.authorName ||
    "";
  const authorId = post.author?._id || post.authorId || post.author;

  useEffect(() => {
    const loadAuthor = async () => {
      if (!post) return;

      if (post.isAnonymous) {
        setAuthor({ displayName: "Anonymous Student", profilePicUrl: ANONYMOUS_AVATAR });
        return;
      }

      if (post.author && typeof post.author === "object") {
        setAuthor({
          id: post.author._id || post.author.id,
          displayName:
            post.author.displayName ||
            post.author.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") ||
            post.author.name ||
            "User",
          profilePicUrl: post.author.profilePicUrl || ANONYMOUS_AVATAR,
        });
        return;
      }

      const fallbackDisplayName =
        post.authorDisplayName ||
        post.authorName ||
        post.authorFullName ||
        post.authorUsername ||
        "";
      const fallbackProfilePic = post.authorProfilePic || post.authorAvatar;
      if (fallbackDisplayName || fallbackProfilePic) {
        setAuthor({
          displayName: fallbackDisplayName || "User",
          profilePicUrl: fallbackProfilePic || ANONYMOUS_AVATAR,
        });
        return;
      }

      const authorId = post.author?._id || post.authorId || post.author;
      if (!authorId) return;

      let user = getUserFromCache(authorId);
      if (!user) {
        const userData = await getUserById(authorId);
        if (userData) {
          cacheUser(userData);
          user = {
            id: userData._id,
            displayName:
              userData.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
            profilePicUrl: userData.profilePicUrl || ANONYMOUS_AVATAR,
          };
        }
      }
      setAuthor(user || { displayName: "User", profilePicUrl: ANONYMOUS_AVATAR });
    };

    loadAuthor();
  }, [post, cacheUser, getUserFromCache]);

  useEffect(() => {
    setLocalIsLiked(baseIsLiked);
    setLocalLikesCount(baseLikesCount);
  }, [post?._id, baseIsLiked, baseLikesCount]);

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

  const handleReport = () => {
    setShowReport(true);
  };

  const submitReport = async ({ reason, details }) => {
    const postId = post?._id || post?.id;
    if (!postId) return;
    try {
      await reportPost(postId, {
        reason,
        details,
        context: "post_modal",
        isAnonymous: Boolean(post?.isAnonymous),
      });
      alert("Thanks for reporting. Our team will review it.");
    } catch (error) {
      alert(error.message || "Failed to report post");
      throw error;
    }
  };

  const handleBlock = async () => {
    const authorId = post?.author?._id || post?.authorId || post?.author;
    if (!authorId) return;
    if (!confirm("Block this user? You will no longer see their content.")) return;
    try {
      await blockUser(authorId, { context: "post_modal" });
      addBlockedUser(authorId);
      onClose?.();
      alert("User blocked.");
    } catch (error) {
      alert(error.message || "Failed to block user");
    }
  };

  const handleLike = async () => {
    if (!currentUser || likePending) return;
    if (!postId) return;
    const nextLiked = !localIsLiked;
    setLikePending(true);
    setLocalIsLiked(nextLiked);
    setLocalLikesCount((prev) => Math.max(0, prev + (nextLiked ? 1 : -1)));
    const nextLikes = nextLiked
      ? Array.from(new Set([...baseLikes, currentUser.id]))
      : baseLikes.filter((id) => id !== currentUser.id);
    updatePost(postId, { likes: nextLikes, likeCount: nextLikes.length });

    try {
      await likePost(postId);
    } catch {
      updatePost(postId, { likes: baseLikes, likeCount: baseLikes.length });
      setLocalIsLiked(baseIsLiked);
      setLocalLikesCount(baseLikesCount);
    } finally {
      setLikePending(false);
    }
  };

  const handleMediaDoubleTap = useCallback(() => {
    setMediaLikePulse((prev) => prev + 1);
    if (!localIsLiked && !likePending) {
      handleLike();
    }
  }, [localIsLiked, likePending, handleLike]);

  const handleMediaTouchEnd = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      handleMediaDoubleTap();
    }
    lastTapRef.current = now;
  }, [handleMediaDoubleTap]);

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          key={`post-modal-${post?._id || post?.id || "post"}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <Motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="glass-card rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-white/10 flex justify-between items-center">
              <div className="flex items-center space-x-3">
                <img
                  src={
                    post.isAnonymous
                      ? ANONYMOUS_AVATAR
                      : author?.profilePicUrl || ANONYMOUS_AVATAR
                  }
                  alt={author?.displayName}
                  className="w-10 h-10 rounded-full object-cover"
                />
                <div>
                  <p className="font-semibold text-[#faf0e6]">
                    {post.isAnonymous
                      ? "Anonymous Student"
                      : author?.displayName || "User"}
                  </p>
                  <small className="text-[#b9b4c7] flex flex-wrap items-center gap-2 text-xs">
                    <span>{formatTime(post.createdAt)}</span>
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
              </div>
              <button
                onClick={onClose}
                className="text-[#b9b4c7] hover:text-red-300 text-xl transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="p-4 max-h-[60vh] overflow-y-auto">
              {post.content && (
                <p className="text-[#faf0e6] mb-4 whitespace-pre-wrap">{post.content}</p>
              )}
              {postThumbnail && (
                <div
                  className="relative w-full rounded-2xl mb-4 border border-white/10 overflow-hidden"
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    handleMediaDoubleTap();
                  }}
                  onTouchEnd={handleMediaTouchEnd}
                  style={{ touchAction: "manipulation" }}
                >
                  <img
                    src={postThumbnail}
                    alt="Post media"
                    className="w-full"
                  />
                  {mediaLikePulse > 0 && (
                    <Motion.i
                      key={`modal-like-${mediaLikePulse}`}
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
                  className="flex items-center space-x-2 hover:text-red-300 transition-colors"
                  whileTap={{ scale: 0.9 }}
                >
                  <i
                    className={`fa-${isLiked ? "solid" : "regular"} fa-heart ${
                      isLiked ? "text-red-300" : ""
                    }`}
                  />
                  <span>{likesCount}</span>
                </Motion.button>
                <button
                  onClick={() => setShowComments(true)}
                  className="hover:text-[#b9b4c7] transition-colors"
                >
                  <i className="fa-regular fa-comment mr-1"></i>
                  {post.comments?.length || 0} Comments
                </button>
                <button
                  onClick={() => setShowShare(true)}
                  className="hover:text-[#b9b4c7] transition-colors"
                >
                  <i className="fa-solid fa-share-nodes mr-1"></i>
                  Share
                </button>
              </div>

              {String(post.author?._id || post.authorId) === String(currentUser?.id) && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <button
                    onClick={() => {
                      if (confirm("Delete this post?")) {
                        onDelete(post._id);
                        onClose();
                      }
                    }}
                    className="text-red-300 text-sm hover:text-red-400"
                  >
                    <i className="fa-solid fa-trash mr-1"></i> Delete Post
                  </button>
                </div>
              )}
              {String(post.author?._id || post.authorId) !== String(currentUser?.id) && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <button
                    onClick={handleReport}
                    className="text-amber-300 text-sm hover:text-amber-400"
                  >
                    <i className="fa-solid fa-flag mr-1"></i> Report Post
                  </button>
                  <button
                    onClick={handleBlock}
                    className="ml-4 text-rose-300 text-sm hover:text-rose-400"
                  >
                    <i className="fa-solid fa-ban mr-1"></i> Block User
                  </button>
                </div>
              )}
            </div>
          </Motion.div>
        </Motion.div>
      )}

      {showComments && (
        <CommentModal
          key="post-comments-modal"
          post={post}
          isOpen={showComments}
          onClose={() => setShowComments(false)}
        />
      )}

      <ShareSheet
        key="post-share-sheet"
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
        key="post-share-chat"
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
        key="post-report-modal"
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        onSubmit={submitReport}
        title="Report Post"
      />
    </AnimatePresence>
  );
}
