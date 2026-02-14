import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import {
  addComment,
  deleteComment,
  fetchPostComments,
  getUserById,
  reportComment,
  blockUser,
} from "../../services/api";
import { getSocket } from "../../services/socket";
import ReportModal from "../moderation/ReportModal";
import BlueTick from "../common/BlueTick";

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

const resolveCommentId = (comment) =>
  toIdString(comment?._id || comment?.id || comment?.commentId || comment?.tempId);

const resolveCommentContent = (comment) => {
  if (!comment || typeof comment !== "object") return "";
  return (
    comment.content ||
    comment.text ||
    comment.body ||
    comment.message ||
    comment.comment ||
    ""
  );
};

const resolveCommentUserId = (comment) =>
  toIdString(
    comment?.user?._id ||
      comment?.userId ||
      comment?.user ||
      comment?.author?._id ||
      comment?.authorId ||
      comment?.author
  );

const resolveCommentUser = (comment, fallbackId) => {
  const candidate = comment?.user || comment?.author;
  if (candidate && typeof candidate === "object") {
    return {
      id: toIdString(candidate._id || candidate.id || fallbackId),
      displayName:
        candidate.displayName ||
        candidate.fullName ||
        candidate.name ||
        candidate.username ||
        "User",
      profilePicUrl:
        candidate.profilePicUrl ||
        candidate.avatarUrl ||
        candidate.avatar ||
        ANONYMOUS_AVATAR,
      isVerified: Boolean(candidate.isVerified),
    };
  }
  return null;
};

const isAnonymousComment = (comment) =>
  Boolean(
    comment?.isAnonymous ||
      comment?.anonymous ||
      comment?.isAnon ||
      comment?.is_anonymous
  );

const normalizeCommentsPayload = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const candidates = [
    payload.comments,
    payload.items,
    payload.data,
    payload.results,
    payload.payload,
    payload.response,
    payload.comments?.items,
    payload.data?.comments,
    payload.data?.items,
    payload.data?.results,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
};

const mergeCommentLists = (incoming, current, removedIds) => {
  const safeIncoming = Array.isArray(incoming) ? incoming : [];
  const safeCurrent = Array.isArray(current) ? current : [];
  const removedSet = removedIds instanceof Set ? removedIds : new Set();
  const filteredIncoming = removedSet.size
    ? safeIncoming.filter((comment) => {
        const id = resolveCommentId(comment);
        return !(id && removedSet.has(id));
      })
    : safeIncoming;

  if (!safeCurrent.length) return filteredIncoming;

  const incomingIds = new Set();
  filteredIncoming.forEach((comment) => {
    const id = resolveCommentId(comment);
    if (id) incomingIds.add(id);
  });

  const merged = [...filteredIncoming];
  safeCurrent.forEach((comment) => {
    const id = resolveCommentId(comment);
    if (id && removedSet.has(id)) return;
    if (id && incomingIds.has(id)) return;

    if (comment.__optimistic) {
      const content = resolveCommentContent(comment);
      if (content) {
        const userId = resolveCommentUserId(comment);
        const matched = filteredIncoming.some((fresh) => {
          if (resolveCommentContent(fresh) !== content) return false;
          const freshUserId = resolveCommentUserId(fresh);
          if (userId && freshUserId && userId !== freshUserId) return false;
          return true;
        });
        if (matched) return;
      }
    }

    merged.push(comment);
  });

  return merged;
};

const COMMENTS_CACHE_TTL = 2 * 60 * 1000;
const commentsCache = new Map();

const readCachedComments = (postId) => {
  if (!postId) return null;
  const cached = commentsCache.get(postId);
  if (!cached) return null;
  if (Date.now() - cached.at > COMMENTS_CACHE_TTL) {
    commentsCache.delete(postId);
    return null;
  }
  return cached.items;
};

export default function CommentModal({ post, isOpen, onClose }) {
  const { currentUser } = useAuth();
  const { updatePost, cacheUser, getUserFromCache, addBlockedUser, isUserBlocked } = useApp();
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [toast, setToast] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRefs = useRef({});
  const loadRequestRef = useRef(0);
  const commentsRef = useRef([]);
  const removedCommentIdsRef = useRef(new Set());
  const lastPostIdRef = useRef(null);
  const postId = toIdString(post?._id || post?.id);
  const postOwnerId = toIdString(post?.author?._id || post?.authorId || post?.author);
  const socket = getSocket();
  const setCommentsSafe = useCallback(
    (updater) => {
      setComments((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        commentsRef.current = next;
        if (postId) {
          commentsCache.set(postId, { items: next, at: Date.now() });
        }
        return next;
      });
    },
    [postId]
  );

  const updatePostCounts = useCallback(
    (count) => {
      if (!postId) return;
      updatePost(postId, {
        commentCount: count,
        commentsCount: count,
      });
    },
    [postId, updatePost]
  );

  const hydrateComments = useCallback(
    async (rawComments = [], options = {}) => {
      const allowRemote = options.allowRemote !== false;
      const commentsWithUsers = await Promise.all(
        rawComments.map(async (comment) => {
          if (!comment || typeof comment !== "object") {
            return null;
          }
          const content = resolveCommentContent(comment);
          if (!content) return null;
          const userId = resolveCommentUserId(comment);
          if (userId && isUserBlocked(userId)) {
            return null;
          }
          if (isAnonymousComment(comment)) {
            return {
              ...comment,
              content,
              userId,
              user: { displayName: "Anonymous", profilePicUrl: ANONYMOUS_AVATAR },
            };
          }

          let user = resolveCommentUser(comment, userId);
          if (!user && userId) {
            user = getUserFromCache(userId);
          }
          if (!user && userId && allowRemote) {
            const userData = await getUserById(userId);
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
          return {
            ...comment,
            content,
            userId,
            user: user || { displayName: "User", profilePicUrl: ANONYMOUS_AVATAR },
          };
        })
      );
      return commentsWithUsers.filter(Boolean);
    },
    [getUserFromCache, cacheUser, isUserBlocked]
  );

  const loadComments = useCallback(async () => {
    if (!postId) return;
    const requestId = ++loadRequestRef.current;
    const isNewPost = lastPostIdRef.current && lastPostIdRef.current !== postId;
    if (isNewPost) {
      removedCommentIdsRef.current = new Set();
    }
    lastPostIdRef.current = postId;
    const cached = readCachedComments(postId);
    const fallback = Array.isArray(post?.comments) ? post.comments : [];
    const hasPrefill = (cached && cached.length > 0) || fallback.length > 0;
    if (cached && cached.length > 0) {
      setCommentsSafe(cached);
      updatePostCounts(cached.length);
    } else if (fallback.length > 0 && (isNewPost || commentsRef.current.length === 0)) {
      const normalizedFallback = await hydrateComments(fallback, { allowRemote: false });
      if (loadRequestRef.current !== requestId) return;
      setCommentsSafe(normalizedFallback);
      updatePostCounts(normalizedFallback.length);
    } else if (isNewPost) {
      setCommentsSafe([]);
    }
    setLoadingComments(!hasPrefill);
    setCommentsError("");
    try {
      const payload = await fetchPostComments(postId);
      const rawComments = normalizeCommentsPayload(payload);
      const normalized = await hydrateComments(rawComments);
      if (loadRequestRef.current !== requestId) return;
      const merged = mergeCommentLists(
        normalized,
        commentsRef.current,
        removedCommentIdsRef.current
      );
      setCommentsSafe(merged);
      updatePostCounts(merged.length);
    } catch (error) {
      if (loadRequestRef.current !== requestId) return;
      setCommentsError(error?.message || "Failed to load comments.");
      if (fallback.length) {
        const normalized = await hydrateComments(fallback);
        if (loadRequestRef.current !== requestId) return;
        const merged = mergeCommentLists(
          normalized,
          commentsRef.current,
          removedCommentIdsRef.current
        );
        setCommentsSafe(merged);
        updatePostCounts(merged.length);
      } else {
        setCommentsSafe([]);
      }
    } finally {
      if (loadRequestRef.current === requestId) {
        setLoadingComments(false);
      }
    }
  }, [postId, post?.comments, hydrateComments, setCommentsSafe, updatePostCounts]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!isOpen) return;
    loadComments();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [isOpen, loadComments]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const shouldLock =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(min-width: 640px)").matches;
    if (!shouldLock) return;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

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
          isVerified: Boolean(currentUser?.isVerified),
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
    const prevComments = commentsRef.current;
    const nextComments = [...prevComments, optimisticComment];
    setCommentsSafe(nextComments);
    if (loadingComments) {
      setLoadingComments(false);
    }
    updatePostCounts(nextComments.length);
    socket?.emit("comment-added", {
      postId,
      commentId: tempId,
      count: nextComments.length,
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
        const savedContent = resolveCommentContent(savedComment) || content;
        const normalized = {
          ...savedComment,
          _id: savedId,
          id: savedId,
          content: savedContent,
          userId: toIdString(
            savedComment.user?._id || savedComment.userId || savedComment.user || currentUser?.id
          ),
          user:
            isAnonymousComment(savedComment)
              ? { displayName: "Anonymous", profilePicUrl: ANONYMOUS_AVATAR }
              : savedComment.user || optimisticUser,
        };
        setCommentsSafe((prev) =>
          prev.map((comment) => (resolveCommentId(comment) === tempId ? normalized : comment))
        );
      }
      setCommentText("");
      setIsAnonymous(false);
      setToast({ title: "Comment Posted", message: "Your comment is live." });
    } catch (error) {
      setCommentsSafe(prevComments);
      updatePostCounts(prevComments.length);
      socket?.emit("comment-added", {
        postId,
        commentId: tempId,
        count: prevComments.length,
      });
      alert(error.message || "Failed to add comment");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (commentId) => {
    if (!confirm("Delete this comment?")) return;
    if (!postId) return;
    const resolvedId = toIdString(commentId);
    if (resolvedId) removedCommentIdsRef.current.add(resolvedId);
    const prevComments = commentsRef.current;
    const filtered = prevComments.filter(
      (comment) => resolveCommentId(comment) !== resolvedId
    );
    setCommentsSafe(filtered);
    updatePostCounts(filtered.length);
    socket?.emit("comment-added", {
      postId,
      commentId,
      count: filtered.length,
    });
    try {
      await deleteComment(postId, commentId);
      setToast({ title: "Comment Deleted", message: "Your comment was removed." });
    } catch (error) {
      if (resolvedId) removedCommentIdsRef.current.delete(resolvedId);
      setCommentsSafe(prevComments);
      updatePostCounts(prevComments.length);
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

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <AnimatePresence>
        {isOpen && (
          <Motion.div
            key="comment-modal-shell"
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
              className="w-full max-w-md glass-card comment-modal-panel rounded-t-3xl shadow-2xl flex flex-col h-3/4 max-h-[80vh] mb-24 sm:mb-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-white/10 flex justify-between items-center sticky top-0 bg-[#1a120b]/80 rounded-t-3xl">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[#faf0e6]">Comments</h3>
                {loadingComments && (
                  <span className="text-[10px] text-[#b9b4c7]">Loading...</span>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-[#b9b4c7] hover:text-red-300 text-xl transition-colors"
              >
                  &times;
                </button>
              </div>

              <div className="flex-grow overflow-y-auto p-4 space-y-4">
                {comments.length === 0 ? (
                  <div className="text-center mt-10 space-y-3">
                    <p className="text-[#b9b4c7] text-sm">
                      {commentsError || "No comments yet"}
                    </p>
                    {commentsError && (
                      <button
                        type="button"
                        onClick={loadComments}
                        className="text-[11px] font-semibold text-[#faf0e6] rounded-full border border-white/10 bg-white/5 px-3 py-1.5 hover:bg-white/10"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ) : (
                  comments.map((comment, index) => {
                  const stableId = resolveCommentId(comment) || toIdString(comment.userId);
                  const commentKey = `${postId || "post"}-${stableId || "comment"}-${index}`;
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
                            <p className="font-semibold text-sm text-[#faf0e6] flex items-center">
                              {comment.user?.displayName || "User"}
                              {comment.user?.isVerified && <BlueTick className="text-[12px]" />}
                            </p>
                            <p className="text-sm text-[#b9b4c7]">
                              {comment.content || comment.text || comment.body || ""}
                            </p>
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
                                    handleDelete(resolveCommentId(comment));
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

              <div className="p-4 border-t border-white/10 sticky bottom-0 bg-[#1a120b]/80 rounded-b-3xl">
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
          key="comment-report-modal"
          isOpen={!!reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmit={submitReport}
          title="Report Comment"
        />
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <Motion.div
            key="comment-toast"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-6 right-4 z-[70] toast-card rounded-2xl px-4 py-3 text-sm text-[#faf0e6]"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">{toast.title}</p>
            <p className="mt-1">{toast.message}</p>
          </Motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
}
