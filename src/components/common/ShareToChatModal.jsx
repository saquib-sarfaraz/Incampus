import { useEffect, useMemo, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { getUserById, sendChatMessage } from "../../services/api";
import { getSocket } from "../../services/socket";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

const resolvePreviewText = (postTitle, postPreviewText) => {
  const base = postPreviewText || postTitle || "";
  if (!base) return "Shared a post";
  return base.length > 80 ? `${base.slice(0, 80)}...` : base;
};

export default function ShareToChatModal({
  isOpen,
  onClose,
  postUrl,
  postTitle,
  postId,
  postThumbnail,
  postPreviewText,
  postIsAnonymous = false,
  postAuthorName,
  postAuthorId,
}) {
  const { currentUser } = useAuth();
  const { friendIds, friendMapLoaded } = useApp();
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState(new Set());
  const [toast, setToast] = useState("");

  const resolvedFriendIds = useMemo(() => {
    if (friendMapLoaded) return friendIds;
    return currentUser?.friends || [];
  }, [friendIds, friendMapLoaded, currentUser?.friends]);

  const groups = useMemo(() => {
    const college = currentUser?.university || currentUser?.college || "";
    const toSlug = (value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const collegeGroupId =
      currentUser?.collegeGroupId ||
      currentUser?.college_group_id ||
      currentUser?.groupId ||
      currentUser?.collegeGroup ||
      "";
    const collegeRoomId = collegeGroupId
      ? String(collegeGroupId).startsWith("group:")
        ? String(collegeGroupId)
        : `group:college:${collegeGroupId}`
      : college
        ? `group:college:${toSlug(college)}`
        : "";
    return [
      {
        id: "group:global",
        label: "InCampus Global",
        type: "group",
        avatar: "/incampus-icon.svg",
        subtitle: "Global group",
      },
      collegeRoomId
        ? {
            id: collegeRoomId,
            label: college ? `${college} Group` : "College Group",
            type: "group",
            avatar: "/incampus-icon.svg",
            subtitle: "College group",
          }
        : null,
    ].filter(Boolean);
  }, [currentUser?.university, currentUser?.college, currentUser?.collegeGroupId, currentUser?.college_group_id, currentUser?.groupId, currentUser?.collegeGroup]);

  useEffect(() => {
    if (!isOpen) return;
    const loadContacts = async () => {
      const friends = resolvedFriendIds || [];
      if (friends.length === 0) {
        setContacts([]);
        return;
      }
      setLoading(true);
      try {
        const users = await Promise.all(
          friends.map(async (id) => {
            const user = await getUserById(id);
            return user
              ? {
                  id: user._id || user.id,
                  label: user.fullName || user.username || "User",
                  subtitle: user.username ? `@${user.username}` : "Friend",
                  avatar: user.profilePicUrl || ANONYMOUS_AVATAR,
                  type: "friend",
                }
              : null;
          })
        );
        setContacts(users.filter(Boolean));
      } catch (error) {
      } finally {
        setLoading(false);
      }
    };
    loadContacts();
  }, [isOpen, resolvedFriendIds]);

  useEffect(() => {
    if (isOpen) return;
    setSearch("");
    setSelectedTargets(new Set());
    setToast("");
  }, [isOpen]);

  const filteredTargets = useMemo(() => {
    const list = [...groups, ...contacts];
    if (!search) return list;
    const query = search.toLowerCase();
    return list.filter((target) => target.label.toLowerCase().includes(query));
  }, [groups, contacts, search]);

  const recentTargets = useMemo(() => filteredTargets.slice(0, 6), [filteredTargets]);

  const toggleTarget = (targetId) => {
    if (!targetId) return;
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      return next;
    });
  };

  const clearSelection = () => setSelectedTargets(new Set());

  const handleShare = (targetIds) => {
    const socket = getSocket();
    if (!socket || !currentUser?.id) return;
    const ids = Array.isArray(targetIds) ? targetIds : [targetIds];
    if (ids.length === 0) return;
    const previewText = resolvePreviewText(postTitle, postPreviewText);
    const shareLink =
      postUrl || (postId ? `${window.location.origin}/feed?post=${postId}` : "");

    const canUseSocket = Boolean(socket?.connected);
    ids.forEach((targetId) => {
      const message = {
        from: currentUser.id,
        to: targetId,
        text: `Shared a post: ${previewText}`,
        createdAt: new Date().toISOString(),
        messageType: "shared_post",
        type: "shared_post",
        postId,
        postUrl: shareLink,
        postThumbnail,
        postPreviewText: previewText,
        postIsAnonymous,
        postAuthorName: postIsAnonymous ? undefined : postAuthorName,
        postAuthorId: postIsAnonymous ? undefined : postAuthorId,
        senderId: currentUser.id,
      };
      if (canUseSocket) {
        const isGroup = String(targetId).startsWith("group:");
        socket.emit("chat:sendMessage", {
          roomId: targetId,
          receiverId: isGroup ? null : targetId,
          message,
        });
      } else {
        sendChatMessage(message).catch(() => {});
      }
    });

    setToast("Post shared");
    clearSelection();
    setTimeout(() => {
      setToast("");
      onClose?.();
    }, 700);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          onClick={onClose}
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
              <h3 className="text-sm font-semibold text-[#faf0e6]">Share to Chat</h3>
              <button
                onClick={onClose}
                className="text-[#b9b4c7] hover:text-[#faf0e6] text-xl"
              >
                &times;
              </button>
            </div>

            <div className="relative mb-3">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[#b9b4c7] text-xs"></i>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats..."
                className="w-full pl-9 pr-3 py-2 rounded-full text-xs glass-input"
              />
            </div>

            {recentTargets.length > 0 && (
              <div className="mb-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#b9b4c7] mb-2">
                  Recent
                </p>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {recentTargets.map((target, index) => {
                    const targetId =
                      target.id ||
                      target._id ||
                      target.userId ||
                      target.user_id ||
                      "";
                    const targetKey = targetId || `recent-${index}`;
                    const isSelected = targetId ? selectedTargets.has(targetId) : false;
                    return (
                      <button
                        key={`recent-${targetKey}`}
                        type="button"
                        onClick={() => targetId && toggleTarget(targetId)}
                        className={`flex flex-col items-center gap-1 min-w-[72px] rounded-2xl border ${
                          isSelected
                            ? "border-emerald-300/60 bg-emerald-400/10"
                            : "border-white/10 bg-white/5"
                        } px-2 py-2`}
                      >
                        <img
                          src={target.avatar || ANONYMOUS_AVATAR}
                          alt={target.label}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                        <span className="text-[10px] text-[#faf0e6] truncate w-full">
                          {target.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {loading ? (
              <p className="text-center text-[#b9b4c7] text-sm">Loading chats...</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredTargets.map((target, index) => {
                  const targetId =
                    target.id ||
                    target._id ||
                    target.userId ||
                    target.user_id ||
                    "";
                  const targetKey = targetId || `target-${index}`;
                  const isSelected = targetId ? selectedTargets.has(targetId) : false;
                  return (
                    <button
                      key={String(targetKey)}
                      type="button"
                      onClick={() => targetId && toggleTarget(targetId)}
                      className={`w-full flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "border-emerald-300/60 bg-emerald-400/10"
                          : "border-white/10 bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <img
                        src={target.avatar || ANONYMOUS_AVATAR}
                        alt={target.label}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#faf0e6]">
                          {target.label}
                        </p>
                        <p className="text-[11px] text-[#b9b4c7]">{target.subtitle}</p>
                      </div>
                      {isSelected && (
                        <i className="fa-solid fa-check text-emerald-300 text-xs"></i>
                      )}
                    </button>
                  );
                })}
                {filteredTargets.length === 0 && (
                  <p className="text-center text-[#b9b4c7] text-sm">
                    No chats found
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleShare(Array.from(selectedTargets))}
                disabled={selectedTargets.size === 0}
                className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold text-[#faf0e6] ${
                  selectedTargets.size === 0
                    ? "bg-white/5 text-[#b9b4c7] cursor-not-allowed"
                    : "liquid-button"
                }`}
              >
                {selectedTargets.size > 0
                  ? `Send (${selectedTargets.size})`
                  : "Send"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#faf0e6] hover:bg-white/10"
              >
                Close
              </button>
            </div>

            {toast && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-center text-xs text-[#faf0e6]">
                {toast}
              </div>
            )}
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
