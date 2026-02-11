import { useState, useEffect, useCallback, useRef } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { addComment, deleteComment, getUserById, reportComment, blockUser } from "../../services/api";
import { getSocket } from "../../services/socket";
import ReportModal from "../moderation/ReportModal";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
  }
  return "";
};

export default function CommentModal({ post, isOpen, onClose }) {
  const { currentUser } = useAuth();
  const { updatePost, cacheUser, getUserFromCache, addBlockedUser, isUserBlocked } = useApp();
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRefs = useRef({});
  const postId = toIdString(post?._id || post?.id);
  const postOwnerId = toIdString(post?.author?._id || post?.authorId || post?.author);
  const socket = getSocket();

  const loadComments = useCallback(async () => {
    const postComments = post.comments || [];
    const commentsWithUsers = await Promise.all(
      postComments.map(async (comment) => {
        const userId = toIdString(comment.user?._id || comment.userId || comment.user);
        if (isUserBlocked(userId)) {
          return null;
        }
        if (comment.isAnonymous) {
          return {
            ...comment,
            userId,
            user: { displayName: "Anonymous", profilePicUrl: ANONYMOUS_AVATAR },
          };
        }

        let user = getUserFromCache(userId);
        if (!user && userId) {
          const userData = await getUserById(userId);
          if (userData) {
            cacheUser(userData);
            user = {
              id: userData._id,
              displayName: userData.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
              profilePicUrl: userData.profilePicUrl || ANONYMOUS_AVATAR,
            };
          }
        }
        return {
          ...comment,
          userId,
          user: user || { displayName: "User", profilePicUrl: ANONYMOUS_AVATAR },
        };
      })
    );
    setComments(commentsWithUsers.filter(Boolean));
  }, [post, getUserFromCache, cacheUser, isUserBlocked]);

  useEffect(() => {
    if (isOpen && post) {
      loadComments();
    }
  }, [isOpen, post, loadComments]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (!openMenuId) return;
      const menuEl = menuRefs.current[openMenuId];
      if (menuEl && !menuEl.contains(event.target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [openMenuId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const content = commentText.trim();
    if (!content || !postId) return;

    setLoading(true);
    const tempId = `temp-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const optimisticUser = isAnonymous
      ? { displayName: "Anonymous", profilePicUrl: ANONYMOUS_AVATAR }
      : {
          displayName: currentUser?.displayName || "You",
          profilePicUrl: currentUser?.profilePicUrl || ANONYMOUS_AVATAR,
        };
    const optimisticComment = {
      _id: tempId,
      id: tempId,
      content,
      isAnonymous,
      userId: currentUser?.id || "",
      user: optimisticUser,
      createdAt,
      __optimistic: true,
    };
    const prevPostComments = Array.isArray(post?.comments) ? post.comments : [];
    const nextPostComments = [...prevPostComments, optimisticComment];
    setComments((prev) => [...prev, optimisticComment]);
    updatePost(postId, {
      comments: nextPostComments,
      commentCount: nextPostComments.length,
      commentsCount: nextPostComments.length,
    });
    socket?.emit("comment-added", {
      postId,
      commentId: tempId,
      count: nextPostComments.length,
    });
    try {
      const response = await addComment(postId, content, isAnonymous);
      const savedComment =
        response?.comment ||
        response?.data?.comment ||
        response?.comments?.[response?.comments?.length - 1] ||
        response?.post?.comments?.[response?.post?.comments?.length - 1] ||
        null;
      if (savedComment) {
        const savedId = toIdString(savedComment._id || savedComment.id || tempId);
        const normalized = {
          ...savedComment,
          _id: savedId,
          id: savedId,
          userId: toIdString(
            savedComment.user?._id || savedComment.userId || savedComment.user || currentUser?.id
          ),
          user:
            savedComment.isAnonymous
              ? { displayName: "Anonymous", profilePicUrl: ANONYMOUS_AVATAR }
              : savedComment.user || optimisticUser,
        };
        setComments((prev) =>
          prev.map((comment) => (comment._id === tempId ? normalized : comment))
        );
        updatePost(postId, {
          comments: nextPostComments.map((comment) =>
            comment._id === tempId ? normalized : comment
          ),
        });
      }
      setCommentText("");
      setIsAnonymous(false);
    } catch (error) {
      setComments((prev) => prev.filter((comment) => comment._id !== tempId));
      updatePost(postId, {
        comments: prevPostComments,
        commentCount: prevPostComments.length,
        commentsCount: prevPostComments.length,
      });
      socket?.emit("comment-added", {
        postId,
        commentId: tempId,
        count: prevPostComments.length,
      });
      alert(error.message || "Failed to add comment");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (commentId) => {
    if (!confirm("Delete this comment?")) return;
    if (!postId) return;
    const prevComments = comments;
    const filtered = prevComments.filter(
      (comment) => toIdString(comment._id || comment.id) !== toIdString(commentId)
    );
    const prevPostComments = Array.isArray(post?.comments) ? post.comments : [];
    const filteredPostComments = prevPostComments.filter(
      (comment) => toIdString(comment._id || comment.id) !== toIdString(commentId)
    );
    setComments(filtered);
    updatePost(postId, {
      comments: filteredPostComments,
      commentCount: filteredPostComments.length,
      commentsCount: filteredPostComments.length,
    });
    socket?.emit("comment-added", {
      postId,
      commentId,
      count: filteredPostComments.length,
    });
    try {
      await deleteComment(postId, commentId);
    } catch (error) {
      setComments(prevComments);
      updatePost(postId, {
        comments: prevPostComments,
        commentCount: prevPostComments.length,
        commentsCount: prevPostComments.length,
      });
      alert(error.message || "Failed to delete comment");
    }
  };

  const handleReport = (comment) => {
    setReportTarget(comment);
  };

  const submitReport = async ({ reason, details }) => {
    if (!reportTarget?._id) return;
    try {
      await reportComment(reportTarget._id, {
        reason,
        details,
        context: "comment_modal",
      });
      alert("Thanks for reporting. Our team will review it.");
    } catch (error) {
      alert(error.message || "Failed to report comment");
      throw error;
    }
  };

  const handleBlock = async (comment) => {
    const userId = comment?.userId || comment?.user?._id;
    if (!userId) return;
    if (!confirm("Block this user? You will no longer see their content.")) return;
    try {
      await blockUser(userId, { context: "comment_modal" });
      addBlockedUser(userId);
      alert("User blocked.");
    } catch (error) {
      alert(error.message || "Failed to block user");
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          id="comment-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-80 z-50 flex items-end justify-center"
          onClick={onClose}
        >
          <Motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="w-full max-w-md glass-card rounded-t-3xl shadow-2xl flex flex-col h-3/4 max-h-[80vh] mb-24 sm:mb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-white/10 flex justify-between items-center sticky top-0 bg-[#1a120b]/80 rounded-t-3xl backdrop-blur-xl">
              <h3 className="font-semibold text-[#faf0e6]">Comments</h3>
              <button
                onClick={onClose}
                className="text-[#b9b4c7] hover:text-red-300 text-xl transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="flex-grow overflow-y-auto p-4 space-y-4">
              {comments.length === 0 ? (
                <p className="text-[#b9b4c7] text-sm text-center mt-10">
                  No comments yet
                </p>
              ) : (
                comments.map((comment, index) => {
                  const stableId = toIdString(
                    comment._id ||
                      comment.id ||
                      comment.commentId ||
                      comment.tempId ||
                      comment.userId
                  );
                  const commentKey = stableId || `${postId || "post"}-${index}`;
                  const isCommentOwner =
                    currentUser?.id && String(comment.userId) === String(currentUser.id);
                  const isPostOwner =
                    currentUser?.id &&
                    postOwnerId &&
                    String(postOwnerId) === String(currentUser.id);
                  const canDelete = isCommentOwner || isPostOwner;
                  return (
                  <div
                    key={commentKey}
                    className="flex justify-between items-start p-2 border-b border-white/10"
                  >
                    <div className="flex items-start space-x-2 flex-1">
                      <img
                        src={comment.user?.profilePicUrl || ANONYMOUS_AVATAR}
                        alt={comment.user?.displayName}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-[#faf0e6]">
                          {comment.user?.displayName || "User"}
                        </p>
                        <p className="text-sm text-[#b9b4c7]">{comment.content}</p>
                      </div>
                    </div>
                    <div
                      className="relative ml-2"
                      ref={(el) => {
                        if (el) menuRefs.current[commentKey] = el;
                        else delete menuRefs.current[commentKey];
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMenuId((prev) => (prev === commentKey ? null : commentKey))
                        }
                        className="h-7 w-7 rounded-full flex items-center justify-center text-[#b9b4c7] hover:text-[#faf0e6] hover:bg-white/5 transition-colors"
                        aria-label="Comment actions"
                      >
                        <i className="fa-solid fa-ellipsis-vertical text-[10px]"></i>
                      </button>
                      {openMenuId === commentKey && (
                        <div className="absolute right-0 mt-2 w-36 rounded-2xl glass-card z-20 overflow-hidden">
                          {canDelete ? (
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                handleDelete(comment._id);
                              }}
                              className="w-full text-left px-3 py-2 text-xs text-rose-200 hover:bg-white/10"
                            >
                              <i className="fa-solid fa-trash mr-2"></i>
                              Delete
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  handleReport(comment);
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-amber-200 hover:bg-white/10"
                              >
                                <i className="fa-solid fa-flag mr-2"></i>
                                Report
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  handleBlock(comment);
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-rose-200 hover:bg-white/10"
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
                );
                })
              )}
            </div>

            <div className="p-4 border-t border-white/10 sticky bottom-0 bg-[#1a120b]/80 rounded-b-3xl backdrop-blur-xl">
              <form onSubmit={handleSubmit} className="flex flex-col space-y-2">
                <div className="flex items-center justify-between text-xs text-[#b9b4c7]">
                  <p>{currentUser?.displayName || "You"}</p>
                  <label className="flex items-center cursor-pointer">
                    <span className="mr-2">Post Anonymously</span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={isAnonymous}
                        onChange={(e) => setIsAnonymous(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-white/10 rounded-full peer peer-checked:bg-[#5c5470] transition-colors"></div>
                      <div className="dot absolute left-0.5 top-0.5 bg-[#faf0e6] w-3 h-3 rounded-full transition-transform peer-checked:translate-x-4"></div>
                    </div>
                  </label>
                </div>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a comment..."
                    className="flex-grow px-3 py-2 rounded-full glass-input text-sm"
                    required
                  />
                  <Motion.button
                    type="submit"
                    disabled={loading}
                    className="liquid-button text-[#faf0e6] rounded-full h-10 w-10 flex items-center justify-center disabled:opacity-50"
                    whileTap={{ scale: 0.9 }}
                  >
                    <i className="fa-solid fa-paper-plane"></i>
                  </Motion.button>
                </div>
              </form>
            </div>
          </Motion.div>
        </Motion.div>
      )}
      <ReportModal
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmit={submitReport}
        title="Report Comment"
      />
    </AnimatePresence>
  );
}
