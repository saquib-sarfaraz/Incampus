import { useState, useEffect, useRef } from "react";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { likePost, getUserById, reportPost, blockUser } from "../../services/api";
import CommentModal from "./CommentModal";
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

export default function Post({ post, onOpen }) {
  const { currentUser } = useAuth();
  const { cacheUser, getUserFromCache, updatePost, addBlockedUser } = useApp();
  const [author, setAuthor] = useState(null);
  const [optimisticLiked, setOptimisticLiked] = useState(null);
  const [likePending, setLikePending] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showShareChat, setShowShareChat] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
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
  const baseLikes = Array.isArray(post.likes) ? post.likes : [];
  const baseLikesCount = Array.isArray(post.likes)
    ? post.likes.length
    : Number(post.likes || post.likeCount || 0);
  const baseIsLiked = baseLikes.includes(currentUser?.id);
  const isLiked = optimisticLiked ?? baseIsLiked;
  const likesCount =
    baseLikesCount +
    (optimisticLiked === null ? 0 : (optimisticLiked ? 1 : 0) - (baseIsLiked ? 1 : 0));
  const postId = post._id || post.id;
  const postUrl = `${window.location.origin}/feed?post=${postId}`;
  const postThumbnail = resolvePostMediaUrl(post);
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
          };
        }
      }
      setAuthor(user || { displayName: "User", profilePicUrl: ANONYMOUS_AVATAR });
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
    setLikePending(true);
    setOptimisticLiked(nextLiked);
    const nextLikes = nextLiked
      ? Array.from(new Set([...baseLikes, currentUser.id]))
      : baseLikes.filter((id) => id !== currentUser.id);
    updatePost(postId, { likes: nextLikes, likeCount: nextLikes.length });

    try {
      await likePost(postId);
    } catch {
      updatePost(postId, { likes: baseLikes, likeCount: baseLikes.length });
    } finally {
      setOptimisticLiked(null);
      setLikePending(false);
    }
  };

  const handleReport = () => {
    setShowReport(true);
  };

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
  const commentsCount = Number(
    post.commentCount ||
      post.commentsCount ||
      (Array.isArray(post.comments) ? post.comments.length : 0)
  );
  const isOwner = String(authorId) === String(currentUser?.id);

  return (
    <>
      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card glass-hover rounded-3xl p-5 transition-all duration-300 ease-out relative"
      >
        {showMenu && (
          <div className="absolute inset-0 rounded-3xl bg-black/25 backdrop-blur-sm z-10 pointer-events-none" />
        )}
        <div className="flex items-center mb-3">
          <img
            src={author?.profilePicUrl || ANONYMOUS_AVATAR}
            alt={author?.displayName}
            className="w-10 h-10 rounded-full mr-3 object-cover"
          />
          <div>
            <p className="font-semibold text-[#faf0e6]">
              {post.isAnonymous ? "Anonymous Student" : author?.displayName || "User"}
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

        {post.mediaUrl && (
          <div className="mb-4 rounded-2xl overflow-hidden border border-white/10">
            <img
              src={post.mediaUrl}
              alt="Post media"
              className="w-full max-h-96 object-cover"
            />
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
