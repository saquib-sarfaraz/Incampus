import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../context/authContext";
import { useApp } from "../context/useApp";
import {
  getChatMessages,
  getGroupChatMessages,
  getPendingRequests,
  getUserById,
  sendChatMessage,
  markChatSeen,
  reportMessage,
  blockUser,
} from "../services/api";
import { getSocket, ensureSocketConnected } from "../services/socket";
import Header from "../components/common/Header";
import BottomNav from "../components/common/BottomNav";
import CreatePostModal from "../components/feed/CreatePostModal";
import ReportModal from "../components/moderation/ReportModal";
import PostModal from "../components/profile/PostModal";
import BlueTick from "../components/common/BlueTick";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONTACTS_CACHE_KEY = "incampus:chat:contacts";
const CONTACTS_CACHE_TTL = 5 * 60 * 1000;
const REQUESTS_CACHE_KEY = "incampus:chat:requests";
const REQUESTS_CACHE_TTL = 2 * 60 * 1000;
const CHAT_SOUND_PREF_KEY = "incampus:chat:sound";

const resolveMessageSenderId = (msg) => {
  if (!msg) return "";
  return String(
    msg.from ||
      msg.senderId ||
      msg.sender_id ||
      msg.userId ||
      msg.user_id ||
      msg.authorId ||
      msg.author_id ||
      msg.ownerId ||
      msg.owner_id ||
      msg.createdById ||
      msg.created_by ||
      msg.sender?._id ||
      msg.sender?.id ||
      msg.user?._id ||
      msg.user?.id ||
      msg.fromUser?._id ||
      msg.fromUser?.id ||
      msg.author?._id ||
      msg.author?.id ||
      msg.owner?._id ||
      msg.owner?.id ||
      msg.createdBy?._id ||
      msg.createdBy?.id ||
      msg.sender ||
      msg.user ||
      msg.author ||
      msg.owner ||
      msg.createdBy ||
      ""
  );
};

const resolveMessageRecipientId = (msg) => {
  if (!msg) return "";
  return String(
    msg.to ||
      msg.chatId ||
      msg.chat_id ||
      msg.groupId ||
      msg.group_id ||
      msg.roomId ||
      msg.room_id ||
      msg.conversationId ||
      msg.conversation_id ||
      msg.receiverId ||
      msg.recipientId ||
      msg.targetUserId ||
      msg.targetId ||
      msg.target ||
      ""
  );
};

const resolveMessageSenderEntity = (msg) =>
  (msg && typeof msg === "object"
    ? msg.sender ||
      msg.user ||
      msg.fromUser ||
      msg.author ||
      msg.owner ||
      msg.createdBy ||
      null
    : null);

const readContactsCache = (userId) => {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CONTACTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.userId !== String(userId)) return null;
    if (!parsed.ts || Date.now() - parsed.ts > CONTACTS_CACHE_TTL) return null;
    return Array.isArray(parsed.contacts) ? parsed.contacts : null;
  } catch {
    return null;
  }
};

const writeContactsCache = (userId, contacts) => {
  if (!userId || typeof window === "undefined") return;
  try {
    const payload = {
      userId: String(userId),
      ts: Date.now(),
      contacts: Array.isArray(contacts) ? contacts : [],
    };
    sessionStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
};

const readRequestsCache = (userId) => {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(REQUESTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.userId !== String(userId)) return null;
    if (!parsed.ts || Date.now() - parsed.ts > REQUESTS_CACHE_TTL) return null;
    return Array.isArray(parsed.requests) ? parsed.requests : null;
  } catch {
    return null;
  }
};

const writeRequestsCache = (userId, requests) => {
  if (!userId || typeof window === "undefined") return;
  try {
    const payload = {
      userId: String(userId),
      ts: Date.now(),
      requests: Array.isArray(requests) ? requests : [],
    };
    sessionStorage.setItem(REQUESTS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
};

const isGroupChatId = (chatId) => String(chatId || "").startsWith("group:");

const isAnonymousUser = (userData) =>
  Boolean(
    userData?.isAnonymous ||
      userData?.anonymous ||
      userData?.isAnonymousUser ||
      userData?.isAnonymousProfile ||
      userData?.displayName === "Anonymous"
  );

const resolveFriendId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value._id || value.id || value.userId || value.user_id || "");
};

const messageKey = (msg) => {
  if (!msg) return "";
  const senderId = resolveMessageSenderId(msg);
  const recipientId = resolveMessageRecipientId(msg);
  const createdAt = msg.createdAt || msg.created_at || msg.timestamp || "";
  const payloadKey = msg.text || msg.postId || msg.messageType || msg.type || "";
  return (
    msg._id ||
    msg.id ||
    msg.clientMessageId ||
    `${senderId}-${recipientId}-${createdAt}-${payloadKey}`
  );
};

const getMessageTimestamp = (msg) => {
  const raw = msg?.createdAt || msg?.created_at || msg?.timestamp;
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : time;
};

const getMessageExpiryTimestamp = (msg) => {
  const explicit = msg?.expiresAt || msg?.expires_at;
  if (explicit) {
    const expires = new Date(explicit).getTime();
    if (!Number.isNaN(expires)) return expires;
  }
  const created = getMessageTimestamp(msg);
  if (created === null) return null;
  return created + DAY_MS;
};

const isMessageExpired = (msg, now = Date.now()) => {
  const expires = getMessageExpiryTimestamp(msg);
  if (expires === null) return false;
  return expires <= now;
};

const filterMessagesForChat = (chatId, messages, now = Date.now()) => {
  if (!Array.isArray(messages)) return [];
  return messages.filter((msg) => !isMessageExpired(msg, now));
};

const formatTime = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatLastSeen = (dateString) => {
  if (!dateString) return "Offline";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Offline";
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `Last seen ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return `Last seen ${date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const resolveMessagePreview = (msg) => {
  if (!msg) return "";
  if (msg.messageType === "shared_post" || msg.type === "shared_post") {
    return msg.postPreviewText || msg.postTitle || "Shared a post";
  }
  return msg.text || "";
};

const truncateMessage = (text = "") => {
  if (!text) return "";
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
};

export default function Chat() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const {
    cacheUser,
    getUserFromCache,
    posts,
    loadPosts,
    chatMeta,
    updateChatMeta,
    setChatMetaEntry,
    markChatRead,
    pushChatToast,
    activeChatId,
    setActiveChatId,
    setChatViewActive,
    isUserBlocked,
    addBlockedUser,
    friendIds,
    friendIdSet: friendIdSetFromContext,
    friendMapLoaded,
    canChat,
    getFriendStatus,
    sendFriendRequest,
    acceptFriend,
    rejectFriend,
  } = useApp();
  const [activeTab, setActiveTab] = useState("contacts");
  const [contacts, setContacts] = useState(() => {
    if (typeof window === "undefined") return [];
    return readContactsCache(currentUser?.id) || [];
  });
  const [contactsLoading, setContactsLoading] = useState(() => {
    if (typeof window === "undefined") return true;
    return !(readContactsCache(currentUser?.id) || []).length;
  });
  const [requests, setRequests] = useState(() => {
    if (typeof window === "undefined") return [];
    return readRequestsCache(currentUser?.id) || [];
  });
  const [messagesByChat, setMessagesByChat] = useState({});
  const [messageText, setMessageText] = useState("");
  const [presenceMap, setPresenceMap] = useState({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sharedPost, setSharedPost] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  const [chatSoundEnabled, setChatSoundEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem(CHAT_SOUND_PREF_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
    return false;
  });
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [friendRequestLoading, setFriendRequestLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const activeChatRef = useRef(activeChatId);
  const messageIndexRef = useRef({});
  const loadedChatsRef = useRef(new Set());
  const lastSeenSentRef = useRef(new Map());
  const missingGroupSenderRef = useRef(new Set());

  const resolvedFriendIds = useMemo(() => {
    if (friendMapLoaded) return friendIds;
    return currentUser?.friends || [];
  }, [friendIds, friendMapLoaded, currentUser?.friends]);

  const resolvedFriendIdSet = useMemo(() => {
    if (friendMapLoaded) return friendIdSetFromContext || new Set();
    return new Set((currentUser?.friends || []).map((id) => String(id)));
  }, [friendMapLoaded, friendIdSetFromContext, currentUser?.friends]);
  const friendIdsKey = useMemo(
    () => (resolvedFriendIds || []).map((id) => String(id)).sort().join("|"),
    [resolvedFriendIds]
  );

  useEffect(() => {
    if (!currentUser?.id) return;
    const cached = readContactsCache(currentUser.id);
    if (cached && cached.length) {
      setContacts(cached);
      setContactsLoading(false);
    }
    const cachedRequests = readRequestsCache(currentUser.id);
    if (cachedRequests && cachedRequests.length) {
      setRequests(cachedRequests);
    }
  }, [currentUser?.id]);

  const handleReportMessage = (msg) => {
    setReportTarget(msg);
  };

  const submitMessageReport = async ({ reason, details }) => {
    if (!reportTarget) return;
    const messageId = reportTarget._id || reportTarget.id;
    if (!messageId) return;
    try {
      await reportMessage(messageId, {
        reason,
        details,
        context: "chat",
      });
      alert("Thanks for reporting. Our team will review it.");
    } catch (error) {
      alert(error.message || "Failed to report message");
      throw error;
    }
  };

  const handleBlockActiveUser = async () => {
    if (!activeChatUser || activeChatUser?.isGroup) return;
    const userId = activeChatUser.id;
    if (!userId) return;
    if (!confirm("Block this user? You will no longer see their messages.")) return;
    try {
      await blockUser(userId, { context: "chat_header" });
      addBlockedUser(userId);
      setActiveChatId(null);
      alert("User blocked.");
    } catch (error) {
      alert(error.message || "Failed to block user");
    }
  };

  useEffect(() => {
    activeChatRef.current = activeChatId;
    if (activeChatId && !String(activeChatId).startsWith("group:")) {
      ensureSocketConnected();
    }
  }, [activeChatId]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CHAT_SOUND_PREF_KEY, chatSoundEnabled ? "on" : "off");
  }, [chatSoundEnabled]);

  useEffect(() => {
    if (!isMobile) return;
    const originalOverflow = document.body.style.overflow;
    if (activeChatId) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = originalOverflow || "";
    }
    return () => {
      document.body.style.overflow = originalOverflow || "";
    };
  }, [isMobile, activeChatId]);

  const ensureIndex = useCallback((chatId) => {
    if (!messageIndexRef.current[chatId]) {
      messageIndexRef.current[chatId] = new Set();
    }
    return messageIndexRef.current[chatId];
  }, []);

  const playNotificationSound = useCallback(() => {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      oscillator.onended = () => context.close();
    } catch {
      // ignore audio errors
    }
  }, []);

  const findPostById = useCallback(
    (postId) => {
      if (!postId) return null;
      const list = Array.isArray(posts) ? posts : [];
      return list.find((post) => String(post._id || post.id) === String(postId)) || null;
    },
    [posts]
  );

  const handleOpenSharedPost = useCallback(
    async (msg) => {
      if (!msg) return;
      const postId = msg.postId || msg.post_id || msg.post?.id || msg.post?._id;
      const fallbackPost = {
        _id: postId || msg.postId || msg.post_id || msg.post?.id || msg.post?._id,
        content: msg.postPreviewText || msg.postTitle || "Shared post",
        mediaUrl: msg.postThumbnail,
        isAnonymous: msg.postIsAnonymous || msg.isAnonymous,
        authorDisplayName: msg.postAuthorName,
        authorId: msg.postAuthorId,
      };
      if (postId) {
        navigate(`/feed?post=${encodeURIComponent(postId)}`, {
          state: { sharedPost: fallbackPost },
        });
        return;
      }
      if (msg.postUrl) {
        try {
          const parsed = new URL(msg.postUrl, window.location.origin);
          if (parsed.origin === window.location.origin) {
            navigate(`${parsed.pathname}${parsed.search}${parsed.hash}`, {
              state: { sharedPost: fallbackPost },
            });
            return;
          }
          window.open(parsed.toString(), "_blank", "noopener");
          return;
        } catch {
          window.open(msg.postUrl, "_blank", "noopener");
          return;
        }
      }
      if (!postId) return;
      let found = findPostById(postId);
      if (!found) {
        await loadPosts();
        found = findPostById(postId);
      }
      if (found) {
        setSharedPost(found);
        return;
      }
      setSharedPost(fallbackPost);
    },
    [findPostById, loadPosts, navigate]
  );

  const resolveContactName = useCallback(
    (contact) => {
      if (!contact) return "User";
      if (contact.isGroup) return contact.displayName || "Group";
      const cached = getUserFromCache(contact.id);
      return (
        cached?.displayName ||
        contact.displayName ||
        contact.fullName ||
        "User"
      );
    },
    [getUserFromCache]
  );

  const resolveContactVerified = useCallback(
    (contact) => {
      if (!contact || contact.isGroup) return false;
      const cached = getUserFromCache(contact.id);
      return Boolean(
        contact.isVerified ||
          contact.verified ||
          contact.is_verified ||
          cached?.isVerified ||
          cached?.verified ||
          cached?.is_verified
      );
    },
    [getUserFromCache]
  );

  const resolveMessageSender = useCallback(
    (msg) => {
      if (!msg) {
        return {
          id: "",
          name: "User",
          avatar: ANONYMOUS_AVATAR,
          isVerified: false,
        };
      }
      const senderEntity = resolveMessageSenderEntity(msg);
      const senderId = resolveMessageSenderId(msg);
      const cached = senderId ? getUserFromCache(senderId) : null;
      const name =
        senderEntity?.displayName ||
        senderEntity?.fullName ||
        senderEntity?.name ||
        senderEntity?.username ||
        msg.senderDisplayName ||
        msg.senderName ||
        msg.userDisplayName ||
        msg.userName ||
        msg.authorDisplayName ||
        msg.authorName ||
        msg.fromName ||
        msg.displayName ||
        msg.fullName ||
        msg.username ||
        cached?.displayName ||
        cached?.fullName ||
        cached?.name ||
        cached?.username ||
        "User";
      const avatar =
        senderEntity?.profilePicUrl ||
        senderEntity?.profilePic ||
        senderEntity?.avatarUrl ||
        senderEntity?.avatar ||
        msg.senderAvatar ||
        msg.userAvatar ||
        msg.profilePicUrl ||
        msg.avatarUrl ||
        msg.avatar ||
        cached?.profilePicUrl ||
        ANONYMOUS_AVATAR;
      const isVerified = Boolean(
        senderEntity?.isVerified ||
          senderEntity?.verified ||
          senderEntity?.is_verified ||
          msg.senderVerified ||
          msg.userVerified ||
          cached?.isVerified ||
          cached?.verified ||
          cached?.is_verified
      );
      return {
        id: senderId,
        name: name?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
        avatar,
        isVerified,
      };
    },
    [getUserFromCache]
  );

  const updatePresence = useCallback((userId, updates) => {
    if (!userId) return;
    setPresenceMap((prev) => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        ...updates,
      },
    }));
  }, []);

  const getPresence = useCallback(
    (userId, fallback) => {
      if (!userId) return { isOnline: false, lastSeen: "" };
      const current = presenceMap[userId] || {};
      return {
        isOnline: current.isOnline ?? fallback?.isOnline ?? false,
        lastSeen: current.lastSeen || fallback?.lastSeen || "",
      };
    },
    [presenceMap]
  );

  const mergeMessages = useCallback(
    (chatId, incomingMessages) => {
      if (!Array.isArray(incomingMessages)) return;

      setMessagesByChat((prev) => {
        const now = Date.now();
        const existing = prev[chatId] || [];
        const filteredExisting = filterMessagesForChat(chatId, existing, now);
        const filteredIncoming = filterMessagesForChat(chatId, incomingMessages, now);
        const index = ensureIndex(chatId);
        index.clear();
        filteredExisting.forEach((msg) => index.add(messageKey(msg)));
        const merged = [...filteredExisting];

        filteredIncoming.forEach((msg) => {
          const key = messageKey(msg);
          const incomingSender = resolveMessageSenderId(msg);
          const incomingRecipient = resolveMessageRecipientId(msg);
          const incomingText = msg.text || msg.postId || msg.messageType || msg.type || "";
          const incomingClientId = msg.clientMessageId || "";
          const incomingTime = getMessageTimestamp(msg);
          let replaced = false;

          if (incomingClientId) {
            const existingIndex = merged.findIndex(
              (existingMsg) => existingMsg.clientMessageId === incomingClientId
            );
            if (existingIndex >= 0) {
              const oldKey = messageKey(merged[existingIndex]);
              merged[existingIndex] = { ...merged[existingIndex], ...msg, pending: false };
              const newKey = messageKey(merged[existingIndex]);
              if (oldKey !== newKey) {
                index.delete(oldKey);
                index.add(newKey);
              }
              replaced = true;
            }
          }

          if (!replaced && incomingSender && currentUser?.id && incomingSender === String(currentUser.id)) {
            let bestIndex = -1;
            let bestDelta = Number.POSITIVE_INFINITY;
            merged.forEach((existingMsg, idx) => {
              if (!existingMsg?.pending) return;
              const existingSender = resolveMessageSenderId(existingMsg);
              const existingRecipient = resolveMessageRecipientId(existingMsg);
              if (existingSender !== incomingSender || existingRecipient !== incomingRecipient) {
                return;
              }
              const existingText =
                existingMsg.text ||
                existingMsg.postId ||
                existingMsg.messageType ||
                existingMsg.type ||
                "";
              if (existingText !== incomingText) return;
              const existingTime = getMessageTimestamp(existingMsg);
              if (existingTime === null || incomingTime === null) return;
              const delta = Math.abs(existingTime - incomingTime);
              if (delta < bestDelta) {
                bestDelta = delta;
                bestIndex = idx;
              }
            });
            if (bestIndex >= 0 && bestDelta < 15000) {
              const oldKey = messageKey(merged[bestIndex]);
              merged[bestIndex] = { ...merged[bestIndex], ...msg, pending: false };
              const newKey = messageKey(merged[bestIndex]);
              if (oldKey !== newKey) {
                index.delete(oldKey);
                index.add(newKey);
              }
              replaced = true;
            }
          }

          if (replaced) return;
          const recentDuplicate = merged.slice(-6).some((existingMsg) => {
            if (incomingClientId && existingMsg.clientMessageId === incomingClientId) {
              return true;
            }
            const existingSender = resolveMessageSenderId(existingMsg);
            const existingRecipient = resolveMessageRecipientId(existingMsg);
            if (existingSender !== incomingSender || existingRecipient !== incomingRecipient) {
              return false;
            }
            const existingText =
              existingMsg.text || existingMsg.postId || existingMsg.messageType || existingMsg.type || "";
            if (existingText !== incomingText) return false;
            const existingTime = getMessageTimestamp(existingMsg);
            if (existingTime === null || incomingTime === null) return false;
            return Math.abs(existingTime - incomingTime) < 2000;
          });

          if (!index.has(key) && !recentDuplicate) {
            index.add(key);
            merged.push(msg);
          }
        });

        merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        return { ...prev, [chatId]: merged };
      });
    },
    [ensureIndex, currentUser?.id]
  );

  const markMessagesSeen = useCallback(
    (chatId) => {
      if (!chatId) return;
      const seenAt = new Date().toISOString();
      const now = Date.now();
      const lastSent = lastSeenSentRef.current.get(chatId) || 0;
      const shouldEmit = now - lastSent > 2000;

      setMessagesByChat((prev) => {
        const existing = prev[chatId] || [];
        if (existing.length === 0) return prev;
        const updated = existing.map((msg) => {
          if (msg.from === currentUser?.id) return msg;
          if (msg.seenAt) return msg;
          return { ...msg, seenAt };
        });
        return { ...prev, [chatId]: updated };
      });

      if (!shouldEmit) return;
      lastSeenSentRef.current.set(chatId, now);

      const socket = getSocket();
      if (socket && currentUser?.id) {
        socket.emit("message-seen", {
          chatId,
          userId: currentUser.id,
          seenAt,
        });
      }
      markChatSeen({
        chatId,
        userId: currentUser?.id,
        seenAt,
        isGroup: String(chatId).startsWith("group:"),
      }).catch(() => {});
    },
    [currentUser, setMessagesByChat]
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadContacts = useCallback(
    async ({ force = false } = {}) => {
      if (!resolvedFriendIds || resolvedFriendIds.length === 0) return [];
      if (!force) {
        const cached = readContactsCache(currentUser?.id);
        if (cached && cached.length) return cached;
      }
    const friendsData = await Promise.all(
      resolvedFriendIds.map(async (friendId) => {
        if (isUserBlocked(friendId)) {
          return null;
        }
        let user = getUserFromCache(friendId);
        if (user && isAnonymousUser(user)) {
          return null;
        }
        if (!user) {
          const userData = await getUserById(friendId);
          if (userData) {
            if (isAnonymousUser(userData)) {
              return null;
            }
            cacheUser(userData);
            user = {
              id: userData._id,
              displayName:
                userData.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
              profilePicUrl: userData.profilePicUrl || ANONYMOUS_AVATAR,
              isOnline: userData.isOnline,
              lastSeen: userData.lastSeen || userData.last_seen || "",
              isVerified: Boolean(userData.isVerified),
            };
          }
        }
        return user;
      })
    );
      const filtered = friendsData.filter(Boolean);
      if (filtered.length) {
        writeContactsCache(currentUser?.id, filtered);
      }
      return filtered;
    },
    [cacheUser, getUserFromCache, isUserBlocked, resolvedFriendIds, currentUser?.id]
  );

  const resolveUnreadCount = useCallback(
    (messages = [], chatId) => {
      if (!currentUser?.id || !Array.isArray(messages)) return 0;
      if (chatId === activeChatRef.current) return 0;
      const now = Date.now();
      const scopedMessages = messages.filter((msg) => !isMessageExpired(msg, now));
      return scopedMessages.filter((msg) => {
        const senderId = msg.from || msg.senderId || msg.userId;
        if (String(senderId) === String(currentUser.id)) return false;
        return !(
          msg.seenAt ||
          msg.seen_at ||
          msg.readAt ||
          msg.read_at ||
          msg.viewedAt ||
          msg.viewed_at
        );
      }).length;
    },
    [currentUser]
  );

  const syncChatMetaFromMessages = useCallback(
    (chatId, messages) => {
      const list = Array.isArray(messages) ? messages : [];
      if (list.length === 0) {
        setChatMetaEntry(chatId, (current) => ({
          ...current,
          lastMessage: null,
          lastMessageAt: null,
          unreadCount: 0,
        }));
        return;
      }
      const last = list[list.length - 1];
      const lastAt = last?.createdAt || last?.created_at || last?.timestamp || null;
      setChatMetaEntry(chatId, (current) => ({
        ...current,
        lastMessage: last,
        lastMessageAt: lastAt || current?.lastMessageAt,
        unreadCount: resolveUnreadCount(list, chatId),
      }));
    },
    [resolveUnreadCount, setChatMetaEntry]
  );

  const pruneGroupMessagesInState = useCallback(
    (chatId, messages) => {
      const filtered = filterMessagesForChat(chatId, messages);
      const changed = filtered.length !== messages.length;
      if (changed) {
        const index = ensureIndex(chatId);
        index.clear();
        filtered.forEach((msg) => index.add(messageKey(msg)));
      }
      return { messages: filtered, changed };
    },
    [ensureIndex]
  );

  const loadRequests = useCallback(async () => {
    try {
      const currentUserId =
        currentUser?.id || (typeof window !== "undefined" ? localStorage.getItem("currentUserId") : "");
      if (!currentUserId) {
        return [];
      }
      const requestsData = await getPendingRequests({
        userId: currentUserId,
      });
      if (typeof window !== "undefined" && window.location?.search?.includes("debugRequests=1")) {
      }
      const resolveRequestUsers = (req) => {
        if (!req || typeof req !== "object") return { fromId: "", toId: "", user: null };
        const embeddedUser =
          (req.fromUser && typeof req.fromUser === "object" ? req.fromUser : null) ||
          (req.user && typeof req.user === "object" ? req.user : null) ||
          (req.requester && typeof req.requester === "object" ? req.requester : null) ||
          (req.sender && typeof req.sender === "object" ? req.sender : null) ||
          null;
        let fromRaw =
          req.senderId ||
          req.sender ||
          req.requesterId ||
          req.requester ||
          req.fromUserId ||
          req.fromUser ||
          req.from ||
          req.requestedBy ||
          req.pendingBy ||
          req.userA ||
          null;
        let toRaw =
          req.receiverId ||
          req.recipientId ||
          req.recipient ||
          req.toUserId ||
          req.toUser ||
          req.to ||
          req.targetUserId ||
          req.targetUser ||
          req.target ||
          req.userB ||
          req.userId ||
          null;

        const embeddedUserId = resolveFriendId(embeddedUser);
        if (!fromRaw && embeddedUser && (!currentUser?.id || embeddedUserId !== String(currentUser.id))) {
          fromRaw = embeddedUser;
        }
        if (!toRaw && embeddedUser && currentUser?.id && embeddedUserId === String(currentUser.id)) {
          toRaw = embeddedUser;
        }
        if (!fromRaw && !toRaw && embeddedUser) {
          fromRaw = embeddedUser;
        }

        const fromId = resolveFriendId(fromRaw);
        const toId = resolveFriendId(toRaw);

        const fromUser =
          (req.fromUser && typeof req.fromUser === "object" ? req.fromUser : null) ||
          (req.sender && typeof req.sender === "object" ? req.sender : null) ||
          (req.requester && typeof req.requester === "object" ? req.requester : null) ||
          (req.fromUserId && typeof req.fromUserId === "object" ? req.fromUserId : null) ||
          (fromRaw && typeof fromRaw === "object" ? fromRaw : null) ||
          null;
        const toUser =
          (req.recipient && typeof req.recipient === "object" ? req.recipient : null) ||
          (req.toUser && typeof req.toUser === "object" ? req.toUser : null) ||
          (req.toUserId && typeof req.toUserId === "object" ? req.toUserId : null) ||
          (toRaw && typeof toRaw === "object" ? toRaw : null) ||
          null;

        const currentId = currentUserId ? String(currentUserId) : "";
        const otherId =
          currentId && fromId && fromId !== currentId
            ? fromId
            : currentId && toId && toId !== currentId
              ? toId
              : fromId || toId;

        let user = null;
        if (fromUser && otherId && resolveFriendId(fromUser) === otherId) {
          user = fromUser;
        } else if (toUser && otherId && resolveFriendId(toUser) === otherId) {
          user = toUser;
        } else {
          user = fromUser || toUser || embeddedUser;
        }

        return { fromId, toId, user };
      };
      const requestList = Array.isArray(requestsData) ? requestsData : [];
      const formattedRequests = await Promise.all(
        requestList.map(async (req) => {
          const statusRaw = String(
            req?.status ||
              req?.state ||
              req?.requestStatus ||
              req?.request_status ||
              req?.friendStatus ||
              ""
          )
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");
          const blockedStatuses = new Set([
            "accepted",
            "approved",
            "rejected",
            "declined",
            "ignored",
            "cancelled",
            "canceled",
            "blocked",
            "removed",
          ]);
          if (statusRaw && blockedStatuses.has(statusRaw)) {
            return null;
          }
          const { fromId, toId, user: embeddedUser } = resolveRequestUsers(req);
          const isOutgoing =
            currentUserId && fromId && String(fromId) === String(currentUserId);
          if (isOutgoing) {
            return null;
          }
          const userId = fromId || resolveFriendId(embeddedUser) || "";
          if (userId && isUserBlocked(userId)) {
            return null;
          }
          let user =
            embeddedUser && typeof embeddedUser === "object"
              ? {
                  id: embeddedUser._id || embeddedUser.id || userId,
                  displayName:
                    embeddedUser.displayName ||
                    embeddedUser.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") ||
                    embeddedUser.username ||
                    "User",
                  profilePicUrl:
                    embeddedUser.profilePicUrl ||
                    embeddedUser.profilePic ||
                    embeddedUser.profile_pic ||
                    ANONYMOUS_AVATAR,
                  friends: embeddedUser.friends || [],
                  isVerified: Boolean(embeddedUser.isVerified),
                }
              : null;
          if (!user && userId) {
            user = getUserFromCache(userId);
          }
          if (!user && userId) {
            const userData = await getUserById(userId);
              if (userData) {
                cacheUser(userData);
                user = {
                  id: userData._id,
                  displayName:
                    userData.displayName ||
                    userData.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") ||
                    userData.username ||
                    "User",
                  profilePicUrl:
                    userData.profilePicUrl ||
                    userData.profilePic ||
                    userData.profile_pic ||
                    ANONYMOUS_AVATAR,
                  friends: userData.friends || [],
                  isVerified: Boolean(userData.isVerified),
                };
              }
          }
          return {
            ...req,
            status: statusRaw || "pending",
            user:
              user || {
                id: userId || toId,
                displayName: "User",
                profilePicUrl: ANONYMOUS_AVATAR,
              },
          };
        })
      );
      if (typeof window !== "undefined" && window.location?.search?.includes("debugRequests=1")) {
      }
      const normalized = formattedRequests.filter(Boolean);
      if (normalized.length > 0) {
        writeRequestsCache(currentUserId, normalized);
      }
      if (normalized.length === 0 && requestList.length > 0) {
        const fallback = requestList
          .map((req) => {
            const sender =
              (req?.fromUser && typeof req.fromUser === "object" ? req.fromUser : null) ||
              (req?.sender && typeof req.sender === "object" ? req.sender : null) ||
              (req?.requester && typeof req.requester === "object" ? req.requester : null) ||
              (req?.user && typeof req.user === "object" ? req.user : null) ||
              null;
            const senderId =
              resolveFriendId(sender) ||
              resolveFriendId(req?.senderId) ||
              resolveFriendId(req?.requesterId) ||
              resolveFriendId(req?.fromUserId) ||
              resolveFriendId(req?.userId) ||
              "";
            if (currentUser?.id && senderId && String(senderId) === String(currentUser.id)) {
              return null;
            }
            if (senderId && isUserBlocked(senderId)) {
              return null;
            }
            const displayName =
              sender?.displayName ||
              sender?.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") ||
              sender?.username ||
              "User";
            return {
              ...req,
              status: String(req?.status || "pending")
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "_"),
              user: sender
                ? {
                    id: senderId || sender?._id || sender?.id,
                    displayName,
                    profilePicUrl:
                      sender?.profilePicUrl ||
                      sender?.profilePic ||
                      sender?.profile_pic ||
                      ANONYMOUS_AVATAR,
                    friends: sender?.friends || [],
                    isVerified: Boolean(sender?.isVerified),
                  }
                : {
                    id: senderId,
                    displayName: "User",
                    profilePicUrl: ANONYMOUS_AVATAR,
                  },
            };
          })
          .filter(Boolean);
        if (fallback.length > 0) {
          writeRequestsCache(currentUserId, fallback);
        }
        return fallback;
      }
      return normalized;
    } catch (error) {
      console.error("Failed to load requests:", error);
      return [];
    }
  }, [cacheUser, getUserFromCache, isUserBlocked, currentUser]);

  const refreshLists = useCallback(async () => {
    const [contactsData, requestsData] = await Promise.all([
      loadContacts({ force: true }),
      loadRequests(),
    ]);
    setContacts(contactsData);
    setContactsLoading(false);
    setRequests(requestsData);
  }, [loadContacts, loadRequests]);

  const fetchChatMessages = useCallback(async (chatId) => {
    if (!chatId) return [];
    const isGroup = isGroupChatId(chatId);
    const data = isGroup
      ? await getGroupChatMessages(chatId, { last24h: true })
      : await getChatMessages(chatId);
    return data?.messages || [];
  }, []);

  const preloadChatPreviews = useCallback(
    async (friends) => {
      await Promise.all(
        friends.map(async (friend) => {
          if (!friend?.id || loadedChatsRef.current.has(friend.id)) return;
          try {
            const msgs = await fetchChatMessages(friend.id);
            const scopedMsgs = filterMessagesForChat(friend.id, msgs);
            mergeMessages(friend.id, scopedMsgs);
            loadedChatsRef.current.add(friend.id);
            if (scopedMsgs.length > 0) {
              const last = scopedMsgs[scopedMsgs.length - 1];
              updateChatMeta(friend.id, last, {
                unreadCount: resolveUnreadCount(scopedMsgs, friend.id),
              });
            }
          } catch (error) {
            console.error("Failed to load chat preview:", error);
          }
        })
      );
    },
    [fetchChatMessages, mergeMessages, updateChatMeta, resolveUnreadCount]
  );

  const loadMessages = useCallback(
    async (userId) => {
      if (!userId || loadedChatsRef.current.has(userId)) return;
      try {
        const msgs = await fetchChatMessages(userId);
        const scopedMsgs = filterMessagesForChat(userId, msgs);
        mergeMessages(userId, scopedMsgs);
        loadedChatsRef.current.add(userId);
        if (scopedMsgs.length > 0) {
          const last = scopedMsgs[scopedMsgs.length - 1];
          updateChatMeta(userId, last, {
            unreadCount: resolveUnreadCount(scopedMsgs, userId),
          });
        } else if (isGroupChatId(userId)) {
          syncChatMetaFromMessages(userId, []);
        }
      } catch (error) {
        console.error("Failed to load messages:", error);
      }
    },
    [fetchChatMessages, mergeMessages, updateChatMeta, resolveUnreadCount, syncChatMetaFromMessages]
  );

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const text = messageText.trim();
    if (!text || !activeChatId || !currentUser?.id) return;

    const socket = getSocket();
    const isGroupChat = String(activeChatId).startsWith("group:");
    if (!isGroupChat && !canChat(activeChatId)) {
      showToast({
        id: `chat-blocked-${activeChatId}`,
        title: "Chat unavailable",
        message: "You can only message friends.",
      });
      return;
    }
    const newMessage = {
      from: currentUser.id,
      to: activeChatId,
      text,
      createdAt: new Date().toISOString(),
      isGroup: isGroupChat,
      clientMessageId: `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pending: true,
    };

    mergeMessages(activeChatId, [newMessage]);
    updateChatMeta(activeChatId, newMessage);
    markChatRead(activeChatId);
    socket?.emit("chat-message", newMessage);
    sendChatMessage(newMessage)
      .then((response) => {
        const saved = response?.message || response;
        if (saved) {
          mergeMessages(activeChatId, [saved]);
          updateChatMeta(activeChatId, saved);
        }
      })
      .catch(() => {});
    setMessageText("");
    scrollToBottom();
  };

  const handleAcceptRequest = async (request) => {
    const requesterId =
      resolveFriendId(request?.requesterId) ||
      resolveFriendId(request?.senderId) ||
      resolveFriendId(request?.fromUserId) ||
      resolveFriendId(request?.requester) ||
      resolveFriendId(request?.sender) ||
      resolveFriendId(request?.fromUser) ||
      resolveFriendId(request?.user?.id) ||
      resolveFriendId(request?.user?._id) ||
      resolveFriendId(request?.userId);
    const requestId = request?._id || request?.id || request?.requestId;
    if (!requesterId && !requestId) return;

    try {
      await acceptFriend(request);
      setRequests((prev) =>
        prev.filter((req) => {
          const id = req?._id || req?.id || req?.requestId;
          if (requestId && id && String(id) === String(requestId)) return false;
          const fromId =
            resolveFriendId(req?.requesterId) ||
            resolveFriendId(req?.senderId) ||
            resolveFriendId(req?.fromUserId) ||
            resolveFriendId(req?.requester) ||
            resolveFriendId(req?.sender) ||
            resolveFriendId(req?.fromUser) ||
            resolveFriendId(req?.user?.id) ||
            resolveFriendId(req?.user?._id) ||
            resolveFriendId(req?.userId);
          return requesterId ? String(fromId) !== String(requesterId) : true;
        })
      );
      await refreshLists();
    } catch (error) {
      alert(error.message || "Failed to accept request");
    }
  };

  const handleIgnoreRequest = async (requesterId) => {
    setRequests((prev) =>
      prev.filter((req) => {
        const id =
          resolveFriendId(req?.requesterId) ||
          resolveFriendId(req?.senderId) ||
          resolveFriendId(req?.fromUserId) ||
          resolveFriendId(req?.requester) ||
          resolveFriendId(req?.sender) ||
          resolveFriendId(req?.fromUser) ||
          resolveFriendId(req?.user) ||
          resolveFriendId(req?.userId);
        return requesterId ? String(id) !== String(requesterId) : true;
      })
    );
    try {
      await rejectFriend(requesterId);
    } catch (error) {
      console.error("Failed to ignore request:", error);
    }
  };

  const handleSendFriendRequest = async () => {
    if (!activeChatId || friendRequestLoading) return;
    setFriendRequestLoading(true);
    try {
      await sendFriendRequest(activeChatId);
      showToast({
        id: `friend-request-${activeChatId}`,
        title: "Request sent",
        message: "Your friend request was sent.",
      });
    } catch (error) {
      showToast({
        id: `friend-request-failed-${activeChatId}`,
        title: "Request failed",
        message: error.message || "Unable to send request.",
      });
    } finally {
      setFriendRequestLoading(false);
    }
  };

  const handleOpenChat = useCallback(
    (chatId) => {
      setActiveChatId(chatId);
      if (String(chatId).startsWith("group:")) {
        setActiveTab("groups");
      } else {
        setActiveTab("contacts");
      }
      markChatRead(chatId);
      loadMessages(chatId);
      markMessagesSeen(chatId);
    },
    [setActiveChatId, markChatRead, loadMessages, markMessagesSeen]
  );

  const handleCloseChat = () => {
    setActiveChatId(null);
  };

  const showToast = useCallback(
    (toast) => {
      pushChatToast(toast);
    },
    [pushChatToast]
  );

  useEffect(() => {
    setChatViewActive(true);
    ensureSocketConnected();
    return () => setChatViewActive(false);
  }, [setChatViewActive]);

  // activeChatId is stored in global context now.

  useEffect(() => {
    let cancelled = false;
    const cached = readContactsCache(currentUser?.id);
    if (cached && cached.length) {
      setContacts(cached);
      setContactsLoading(false);
      cached.forEach((contact) => {
        updatePresence(contact.id, {
          isOnline: contact.isOnline || false,
          lastSeen: contact.lastSeen || "",
        });
      });
    } else {
      setContactsLoading(true);
    }

    const run = async () => {
      const requestsPromise = loadRequests().then((requestsData) => {
        if (cancelled) return [];
        setRequests(requestsData);
        return requestsData;
      });
      const contactsData = await loadContacts({ force: true });
      if (cancelled) return;
      setContacts(contactsData);
      setContactsLoading(false);
      contactsData.forEach((contact) => {
        updatePresence(contact.id, {
          isOnline: contact.isOnline || false,
          lastSeen: contact.lastSeen || "",
        });
      });
      await requestsPromise;
    };

    let idleId = null;
    if (cached && cached.length && typeof window !== "undefined") {
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(run, { timeout: 1200 });
      } else {
        idleId = window.setTimeout(run, 200);
      }
    } else {
      run();
    }
    return () => {
      cancelled = true;
      if (idleId && typeof window !== "undefined") {
        if ("cancelIdleCallback" in window) {
          window.cancelIdleCallback(idleId);
        } else {
          window.clearTimeout(idleId);
        }
      }
    };
  }, [friendIdsKey, loadContacts, loadRequests, updatePresence, currentUser?.id]);

  useEffect(() => {
    if (activeTab !== "requests") return;
    let cancelled = false;
    const refresh = async () => {
      const requestsData = await loadRequests();
      if (cancelled) return;
      setRequests(requestsData);
    };
    refresh();
    return () => {
      cancelled = true;
    };
  }, [activeTab, loadRequests]);

  useEffect(() => {
    if (contacts.length > 0) {
      preloadChatPreviews(contacts);
    }
  }, [contacts, preloadChatPreviews]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !currentUser?.id) return;

    const emitOnline = () => {
      socket.emit("user-online", { userId: currentUser.id, lastSeen: new Date().toISOString() });
    };
    const emitOffline = () => {
      socket.emit("user-offline", { userId: currentUser.id, lastSeen: new Date().toISOString() });
    };

    emitOnline();
    const heartbeat = setInterval(emitOnline, 25000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") emitOnline();
    };

    window.addEventListener("beforeunload", emitOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("beforeunload", emitOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      emitOffline();
    };
  }, [currentUser?.id]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handleOnline = (payload) => {
      const userId = payload?.userId || payload?.id;
      updatePresence(userId, { isOnline: true, lastSeen: payload?.lastSeen || "" });
    };
    const handleOffline = (payload) => {
      const userId = payload?.userId || payload?.id;
      updatePresence(userId, { isOnline: false, lastSeen: payload?.lastSeen || "" });
    };
    const handleSeen = (payload) => {
      const chatId = payload?.chatId;
      if (!chatId) return;
      setMessagesByChat((prev) => {
        const existing = prev[chatId] || [];
        if (existing.length === 0) return prev;
        const updated = existing.map((msg) => {
          if (msg.from !== currentUser?.id) return msg;
          if (msg.seenAt) return msg;
          return { ...msg, seenAt: payload.seenAt || new Date().toISOString() };
        });
        return { ...prev, [chatId]: updated };
      });
    };

    socket.off("user-online", handleOnline);
    socket.off("user-offline", handleOffline);
    socket.off("message-seen", handleSeen);
    socket.on("user-online", handleOnline);
    socket.on("user-offline", handleOffline);
    socket.on("message-seen", handleSeen);

    return () => {
      socket.off("user-online", handleOnline);
      socket.off("user-offline", handleOffline);
      socket.off("message-seen", handleSeen);
    };
  }, [currentUser?.id, updatePresence]);

  const groupContacts = useMemo(() => {
    const universityLabel = currentUser?.university || currentUser?.college || "";
    const universitySlug = encodeURIComponent(String(universityLabel).toLowerCase());
    return [
      universityLabel
        ? {
            id: `group:college:${universitySlug}`,
            displayName: `${universityLabel} Group`,
            profilePicUrl: "/incampus-icon.svg",
            isGroup: true,
            rank: 0,
            memberCount: currentUser?.collegeMemberCount || currentUser?.universityMemberCount,
          }
        : null,
      {
        id: "group:global",
        displayName: "InCampus Global",
        profilePicUrl: "/incampus-icon.svg",
        isGroup: true,
        rank: 1,
        memberCount: currentUser?.globalMemberCount,
      },
    ].filter(Boolean);
  }, [
    currentUser?.university,
    currentUser?.college,
    currentUser?.collegeMemberCount,
    currentUser?.universityMemberCount,
    currentUser?.globalMemberCount,
  ]);

  const groupList = useMemo(() => {
    return groupContacts.filter((group) => group?.id);
  }, [groupContacts]);

  const allContacts = useMemo(() => {
    return [...groupList, ...contacts];
  }, [groupList, contacts]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !currentUser?.id) return;

    const handleMessage = (payload) => {
      const msg = payload?.message || payload;
      if (!msg) return;
      const target = String(msg?.to || "");
      const isGroupMessage = target.startsWith("group:");
      const chatId = isGroupMessage ? target : msg.from === currentUser.id ? msg.to : msg.from;
      mergeMessages(chatId, [msg]);

      if (chatId !== activeChatRef.current) {
        if (!isMobile || chatSoundEnabled) {
          playNotificationSound();
        }
        if (navigator.vibrate) navigator.vibrate(40);
      } else {
        markChatRead(chatId);
        markMessagesSeen(chatId);
        scrollToBottom();
      }
    };

    socket.off("chat-message", handleMessage);
    socket.off("chat:newMessage", handleMessage);
    socket.off("chat:messageSent", handleMessage);
    socket.off("chat:newMessagePopup", handleMessage);
    socket.on("chat-message", handleMessage);
    socket.on("chat:newMessage", handleMessage);
    socket.on("chat:messageSent", handleMessage);
    socket.on("chat:newMessagePopup", handleMessage);

    return () => {
      socket.off("chat-message", handleMessage);
      socket.off("chat:newMessage", handleMessage);
      socket.off("chat:messageSent", handleMessage);
      socket.off("chat:newMessagePopup", handleMessage);
    };
  }, [
    currentUser?.id,
    markChatRead,
    markMessagesSeen,
    mergeMessages,
    playNotificationSound,
    chatSoundEnabled,
    isMobile,
    scrollToBottom,
  ]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleMessageExpired = (payload = {}) => {
      const message = payload?.message || payload;
      const rawChatId =
        payload.chatId ||
        payload.groupId ||
        payload.roomId ||
        message?.chatId ||
        message?.chat_id ||
        message?.to ||
        "";
      const chatId = String(rawChatId || "");
      if (!chatId) return;

      const expiredIds = new Set(
        []
          .concat(payload.messageIds || [])
          .concat(payload.messageId ? [payload.messageId] : [])
          .concat(message?._id ? [message._id] : [])
          .concat(message?.id ? [message.id] : [])
          .map((id) => String(id))
          .filter(Boolean)
      );

      let nextMeta = null;

      setMessagesByChat((prev) => {
        const existing = prev[chatId] || [];
        if (existing.length === 0) return prev;
        const now = Date.now();
        const filtered = existing.filter((msg) => {
          const msgId = msg._id || msg.id;
          if (msgId && expiredIds.has(String(msgId))) {
            return false;
          }
          return !isMessageExpired(msg, now);
        });
        if (filtered.length === existing.length) return prev;
        const index = ensureIndex(chatId);
        index.clear();
        filtered.forEach((msg) => index.add(messageKey(msg)));
        nextMeta = { chatId, messages: filtered };
        return { ...prev, [chatId]: filtered };
      });

      if (nextMeta) {
        syncChatMetaFromMessages(nextMeta.chatId, nextMeta.messages);
      }
    };

    socket.off("message-expired", handleMessageExpired);
    socket.on("message-expired", handleMessageExpired);

    return () => socket.off("message-expired", handleMessageExpired);
  }, [ensureIndex, syncChatMetaFromMessages]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handleFriendRequest = () => {
      loadRequests().then((data) => setRequests(data));
    };
    const handleFriendAccepted = () => {
      refreshLists();
    };
    socket.off("friend-requested", handleFriendRequest);
    socket.off("friend-request-received", handleFriendRequest);
    socket.off("friend_request_received", handleFriendRequest);
    socket.off("friend_request_accepted", refreshLists);
    socket.off("friend-accepted", handleFriendAccepted);
    socket.off("friend-removed", handleFriendAccepted);
    socket.off("friendRequestAccepted", handleFriendAccepted);
    socket.off("friendRequestsUpdated", handleFriendRequest);
    socket.off("friendsListUpdated", handleFriendAccepted);
    socket.off("chatUnlocked", handleFriendAccepted);
    socket.on("friend-requested", handleFriendRequest);
    socket.on("friend-request-received", handleFriendRequest);
    socket.on("friend_request_received", handleFriendRequest);
    socket.on("friend_request_accepted", refreshLists);
    socket.on("friend-accepted", handleFriendAccepted);
    socket.on("friend-removed", handleFriendAccepted);
    socket.on("friendRequestAccepted", handleFriendAccepted);
    socket.on("friendRequestsUpdated", handleFriendRequest);
    socket.on("friendsListUpdated", handleFriendAccepted);
    socket.on("chatUnlocked", handleFriendAccepted);
    return () => {
      socket.off("friend-requested", handleFriendRequest);
      socket.off("friend-request-received", handleFriendRequest);
      socket.off("friend_request_received", handleFriendRequest);
      socket.off("friend_request_accepted", refreshLists);
      socket.off("friend-accepted", handleFriendAccepted);
      socket.off("friend-removed", handleFriendAccepted);
      socket.off("friendRequestAccepted", handleFriendAccepted);
      socket.off("friendRequestsUpdated", handleFriendRequest);
      socket.off("friendsListUpdated", handleFriendAccepted);
      socket.off("chatUnlocked", handleFriendAccepted);
    };
  }, [loadRequests, refreshLists]);

  useEffect(() => {
    const interval = setInterval(() => {
      const pendingMeta = [];
      setMessagesByChat((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([chatId, messages]) => {
          const { messages: filtered, changed: hasChanged } = pruneGroupMessagesInState(
            chatId,
            messages
          );
          if (!hasChanged) return;
          changed = true;
          next[chatId] = filtered;
          pendingMeta.push({ chatId, messages: filtered });
        });
        return changed ? next : prev;
      });

      if (pendingMeta.length > 0) {
        pendingMeta.forEach(({ chatId, messages }) => {
          syncChatMetaFromMessages(chatId, messages);
        });
      }
      setNowTick(Date.now());
    }, 60000);

    return () => clearInterval(interval);
  }, [pruneGroupMessagesInState, syncChatMetaFromMessages]);

  const visibleMessages = useMemo(() => {
    const activeMessages = messagesByChat[activeChatId] || [];
    return activeMessages.filter((msg) => {
      const senderId = msg.from || msg.senderId || msg.userId;
      return !isMessageExpired(msg, nowTick) && !isUserBlocked(senderId);
    });
  }, [messagesByChat, activeChatId, isUserBlocked, nowTick]);
  const isActiveGroupChat = isGroupChatId(activeChatId);

  useEffect(() => {
    if (!isActiveGroupChat || !visibleMessages.length) return;
    const missing = new Set();
    visibleMessages.forEach((msg) => {
      const senderId = resolveMessageSenderId(msg);
      if (!senderId) return;
      if (currentUser?.id && String(senderId) === String(currentUser.id)) return;
      const embedded = resolveMessageSenderEntity(msg);
      if (embedded && typeof embedded === "object") return;
      if (getUserFromCache(senderId)) return;
      if (missingGroupSenderRef.current.has(senderId)) return;
      missing.add(senderId);
    });

    missing.forEach((senderId) => {
      missingGroupSenderRef.current.add(senderId);
      getUserById(senderId)
        .then((userData) => {
          if (userData) cacheUser(userData);
        })
        .catch(() => {})
        .finally(() => {
          missingGroupSenderRef.current.delete(senderId);
        });
    });
  }, [isActiveGroupChat, visibleMessages, currentUser?.id, getUserFromCache, cacheUser]);
  const activeChatUser = allContacts.find((c) => c.id === activeChatId);
  const isChatOpen = Boolean(activeChatId);
  const friendStatus = activeChatUser?.isGroup
    ? "friends"
    : getFriendStatus(activeChatUser?.id || activeChatId);
  const canChatActive = activeChatUser?.isGroup
    ? true
    : canChat(activeChatUser?.id || activeChatId);
  const activeChatName = resolveContactName(activeChatUser);
  const activeChatVerified = resolveContactVerified(activeChatUser);
  const activePresence = activeChatUser?.isGroup
    ? { isOnline: false, lastSeen: "" }
    : getPresence(activeChatUser?.id, activeChatUser);

  const contactsList = useMemo(() => {
    return [...contacts].sort((a, b) => {
      const aUnread = (chatMeta[a.id]?.unreadCount || 0) > 0;
      const bUnread = (chatMeta[b.id]?.unreadCount || 0) > 0;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      const aTime = new Date(chatMeta[a.id]?.lastMessageAt || 0).getTime();
      const bTime = new Date(chatMeta[b.id]?.lastMessageAt || 0).getTime();
      if (aTime !== bTime) return bTime - aTime;
      const aOnline = getPresence(a.id, a).isOnline;
      const bOnline = getPresence(b.id, b).isOnline;
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      return 0;
    });
  }, [contacts, chatMeta, getPresence]);

  const groupsSorted = useMemo(() => {
    return [...groupList].sort((a, b) => {
      const aUnread = (chatMeta[a.id]?.unreadCount || 0) > 0;
      const bUnread = (chatMeta[b.id]?.unreadCount || 0) > 0;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      const aTime = new Date(chatMeta[a.id]?.lastMessageAt || 0).getTime();
      const bTime = new Date(chatMeta[b.id]?.lastMessageAt || 0).getTime();
      if (aTime !== bTime) return bTime - aTime;
      return (a.rank || 0) - (b.rank || 0);
    });
  }, [groupList, chatMeta]);

  useEffect(() => {
    if (activeChatId) {
      scrollToBottom();
    }
  }, [activeChatId, visibleMessages.length, scrollToBottom]);



  return (
    <div
      id="chat-view"
      className={`h-[100dvh] min-h-0 flex flex-col ${
        isMobile && isChatOpen ? "pb-0" : "pb-24"
      } sm:pb-0`}
    >
      <Header />

      <div id="chat-body" className="flex-1 flex min-h-0">
        <div
          id="chat-sidebar"
          className={`relative z-30 w-full h-full sm:w-1/3 border-r border-white/10 bg-[#1a120b]/85 backdrop-blur-xl flex flex-col min-h-0 transition-transform duration-300 ease-out will-change-transform ${
            isMobile
              ? isChatOpen
                ? "-translate-x-full opacity-0 pointer-events-none"
                : "translate-x-0 opacity-100"
              : "translate-x-0 opacity-100"
          }`}
        >
          <div className="flex space-x-2 border-b border-white/10 p-4">
            {[
              { key: "contacts", label: "Contacts" },
              { key: "groups", label: "Groups" },
              { key: "requests", label: "Requests" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-3 py-2 text-[11px] font-semibold rounded-full transition-all duration-300 ease-out ${
                  activeTab === tab.key
                    ? "liquid-button text-[#faf0e6]"
                    : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div id="chat-list-container" className="flex-1 min-h-0 relative overflow-hidden">
            <div
              aria-hidden={activeTab !== "contacts"}
              className={`absolute inset-0 transition-all duration-200 ease-out ${
                activeTab === "contacts"
                  ? "opacity-100 translate-x-0 pointer-events-auto"
                  : "opacity-0 translate-x-2 pointer-events-none"
              }`}
            >
              <div
                className="h-full overflow-y-auto p-4 space-y-2"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {contactsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((item) => (
                      <div
                        key={`contact-skeleton-${item}`}
                        className="h-16 rounded-2xl bg-white/10 animate-pulse"
                      ></div>
                    ))}
                  </div>
                ) : contactsList.length === 0 ? (
                  <p className="text-center text-[#b9b4c7] mt-10">No contacts yet</p>
                ) : (
                  contactsList.map((contact, index) => {
                    const contactId =
                      contact.id ||
                      contact._id ||
                      contact.userId ||
                      contact.user_id ||
                      "";
                    const contactKey = contactId || `contact-${index}`;
                    const meta = chatMeta[contactId] || {};
                    const unreadCount = meta.unreadCount || 0;
                    const presence = getPresence(contactId, contact);
                    const isOnline = presence.isOnline;
                    const displayName = resolveContactName(contact);
                    const isVerified = resolveContactVerified(contact);
                    return (
                      <Motion.div
                        key={String(contactKey)}
                        onClick={() => contactId && handleOpenChat(contactId)}
                        className={`chat-list-item flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-colors border-l-4 ${
                          unreadCount > 0
                            ? "border-[#b9b4c7]/70 bg-white/10 shadow-[0_0_20px_rgba(185,180,199,0.25)]"
                            : "border-transparent hover:bg-white/5"
                        }`}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className="relative">
                          <img
                            src={contact.profilePicUrl || ANONYMOUS_AVATAR}
                            alt={displayName}
                            className="w-11 h-11 rounded-full object-cover"
                          />
                          {isOnline && (
                            <span className="absolute bottom-0 right-0 flex h-3 w-3 items-center justify-center">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40"></span>
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(34,197,94,0.75)]"></span>
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm text-[#faf0e6] truncate ${
                              unreadCount > 0 ? "font-bold" : "font-semibold"
                            }`}
                          >
                            <span className="inline-flex items-center gap-1">
                              {displayName}
                              {isVerified && <BlueTick className="text-[10px]" />}
                            </span>
                          </p>
                          <p
                            className={`text-xs truncate ${
                              unreadCount > 0 ? "text-[#faf0e6]" : "text-[#b9b4c7]"
                            }`}
                          >
                            {truncateMessage(resolveMessagePreview(meta.lastMessage)) ||
                              "Say hello to start chatting"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[10px] text-[#b9b4c7]">
                            {formatTime(meta.lastMessageAt)}
                          </span>
                          {unreadCount > 0 && (
                            <div className="flex items-center gap-1">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(34,197,94,0.75)]"></span>
                              <span className="neon-badge text-[10px] px-2 py-0.5 rounded-full">
                                {unreadCount}
                              </span>
                            </div>
                          )}
                        </div>
                      </Motion.div>
                    );
                  })
                )}
              </div>
            </div>

            <div
              aria-hidden={activeTab !== "groups"}
              className={`absolute inset-0 transition-all duration-200 ease-out ${
                activeTab === "groups"
                  ? "opacity-100 translate-x-0 pointer-events-auto"
                  : "opacity-0 translate-x-2 pointer-events-none"
              }`}
            >
              <div
                className="h-full overflow-y-auto p-4 space-y-2"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {groupsSorted.length === 0 ? (
                  <p className="text-center text-[#b9b4c7] mt-10">No groups available</p>
                ) : (
                  groupsSorted.map((group, index) => {
                    const groupId =
                      group.id ||
                      group._id ||
                      group.groupId ||
                      group.group_id ||
                      "";
                    const groupKey = groupId || `group-${index}`;
                    const meta = chatMeta[groupId] || {};
                    const unreadCount = meta.unreadCount || 0;
                    const memberCount = group.memberCount ?? group.members?.length;
                    return (
                      <Motion.div
                        key={String(groupKey)}
                        onClick={() => groupId && handleOpenChat(groupId)}
                        className={`chat-list-item flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-colors border-l-4 ${
                          unreadCount > 0
                            ? "border-[#b9b4c7]/70 bg-white/10 shadow-[0_0_20px_rgba(185,180,199,0.25)]"
                            : "border-transparent hover:bg-white/5"
                        }`}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className="relative">
                          <img
                            src={group.profilePicUrl || "/incampus-icon.svg"}
                            alt={group.displayName}
                            className="w-11 h-11 rounded-2xl object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm text-[#faf0e6] truncate ${
                              unreadCount > 0 ? "font-bold" : "font-semibold"
                            }`}
                          >
                            {group.displayName}
                          </p>
                          <p
                            className={`text-xs truncate ${
                              unreadCount > 0 ? "text-[#faf0e6]" : "text-[#b9b4c7]"
                            }`}
                          >
                            {truncateMessage(resolveMessagePreview(meta.lastMessage)) ||
                              "Campus group channel"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[10px] text-[#b9b4c7]">
                            {formatTime(meta.lastMessageAt)}
                          </span>
                          <span className="text-[10px] text-[#b9b4c7]">
                            {memberCount ? `${memberCount} members` : "Members"}
                          </span>
                          {unreadCount > 0 && (
                            <div className="flex items-center gap-1">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(34,197,94,0.75)]"></span>
                              <span className="neon-badge text-[10px] px-2 py-0.5 rounded-full">
                                {unreadCount}
                              </span>
                            </div>
                          )}
                        </div>
                      </Motion.div>
                    );
                  })
                )}
              </div>
            </div>

            <div
              aria-hidden={activeTab !== "requests"}
              className={`absolute inset-0 transition-all duration-200 ease-out ${
                activeTab === "requests"
                  ? "opacity-100 translate-x-0 pointer-events-auto"
                  : "opacity-0 translate-x-2 pointer-events-none"
              }`}
            >
              <div
                className="h-full overflow-y-auto p-4 space-y-2"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {requests.length === 0 ? (
                  <p className="text-center text-[#b9b4c7] mt-10">No pending requests</p>
                ) : (
                  requests.map((req, index) => {
                    const requestUser =
                      (req.user && typeof req.user === "object" ? req.user : null) ||
                      (req.fromUser && typeof req.fromUser === "object" ? req.fromUser : null) ||
                      (req.sender && typeof req.sender === "object" ? req.sender : null) ||
                      (req.requester && typeof req.requester === "object"
                        ? req.requester
                        : null) ||
                      null;
                    const requestDisplayName =
                      requestUser?.displayName ||
                      requestUser?.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") ||
                      requestUser?.username ||
                      "User";
                    const requestAvatar =
                      requestUser?.profilePicUrl ||
                      requestUser?.profilePic ||
                      requestUser?.profile_pic ||
                      ANONYMOUS_AVATAR;
                    const requesterId =
                      resolveFriendId(req?.requesterId) ||
                      resolveFriendId(req?.senderId) ||
                      resolveFriendId(req?.fromUserId) ||
                      resolveFriendId(req?.requester) ||
                      resolveFriendId(req?.sender) ||
                      resolveFriendId(req?.fromUser) ||
                      resolveFriendId(req?.user) ||
                      resolveFriendId(req?.userId);
                    const requestKey = req._id || req.id || requesterId || "req";
                    const requesterFriends = requestUser?.friends || [];
                    const mutualCount = requesterFriends.filter((id) =>
                      resolvedFriendIdSet.has(resolveFriendId(id))
                    ).length;
                    return (
                      <div
                        key={`${requestKey}-${index}`}
                        className="flex flex-col gap-3 p-3 rounded-2xl bg-white/5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center flex-grow gap-3">
                            <img
                              src={requestAvatar}
                              alt={requestDisplayName}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                            <div className="flex-grow">
                              <p className="font-semibold text-sm text-[#faf0e6]">
                                {requestDisplayName}
                              </p>
                              <p className="text-xs text-[#b9b4c7]">
                                {mutualCount > 0
                                  ? `${mutualCount} mutual friends`
                                  : "No mutual friends"}
                              </p>
                            </div>
                          </div>
                          <span className="text-[10px] text-[#b9b4c7]">
                            {req.type === "group" ? "Group Request" : "Friend Request"}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Motion.button
                            onClick={() => handleAcceptRequest(req)}
                            className="flex-1 liquid-button text-[#faf0e6] text-xs px-3 py-2 rounded-full"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            Accept
                          </Motion.button>
                          <Motion.button
                            onClick={() => handleIgnoreRequest(requesterId)}
                            className="flex-1 text-[#b9b4c7] text-xs px-3 py-2 rounded-full border border-white/10 hover:bg-white/10"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            Ignore
                          </Motion.button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
        <Motion.div
          initial={false}
          animate={
            isMobile
              ? { x: isChatOpen ? 0 : "100%", opacity: isChatOpen ? 1 : 0 }
              : { x: 0, opacity: 1 }
          }
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          id="active-chat-panel"
          className={`relative z-20 w-full sm:w-2/3 bg-[#1a120b]/85 backdrop-blur-xl flex flex-col min-h-0 overflow-hidden will-change-transform ${
            isMobile ? "fixed inset-0 z-50 h-[100dvh] max-h-[100dvh]" : ""
          } ${isMobile && !isChatOpen ? "pointer-events-none" : ""}`}
        >
          {isChatOpen ? (
            <>
              <div
                id="chat-header"
                className="sticky top-0 flex-shrink-0 z-30 h-16 px-4 py-2 border-b border-white/10 flex items-center justify-between bg-[#1a120b]/95 backdrop-blur-xl"
              >
                <div className="flex items-center gap-3">
                  {isMobile && (
                    <button
                      onClick={handleCloseChat}
                      className="text-[#b9b4c7] hover:text-[#faf0e6] transition-colors"
                    >
                      <i className="fa-solid fa-arrow-left"></i>
                    </button>
                  )}
                  <img
                    src={activeChatUser?.profilePicUrl || ANONYMOUS_AVATAR}
                    alt={activeChatName}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div>
                    <p className="font-semibold text-[#faf0e6] flex items-center gap-2">
                      <span className="flex items-center">
                        {activeChatName || "Chat"}
                        {activeChatVerified && <BlueTick className="text-[12px]" />}
                      </span>
                      {!activeChatUser?.isGroup && activePresence.isOnline && (
                        <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(34,197,94,0.75)]"></span>
                      )}
                    </p>
                    <p className="text-xs text-[#b9b4c7]">
                      {activeChatUser?.isGroup
                        ? "Group channel"
                        : activePresence.isOnline
                          ? "Online"
                          : formatLastSeen(activePresence.lastSeen)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isMobile && (
                    <button
                      type="button"
                      onClick={() => setChatSoundEnabled((prev) => !prev)}
                      className={`h-9 w-9 rounded-full border border-white/10 flex items-center justify-center text-sm transition-colors ${
                        chatSoundEnabled
                          ? "bg-white/10 text-[#faf0e6]"
                          : "bg-white/5 text-[#b9b4c7]"
                      }`}
                      title={chatSoundEnabled ? "Sound on" : "Sound off"}
                      aria-pressed={chatSoundEnabled}
                    >
                      <i
                        className={`fa-solid ${
                          chatSoundEnabled ? "fa-volume-high" : "fa-volume-xmark"
                        }`}
                      />
                    </button>
                  )}
                  {!activeChatUser?.isGroup && activeChatUser?.id && (
                    <button
                      onClick={handleBlockActiveUser}
                      className="text-xs text-rose-200 border border-rose-300/30 px-3 py-1 rounded-full hover:bg-rose-300/10"
                    >
                      <i className="fa-solid fa-ban mr-1"></i>
                      Block
                    </button>
                  )}
                </div>
              </div>

              <div
                id="chat-messages"
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] space-y-4"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {visibleMessages.length === 0 ? (
                  <p className="text-center text-[#b9b4c7] mt-10">
                    No messages yet. Say hi!
                  </p>
                ) : (
                  visibleMessages.map((msg) => {
                    const isMine = msg.from === currentUser?.id;
                    const isSharedPost =
                      msg.messageType === "shared_post" || msg.type === "shared_post";
                    const previewText = resolveMessagePreview(msg);
                    const previewThumb = msg.postThumbnail;
                    const senderInfo =
                      !isMine && isActiveGroupChat ? resolveMessageSender(msg) : null;
                    return (
                      <Motion.div
                        key={messageKey(msg)}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`message-row ${isMine ? "mine" : "theirs"}`}
                      >
                        <div className="message-bubble">
                          {senderInfo && (
                            <div className="mb-2 flex items-center gap-2">
                              <img
                                src={senderInfo.avatar || ANONYMOUS_AVATAR}
                                alt={senderInfo.name}
                                className="h-6 w-6 rounded-full object-cover border border-white/10"
                              />
                              <span className="text-[11px] font-semibold text-[#faf0e6] flex items-center gap-1">
                                {senderInfo.name}
                                {senderInfo.isVerified && (
                                  <BlueTick className="text-[10px]" />
                                )}
                              </span>
                            </div>
                          )}
                          {isSharedPost ? (
                            <button
                              type="button"
                              onClick={() => handleOpenSharedPost(msg)}
                              className="w-full text-left space-y-2"
                            >
                              <div className="rounded-xl overflow-hidden border border-white/10 bg-black/30">
                                {previewThumb ? (
                                  <img
                                    src={previewThumb}
                                    alt="Shared post"
                                    className="w-full h-32 object-cover"
                                  />
                                ) : (
                                  <div className="h-24 w-full bg-white/5 flex items-center justify-center text-xs text-[#b9b4c7]">
                                    Post preview
                                  </div>
                                )}
                                <div className="p-3">
                                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                                    Shared post
                                  </p>
                                  <p className="text-sm text-[#faf0e6] line-clamp-2">
                                    {previewText}
                                  </p>
                                </div>
                              </div>
                            </button>
                          ) : (
                            <span className="text-sm">{msg.text}</span>
                          )}
                          <span className="message-time flex items-center gap-1">
                            {formatTime(msg.createdAt)}
                            {isMine && !activeChatUser?.isGroup && (
                              <span
                                className={`text-[10px] ${
                                  msg.seenAt
                                    ? "text-[#b9b4c7]"
                                    : msg.deliveredAt
                                      ? "text-[#b9b4c7]/80"
                                      : "text-[#b9b4c7]/60"
                                }`}
                              >
                                {msg.seenAt
                                  ? "Seen"
                                  : msg.deliveredAt
                                    ? "Delivered"
                                    : "Sent"}
                              </span>
                            )}
                            {!isMine && (
                              <button
                                type="button"
                                onClick={() => handleReportMessage(msg)}
                                className="text-amber-300 hover:text-amber-200 text-[10px]"
                                title="Report message"
                              >
                                <i className="fa-solid fa-flag"></i>
                              </button>
                            )}
                          </span>
                        </div>
                      </Motion.div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <div
                id="chat-input-bar"
                className="flex-shrink-0 z-20 px-4 py-3 min-h-[64px] border-t border-white/10 bg-[#1a120b]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
              >
                {!canChatActive && !activeChatUser?.isGroup && activeChatId && (
                  <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-[#b9b4c7]">
                    <span>Only friends can message.</span>
                    {friendStatus === "none" ? (
                      <button
                        type="button"
                        onClick={handleSendFriendRequest}
                        disabled={friendRequestLoading}
                        className="rounded-full bg-[#b9b4c7]/20 px-3 py-1 text-[#faf0e6] hover:bg-[#b9b4c7]/30 transition-colors disabled:opacity-60"
                      >
                        {friendRequestLoading ? "Sending..." : "Send Request"}
                      </button>
                    ) : friendStatus === "pending_sent" ? (
                      <span className="text-[#b9b4c7]">Request sent</span>
                    ) : friendStatus === "pending_received" ? (
                      <span className="text-[#b9b4c7]">Request pending</span>
                    ) : friendStatus === "blocked" ? (
                      <span className="text-[#b9b4c7]">Blocked</span>
                    ) : null}
                  </div>
                )}
                <form
                  id="chat-input-row"
                  onSubmit={handleSendMessage}
                  className="flex items-center space-x-3"
                >
                  <input
                    id="chat-input-field"
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder={
                      canChatActive ? "Type a message..." : "Only friends can message"
                    }
                    disabled={!canChatActive}
                    className={`flex-grow px-4 py-2 rounded-full glass-input text-sm ${
                      canChatActive ? "" : "opacity-60 cursor-not-allowed"
                    }`}
                  />
                  <Motion.button
                    type="submit"
                    disabled={!canChatActive}
                    className={`liquid-button text-[#faf0e6] rounded-full h-10 w-10 flex items-center justify-center ${
                      canChatActive ? "" : "opacity-60 cursor-not-allowed"
                    }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <i className="fa-solid fa-paper-plane"></i>
                  </Motion.button>
                </form>
              </div>
            </>
          ) : (
            !isMobile && (
              <div className="w-full h-full flex items-center justify-center text-[#b9b4c7]">
                Select a chat to start messaging
              </div>
            )
          )}
        </Motion.div>
      </div>

      <Motion.button
        type="button"
        onClick={() => setShowCreateModal(true)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={`hidden sm:flex fixed bottom-6 right-6 z-40 create-fab liquid-button h-14 w-14 items-center justify-center text-[#faf0e6] ${
          showCreateModal ? "opacity-0 pointer-events-none" : ""
        }`}
        aria-label="Create post"
      >
        <i className="fa-solid fa-plus text-lg"></i>
      </Motion.button>
      <CreatePostModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      {sharedPost && (
        <PostModal
          post={sharedPost}
          isOpen={!!sharedPost}
          onClose={() => setSharedPost(null)}
          onDelete={() => {}}
        />
      )}
      <ReportModal
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmit={submitMessageReport}
        title="Report Message"
      />
      <BottomNav
        hidden={false}
        onCreate={() => setShowCreateModal(true)}
        overlay={showCreateModal}
      />
    </div>
  );
}
