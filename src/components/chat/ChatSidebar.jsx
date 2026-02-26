import { useEffect, useMemo, useState } from "react";
import { motion as Motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";

const CONTACTS_CACHE_KEY = "incampus:chat:contacts";
const CONTACTS_CACHE_TTL = 5 * 60 * 1000;
const ANONYMOUS_AVATAR = "https://placehold.co/64x64/9ca3af/ffffff?text=U";

const readContactsCache = (userId) => {
  if (!userId || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(CONTACTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.userId !== String(userId)) return [];
    if (!parsed.ts || Date.now() - parsed.ts > CONTACTS_CACHE_TTL) return [];
    return Array.isArray(parsed.contacts) ? parsed.contacts : [];
  } catch {
    return [];
  }
};

const resolveContactId = (contact) =>
  contact?.id || contact?._id || contact?.userId || contact?.user_id || "";

const resolveContactName = (contact) =>
  contact?.displayName ||
  contact?.fullName ||
  contact?.name ||
  contact?.username ||
  "User";

const resolveContactAvatar = (contact) =>
  contact?.profilePicUrl ||
  contact?.profilePic ||
  contact?.avatarUrl ||
  contact?.avatar ||
  contact?.photoUrl ||
  contact?.photo ||
  ANONYMOUS_AVATAR;

const resolveMessagePreview = (message) => {
  if (!message) return "";
  if (typeof message === "string") return message;
  return (
    message?.text ||
    message?.content ||
    message?.message ||
    message?.body ||
    ""
  );
};

const truncateText = (text, max = 40) => {
  const raw = String(text || "").trim();
  if (!raw) return "";
  return raw.length > max ? `${raw.slice(0, max).trimEnd()}…` : raw;
};

export default function ChatSidebar() {
  const { currentUser } = useAuth();
  const { chatMeta, requestChatOpen } = useApp();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState(() =>
    readContactsCache(currentUser?.id)
  );

  useEffect(() => {
    setContacts(readContactsCache(currentUser?.id));
  }, [currentUser?.id]);

  const sortedContacts = useMemo(() => {
    return [...contacts]
      .map((contact) => ({
        contact,
        id: resolveContactId(contact),
      }))
      .filter((entry) => entry.id)
      .sort((a, b) => {
        const aUnread = (chatMeta[a.id]?.unreadCount || 0) > 0;
        const bUnread = (chatMeta[b.id]?.unreadCount || 0) > 0;
        if (aUnread !== bUnread) return aUnread ? -1 : 1;
        const aTime = new Date(chatMeta[a.id]?.lastMessageAt || 0).getTime();
        const bTime = new Date(chatMeta[b.id]?.lastMessageAt || 0).getTime();
        if (aTime !== bTime) return bTime - aTime;
        return 0;
      })
      .slice(0, 6);
  }, [contacts, chatMeta]);

  const handleOpenChat = (chatId) => {
    if (!chatId) return;
    requestChatOpen?.(chatId);
    navigate("/chat");
  };

  return (
    <div className="glass-card rounded-3xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">Chat</p>
          <p className="text-sm font-semibold text-[#faf0e6]">Recent</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/chat")}
          className="text-xs text-[#b9b4c7] hover:text-[#faf0e6] transition-colors"
        >
          Open
        </button>
      </div>

      {sortedContacts.length === 0 ? (
        <p className="text-xs text-[#b9b4c7]">
          Open chat to load your recent conversations.
        </p>
      ) : (
        <div className="space-y-2">
          {sortedContacts.map((entry) => {
            const { contact, id } = entry;
            const meta = chatMeta[id] || {};
            const unreadCount = meta.unreadCount || 0;
            const preview = truncateText(resolveMessagePreview(meta.lastMessage)) ||
              "Say hello to start chatting";
            return (
              <Motion.button
                key={String(id)}
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => handleOpenChat(id)}
                className="w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10 transition-colors"
              >
                <img
                  src={resolveContactAvatar(contact)}
                  alt={resolveContactName(contact)}
                  className="h-10 w-10 rounded-full object-cover border border-white/10"
                  loading="lazy"
                  decoding="async"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-[#faf0e6] truncate">
                      {resolveContactName(contact)}
                    </p>
                    {unreadCount > 0 && (
                      <span className="text-[10px] font-semibold text-[#faf0e6] bg-amber-400/20 border border-amber-400/40 px-2 py-0.5 rounded-full">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#b9b4c7] truncate">{preview}</p>
                </div>
              </Motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
