import { useEffect, useMemo, useRef, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import ReportModal from "../moderation/ReportModal";
import {
  addInBuzzComment,
  blockUser,
  deleteInBuzzComment,
  fetchInBuzzComments,
  reportComment,
} from "../../services/api";

const INBUZZ_COMMENT_REPORT_REASONS = [
  "Spam",
  "Harassment",
  "Hate Speech",
  "Violence",
  "Adult Content",
  "Misinformation",
  "Other",
];

const resolveEntityId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return String(
      value.id ||
        value._id ||
        value.userId ||
        value.user_id ||
        value.authorId ||
        value.author_id ||
        ""
    );
  }
  return "";
};

const normalizeComment = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id || raw._id || raw.commentId || raw.comment_id || `${Math.random()}`;
  const user =
    raw.user ||
    raw.author ||
    raw.sender ||
    raw.profile ||
    raw.createdBy ||
    raw.created_by ||
    null;
  const userId =
    resolveEntityId(raw.userId) ||
    resolveEntityId(raw.user_id) ||
    resolveEntityId(raw.authorId) ||
    resolveEntityId(raw.author_id) ||
    resolveEntityId(raw.senderId) ||
    resolveEntityId(raw.sender_id) ||
    resolveEntityId(raw.createdBy) ||
    resolveEntityId(raw.created_by) ||
    resolveEntityId(user?.id) ||
    resolveEntityId(user?._id) ||
    resolveEntityId(user?.userId) ||
    resolveEntityId(user?.user_id) ||
    "";
  const username =
    raw.username ||
    user?.username ||
    user?.handle ||
    user?.name ||
    (raw.userId ? `user_${raw.userId}` : "user");
  const avatar =
    raw.avatar ||
    raw.avatarUrl ||
    user?.avatar ||
    user?.avatarUrl ||
    user?.profilePicUrl ||
    user?.profilePic ||
    "";
  const text =
    typeof raw.comment === "string"
      ? raw.comment
      : typeof raw.text === "string"
        ? raw.text
        : typeof raw.message === "string"
          ? raw.message
          : "";
  return {
    ...raw,
    id: String(id),
    userId,
    username,
    avatar,
    text,
    createdAt: raw.createdAt || raw.created_at || raw.timestamp || null,
  };
};

const resolveCommentId = (raw) => {
  if (!raw || typeof raw !== "object") return "";
  const id = raw.id || raw._id || raw.commentId || raw.comment_id || "";
  return id ? String(id) : "";
};

const resolveCommentUserId = (raw) => {
  if (!raw || typeof raw !== "object") return "";
  const user =
    raw.user ||
    raw.author ||
    raw.sender ||
    raw.profile ||
    raw.createdBy ||
    raw.created_by ||
    null;
  return (
    resolveEntityId(raw.userId) ||
    resolveEntityId(raw.user_id) ||
    resolveEntityId(raw.authorId) ||
    resolveEntityId(raw.author_id) ||
    resolveEntityId(raw.senderId) ||
    resolveEntityId(raw.sender_id) ||
    resolveEntityId(user?.id) ||
    resolveEntityId(user?._id) ||
    resolveEntityId(user?.userId) ||
    resolveEntityId(user?.user_id) ||
    ""
  );
};

export default function ReelCommentsSheet({
  isOpen,
  onClose,
  reelId,
  reelOwnerId,
  onCountChange,
}) {
  const { currentUser } = useAuth();
  const { addBlockedUser } = useApp();
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  const [actionComment, setActionComment] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);

  const comments = useMemo(() => items.map(normalizeComment).filter(Boolean), [items]);
  const currentUserId = useMemo(
    () => currentUser?.id || currentUser?._id || "",
    [currentUser?._id, currentUser?.id]
  );
  const currentUserHandle = useMemo(() => {
    const raw =
      currentUser?.username ||
      currentUser?.handle ||
      currentUser?.userName ||
      currentUser?.user_name ||
      "";
    return String(raw || "").trim().replace(/^@/, "").toLowerCase();
  }, [
    currentUser?.handle,
    currentUser?.userName,
    currentUser?.user_name,
    currentUser?.username,
  ]);

  useEffect(() => {
    if (!isOpen || !reelId) return;
    let active = true;
    setLoading(true);
    setError("");
    fetchInBuzzComments(reelId, { limit: 25 })
      .then((list) => {
        if (!active) return;
        setItems(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || "Failed to load comments.");
        setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, reelId]);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => inputRef.current?.focus?.(), 160);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) return;
    setActionComment(null);
    setReportTarget(null);
    setActionBusy(false);
    setError("");
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!reelId) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!currentUser) {
      alert("Please sign in to comment.");
      return;
    }
    setPosting(true);
    setError("");
    const optimistic = {
      id: `optimistic-${Date.now()}`,
      comment: trimmed,
      text: trimmed,
      username: currentUser.username || "you",
      avatar: currentUser.profilePic || currentUser.avatar || "",
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setItems((prev) => [optimistic, ...prev]);
    setText("");
    try {
      const res = await addInBuzzComment(reelId, { comment: trimmed });
      const saved =
        res?.comment || res?.data?.comment || res?.item || res?.data || res || null;
      if (saved) {
        setItems((prev) => {
          const next = prev.filter((c) => c.id !== optimistic.id);
          return [saved, ...next];
        });
      }
      onCountChange?.(1);
    } catch (err) {
      setItems((prev) => prev.filter((c) => c.id !== optimistic.id));
      setError(err?.message || "Failed to post comment.");
    } finally {
      setPosting(false);
    }
  };

  const canDeleteComment = useMemo(() => {
    const c = actionComment;
    if (!c) return false;
    if (!currentUserId) return false;
    const isReelOwner =
      reelOwnerId && String(reelOwnerId) === String(currentUserId);
    const isCommentOwnerById =
      c.userId && String(c.userId) === String(currentUserId);
    const commentHandle = String(c.username || "").trim().replace(/^@/, "").toLowerCase();
    const isCommentOwnerByHandle =
      !c.userId && currentUserHandle && commentHandle && commentHandle === currentUserHandle;
    const isCommentOwner = Boolean(isCommentOwnerById || isCommentOwnerByHandle);
    return Boolean(isReelOwner || isCommentOwner);
  }, [actionComment, currentUserHandle, currentUserId, reelOwnerId]);

  const actionCommentIsSelf = useMemo(() => {
    const c = actionComment;
    if (!c || !currentUserId) return false;
    if (c.userId) return String(c.userId) === String(currentUserId);
    const commentHandle = String(c.username || "").trim().replace(/^@/, "").toLowerCase();
    return Boolean(currentUserHandle && commentHandle && commentHandle === currentUserHandle);
  }, [actionComment, currentUserHandle, currentUserId]);

  const handleDeleteComment = async () => {
    const c = actionComment;
    if (!c || !reelId) return;
    if (!canDeleteComment) return;
    const commentId = String(c.id || "");
    const isOptimistic = Boolean(c.pending) || commentId.startsWith("optimistic-");

    setActionBusy(true);
    setActionComment(null);
    setError("");

    setItems((prev) => prev.filter((raw) => resolveCommentId(raw) !== commentId));
    if (!isOptimistic) onCountChange?.(-1);

    if (isOptimistic) {
      setActionBusy(false);
      return;
    }

    try {
      await deleteInBuzzComment(reelId, commentId);
    } catch (err) {
      setError(err?.message || "Failed to delete comment.");
      // Best-effort: reload list so UI matches server.
      fetchInBuzzComments(reelId, { limit: 25 })
        .then((list) => setItems(Array.isArray(list) ? list : []))
        .catch(() => {});
      onCountChange?.(1);
    } finally {
      setActionBusy(false);
    }
  };

  const handleBlockCommentUser = async () => {
    const c = actionComment;
    if (!c) return;
    const targetId = c.userId;
    if (!targetId) return;
    if (!currentUser) {
      alert("Please sign in to block.");
      return;
    }
    if (!confirm("Block this user? You will no longer see their content.")) return;
    setActionBusy(true);
    setActionComment(null);
    setError("");
    try {
      await blockUser(targetId, { context: "inbuzz_comment" });
      addBlockedUser?.(targetId);
      setItems((prev) =>
        prev.filter((raw) => String(resolveCommentUserId(raw)) !== String(targetId))
      );
      alert("User blocked.");
    } catch (err) {
      setError(err?.message || "Failed to block user.");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <Motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 240 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl sm:rounded-3xl glass-card p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#faf0e6]">Comments</p>
                <p className="text-[11px] text-[#b9b4c7]">
                  {loading ? "Loading…" : `${comments.length} comments`}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-full text-[#b9b4c7] hover:text-[#faf0e6] hover:bg-white/10"
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {error && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            <div className="mt-4 max-h-[52dvh] overflow-y-auto space-y-3 pr-1">
              {loading ? (
                <div className="text-center text-xs text-[#b9b4c7] py-8">Loading comments…</div>
              ) : comments.length ? (
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-white/5 border border-white/10 overflow-hidden shrink-0">
                      {c.avatar ? (
                        <img
                          src={c.avatar}
                          alt={c.username}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[#faf0e6] font-semibold truncate">
                            @{c.username}
                            {c.pending && (
                              <span className="ml-2 text-[10px] text-[#b9b4c7] font-normal">
                                sending…
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-[#faf0e6] break-words">{c.text}</div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setActionComment(c)}
                          className="h-8 w-8 rounded-full text-[#b9b4c7] hover:text-[#faf0e6] hover:bg-white/10 shrink-0"
                          aria-label="Comment info"
                          disabled={actionBusy}
                          title="Comment options"
                        >
                          <i className="fa-solid fa-circle-info"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-xs text-[#b9b4c7] py-8">
                  Be the first to comment.
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add a comment…"
                className="flex-1 rounded-full glass-input px-4 py-2 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={posting || !text.trim()}
                className="rounded-full liquid-button px-4 py-2 text-xs font-semibold text-[#faf0e6] disabled:opacity-50"
              >
                Send
              </button>
            </div>

            <AnimatePresence>
              {!!actionComment && (
                <Motion.div
                  className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setActionComment(null)}
                >
                  <Motion.div
                    initial={{ y: 30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 30, opacity: 0 }}
                    transition={{ type: "spring", damping: 22, stiffness: 240 }}
                    onClick={(event) => event.stopPropagation()}
                    className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl glass-card p-5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#faf0e6] truncate">
                          @{actionComment.username}
                        </p>
                        <p className="text-[11px] text-[#b9b4c7] truncate">
                          Comment options
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActionComment(null)}
                        className="h-8 w-8 rounded-full text-[#b9b4c7] hover:text-[#faf0e6] hover:bg-white/10"
                        aria-label="Close"
                        disabled={actionBusy}
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </div>

                    <div className="mt-4 space-y-2">
                      {!actionCommentIsSelf && (
                        <button
                          type="button"
                          onClick={() => {
                            setReportTarget(actionComment);
                            setActionComment(null);
                          }}
                          disabled={actionBusy}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-[#faf0e6] hover:bg-white/10 disabled:opacity-60"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span>Report comment</span>
                            <i className="fa-solid fa-flag text-xs text-[#b9b4c7]"></i>
                          </div>
                        </button>
                      )}

                      {canDeleteComment && (
                        <button
                          type="button"
                          onClick={handleDeleteComment}
                          disabled={actionBusy}
                          className="w-full rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-left text-sm text-rose-200 hover:bg-rose-500/15 disabled:opacity-60"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span>Delete comment</span>
                            <i className="fa-solid fa-trash text-xs"></i>
                          </div>
                        </button>
                      )}

                      {!actionCommentIsSelf && (
                        <button
                          type="button"
                          onClick={handleBlockCommentUser}
                          disabled={actionBusy}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-[#faf0e6] hover:bg-white/10 disabled:opacity-60"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span>Block user</span>
                            <i className="fa-solid fa-user-slash text-xs text-[#b9b4c7]"></i>
                          </div>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setActionComment(null)}
                        disabled={actionBusy}
                        className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-left text-sm text-[#b9b4c7] hover:bg-black/40 hover:text-[#faf0e6] disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </Motion.div>
                </Motion.div>
              )}
            </AnimatePresence>
          </Motion.div>

          <ReportModal
            isOpen={!!reportTarget}
            onClose={() => setReportTarget(null)}
            title="Report comment"
            reasons={INBUZZ_COMMENT_REPORT_REASONS}
            onSubmit={async ({ reason, details }) => {
              if (!currentUser) {
                alert("Please sign in to report.");
                throw new Error("Not signed in");
              }
              const commentId = reportTarget?.id;
              if (!commentId) return;
              try {
                await reportComment(commentId, { reason, details });
                alert("Thanks for helping keep InCampus safe.");
              } catch (err) {
                alert(err?.message || "Failed to report comment");
                throw err;
              }
            }}
          />
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
