import { useEffect, useMemo, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { getUserById } from "../../services/api";
import { getSocket } from "../../services/socket";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

export default function ShareToChatModal({ isOpen, onClose, postUrl, postTitle }) {
  const { currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);

  const groups = useMemo(() => {
    const college = currentUser?.university || currentUser?.college || "";
    const slug = encodeURIComponent(String(college).toLowerCase());
    return [
      {
        id: "group:global",
        label: "InCampus Global",
        type: "group",
        avatar: "/incampus-icon.svg",
        subtitle: "Global group",
      },
      college
        ? {
            id: `group:college:${slug}`,
            label: `${college} Group`,
            type: "group",
            avatar: "/incampus-icon.svg",
            subtitle: "College group",
          }
        : null,
    ].filter(Boolean);
  }, [currentUser?.university, currentUser?.college]);

  useEffect(() => {
    if (!isOpen) return;
    const loadContacts = async () => {
      const friends = currentUser?.friends || [];
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
        console.error("Failed to load contacts:", error);
      } finally {
        setLoading(false);
      }
    };
    loadContacts();
  }, [isOpen, currentUser?.friends]);

  const filteredTargets = useMemo(() => {
    const list = [...groups, ...contacts];
    if (!search) return list;
    const query = search.toLowerCase();
    return list.filter((target) => target.label.toLowerCase().includes(query));
  }, [groups, contacts, search]);

  const handleShare = (targetId) => {
    const socket = getSocket();
    if (!socket || !currentUser?.id) return;
    const message = {
      from: currentUser.id,
      to: targetId,
      text: `Shared a post: ${postTitle || "InCampus Post"} - ${postUrl}`,
      createdAt: new Date().toISOString(),
    };
    socket.emit("chat-message", message);
    onClose?.();
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

            {loading ? (
              <p className="text-center text-[#b9b4c7] text-sm">Loading chats...</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredTargets.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => handleShare(target.id)}
                    className="w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                  >
                    <img
                      src={target.avatar || ANONYMOUS_AVATAR}
                      alt={target.label}
                      className="h-9 w-9 rounded-full object-cover"
                    />
                    <div>
                      <p className="text-sm font-semibold text-[#faf0e6]">{target.label}</p>
                      <p className="text-[11px] text-[#b9b4c7]">{target.subtitle}</p>
                    </div>
                  </button>
                ))}
                {filteredTargets.length === 0 && (
                  <p className="text-center text-[#b9b4c7] text-sm">
                    No chats found
                  </p>
                )}
              </div>
            )}
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
