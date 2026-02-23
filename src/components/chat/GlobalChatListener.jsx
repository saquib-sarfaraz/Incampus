import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";

const CHAT_TOAST_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=U";

const resolveEntityId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return String(value._id || value.id || value.userId || value.user_id || "");
  }
  return "";
};

const resolveMessagePreview = (msg) => {
  if (!msg) return "";
  if (msg.messageType === "shared_post" || msg.type === "shared_post") {
    return msg.postPreviewText || msg.postTitle || "Shared a post";
  }
  return msg.text || "";
};

const truncateMessage = (text = "", max = 60) => {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const CHAT_EVENT = "chat:newMessage";

export default function GlobalChatListener() {
  const location = useLocation();
  const { currentUser } = useAuth();
  const {
    activeChatId,
    chatViewActive,
    updateChatMeta,
    pushChatToast,
    getUserFromCache,
  } = useApp();
  const seenRef = useRef(new Map());

  const isChatRoute = useMemo(
    () => location.pathname === "/chat" || location.pathname.startsWith("/chat"),
    [location.pathname]
  );

  const resolveChatIdFromMessage = useCallback(
    (message) => {
      if (!message) return "";
      const rawTarget =
        message.chatId ||
        message.chat_id ||
        message.toChatId ||
        message.to ||
        message.receiverId ||
        message.recipientId ||
        "";
      const target = String(rawTarget || "");
      if (target.startsWith("group:")) return target;
      const fromId = resolveEntityId(
        message.from || message.senderId || message.userId || message.sender
      );
      if (currentUser?.id && fromId && String(fromId) === String(currentUser.id)) {
        return target || fromId;
      }
      return fromId || target;
    },
    [currentUser?.id]
  );

  const handleChatMessage = useCallback(
    (payload) => {
      if (!currentUser?.id) return;
      const message = payload?.message || payload;
      if (!message) return;
      const chatId = resolveChatIdFromMessage(message);
      if (!chatId) return;

      const senderId = resolveEntityId(
        message.from || message.senderId || message.userId || message.sender
      );
      const dedupeKey =
        message._id ||
        message.id ||
        `${chatId}-${message.createdAt || message.timestamp || ""}-${senderId || "anon"}-${
          message.text || message.postId || message.messageType || ""
        }`;
      if (dedupeKey) {
        const now = Date.now();
        const seenAt = seenRef.current.get(dedupeKey);
        if (seenAt && now - seenAt < 5000) return;
        seenRef.current.set(dedupeKey, now);
        if (seenRef.current.size > 500) {
          const entries = Array.from(seenRef.current.entries());
          entries
            .sort((a, b) => a[1] - b[1])
            .slice(0, 200)
            .forEach(([key]) => seenRef.current.delete(key));
        }
      }

      const isFromSelf =
        senderId && currentUser?.id && String(senderId) === String(currentUser.id);
      const isActiveChat = Boolean(chatViewActive && isChatRoute && activeChatId === chatId);

      updateChatMeta(chatId, message, {
        incrementUnread: !isActiveChat && !isFromSelf,
      });

      if (!isFromSelf && !isActiveChat) {
        const cachedUser = senderId ? getUserFromCache(senderId) : null;
        const senderName =
          message.senderName ||
          message.fromName ||
          message.authorName ||
          cachedUser?.displayName ||
          cachedUser?.username ||
          "New message";
        const senderAvatar =
          message.senderAvatar ||
          message.fromAvatar ||
          cachedUser?.profilePicUrl ||
          CHAT_TOAST_AVATAR;
        const preview = truncateMessage(resolveMessagePreview(message));
        const rawTime =
          message.createdAt ||
          message.created_at ||
          message.timestamp ||
          message.sentAt ||
          Date.now();
        const timeBucket = Math.floor(new Date(rawTime).getTime() / 5000);
        const toastKey = `${chatId}-${senderId || "anon"}-${preview || ""}-${timeBucket}`;
        pushChatToast({
          id: `${chatId}-${message.createdAt || message.timestamp || Date.now()}`,
          dedupeKey: toastKey,
          chatId,
          senderId,
          title: senderName,
          message: preview || "Sent you a message",
          avatar: senderAvatar,
        });
      }
    },
    [
      currentUser?.id,
      activeChatId,
      chatViewActive,
      isChatRoute,
      updateChatMeta,
      pushChatToast,
      getUserFromCache,
      resolveChatIdFromMessage,
    ]
  );

  useEffect(() => {
    if (!currentUser?.id) return;
    if (typeof window === "undefined") return;

    const handleWindowEvent = (event) => {
      const payload = event?.detail || event;
      handleChatMessage(payload);
    };

    window.addEventListener(CHAT_EVENT, handleWindowEvent);

    return () => {
      window.removeEventListener(CHAT_EVENT, handleWindowEvent);
    };
  }, [currentUser?.id, handleChatMessage]);

  return null;
}
