import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/authContext";
import { useApp } from "../context/useApp";
import {
  getChatMessages,
  getPendingRequests,
  acceptFriendRequest,
  ignoreFriendRequest,
  getUserById,
  sendChatMessage,
  markChatSeen,
  reportMessage,
  blockUser,
} from "../services/api";
import { getSocket } from "../services/socket";
import Header from "../components/common/Header";
import BottomNav from "../components/common/BottomNav";
import CreatePostModal from "../components/feed/CreatePostModal";
import ReportModal from "../components/moderation/ReportModal";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const DAY_MS = 24 * 60 * 60 * 1000;

const isAnonymousUser = (userData) =>
  Boolean(
    userData?.isAnonymous ||
      userData?.anonymous ||
      userData?.isAnonymousUser ||
      userData?.isAnonymousProfile ||
      userData?.displayName === "Anonymous"
  );

const messageKey = (msg) => msg._id || `${msg.from}-${msg.to}-${msg.createdAt}-${msg.text}`;

const getMessageTimestamp = (msg) => {
  const raw = msg?.createdAt || msg?.created_at || msg?.timestamp;
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : time;
};

const isMessageRecent = (msg) => {
  const time = getMessageTimestamp(msg);
  if (time === null) return false;
  return Date.now() - time <= DAY_MS;
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

  const truncateMessage = (text = "") => {
    if (!text) return "";
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  };

export default function Chat() {
  const { currentUser } = useAuth();
  const { cacheUser, getUserFromCache, isUserBlocked, addBlockedUser } = useApp();
  const [activeTab, setActiveTab] = useState("contacts");
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messagesByChat, setMessagesByChat] = useState({});
  const [chatMeta, setChatMeta] = useState({});
  const [messageText, setMessageText] = useState("");
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [presenceMap, setPresenceMap] = useState({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  const messagesEndRef = useRef(null);
  const activeChatRef = useRef(activeChatId);
  const messageIndexRef = useRef({});
  const loadedChatsRef = useRef(new Set());

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
      setShowChatPanel(false);
      alert("User blocked.");
    } catch (error) {
      alert(error.message || "Failed to block user");
    }
  };

  useEffect(() => {
    activeChatRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    const originalOverflow = document.body.style.overflow;
    if (showChatPanel) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = originalOverflow || "";
    }
    return () => {
      document.body.style.overflow = originalOverflow || "";
    };
  }, [isMobile, showChatPanel]);

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
        const existing = prev[chatId] || [];
        const recentExisting = existing.filter(isMessageRecent);
        const recentIncoming = incomingMessages.filter(isMessageRecent);
        const index = ensureIndex(chatId);
        index.clear();
        recentExisting.forEach((msg) => index.add(messageKey(msg)));
        const merged = [...recentExisting];

        recentIncoming.forEach((msg) => {
          const key = messageKey(msg);
          const recentDuplicate = merged.slice(-5).some((existingMsg) => {
            if (existingMsg.from !== msg.from || existingMsg.to !== msg.to) return false;
            if (existingMsg.text !== msg.text) return false;
            const existingTime = new Date(existingMsg.createdAt).getTime();
            const incomingTime = new Date(msg.createdAt).getTime();
            return Math.abs(existingTime - incomingTime) < 5000;
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
    [ensureIndex]
  );

  const markMessagesSeen = useCallback(
    (chatId) => {
      if (!chatId || String(chatId).startsWith("group:")) return;
      const seenAt = new Date().toISOString();
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
      const socket = getSocket();
      if (socket && currentUser?.id) {
        socket.emit("message-seen", {
          chatId,
          userId: currentUser.id,
          seenAt,
        });
      }
      markChatSeen({ chatId, userId: currentUser?.id, seenAt }).catch(() => {});
    },
    [currentUser, setMessagesByChat]
  );

  const updateChatMeta = useCallback((chatId, message, { incrementUnread, unreadCount } = {}) => {
    if (!chatId || !message) return;
    if (!isMessageRecent(message)) return;
    setChatMeta((prev) => {
      const current = prev[chatId] || { unreadCount: 0 };
      const resolvedUnread =
        typeof unreadCount === "number"
          ? unreadCount
          : incrementUnread
            ? (current.unreadCount || 0) + 1
            : current.unreadCount || 0;
      return {
        ...prev,
        [chatId]: {
          ...current,
          lastMessage: message,
          lastMessageAt: message.createdAt,
          unreadCount: resolvedUnread,
        },
      };
    });
  }, []);

  const markChatRead = useCallback((chatId) => {
    if (!chatId) return;
    setChatMeta((prev) => ({
      ...prev,
      [chatId]: {
        ...prev[chatId],
        unreadCount: 0,
      },
    }));
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadContacts = useCallback(async () => {
    if (!currentUser?.friends) return [];
    const friendsData = await Promise.all(
      currentUser.friends.map(async (friendId) => {
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
            };
          }
        }
        return user;
      })
    );
    return friendsData.filter(Boolean);
  }, [cacheUser, currentUser, getUserFromCache, isUserBlocked]);

  const resolveUnreadCount = useCallback(
    (messages = [], chatId) => {
      if (!currentUser?.id || !Array.isArray(messages)) return 0;
      if (chatId === activeChatRef.current) return 0;
      return messages.filter((msg) => {
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

  const loadRequests = useCallback(async () => {
    try {
      const requestsData = await getPendingRequests();
      const formattedRequests = await Promise.all(
        requestsData.map(async (req) => {
          const userId = req.fromUserId?._id || req.fromUserId;
          if (isUserBlocked(userId)) {
            return null;
          }
          let user = getUserFromCache(userId);
          if (!user && userId) {
            const userData = await getUserById(userId);
              if (userData) {
                cacheUser(userData);
                user = {
                  id: userData._id,
                  displayName:
                    userData.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") ||
                    "User",
                  profilePicUrl: userData.profilePicUrl || ANONYMOUS_AVATAR,
                  friends: userData.friends || [],
                };
              }
          }
          return {
            ...req,
            user:
              user || {
                id: userId,
                displayName: "User",
                profilePicUrl: ANONYMOUS_AVATAR,
              },
          };
        })
      );
      return formattedRequests.filter(Boolean);
    } catch (error) {
      console.error("Failed to load requests:", error);
      return [];
    }
  }, [cacheUser, getUserFromCache, isUserBlocked]);

  const refreshLists = useCallback(async () => {
    const [contactsData, requestsData] = await Promise.all([
      loadContacts(),
      loadRequests(),
    ]);
    setContacts(contactsData);
    setRequests(requestsData);
  }, [loadContacts, loadRequests]);

  const preloadChatPreviews = useCallback(
    async (friends) => {
      await Promise.all(
        friends.map(async (friend) => {
          if (!friend?.id || loadedChatsRef.current.has(friend.id)) return;
          try {
            const data = await getChatMessages(friend.id);
            const msgs = data.messages || [];
            const recentMsgs = msgs.filter(isMessageRecent);
            mergeMessages(friend.id, recentMsgs);
            loadedChatsRef.current.add(friend.id);
            if (recentMsgs.length > 0) {
              const last = recentMsgs[recentMsgs.length - 1];
              updateChatMeta(friend.id, last, {
                unreadCount: resolveUnreadCount(recentMsgs, friend.id),
              });
            }
          } catch (error) {
            console.error("Failed to load chat preview:", error);
          }
        })
      );
    },
    [mergeMessages, updateChatMeta, resolveUnreadCount]
  );

  const loadMessages = useCallback(
    async (userId) => {
      if (!userId || loadedChatsRef.current.has(userId)) return;
      try {
        const data = await getChatMessages(userId);
        const msgs = data.messages || [];
        const recentMsgs = msgs.filter(isMessageRecent);
        mergeMessages(userId, recentMsgs);
        loadedChatsRef.current.add(userId);
        if (recentMsgs.length > 0) {
          const last = recentMsgs[recentMsgs.length - 1];
          updateChatMeta(userId, last, {
            unreadCount: resolveUnreadCount(recentMsgs, userId),
          });
        }
      } catch (error) {
        console.error("Failed to load messages:", error);
      }
    },
    [mergeMessages, updateChatMeta, resolveUnreadCount]
  );

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const text = messageText.trim();
    if (!text || !activeChatId || !currentUser?.id) return;

    const socket = getSocket();
    const isGroupChat = String(activeChatId).startsWith("group:");
    const newMessage = {
      from: currentUser.id,
      to: activeChatId,
      text,
      createdAt: new Date().toISOString(),
      isGroup: isGroupChat,
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

  const handleAcceptRequest = async (requesterId) => {
    try {
      await acceptFriendRequest(requesterId);
      await refreshLists();
    } catch (error) {
      alert(error.message || "Failed to accept request");
    }
  };

  const handleIgnoreRequest = async (requesterId) => {
    setRequests((prev) => prev.filter((req) => (req.user?.id || req.fromUserId) !== requesterId));
    try {
      await ignoreFriendRequest(requesterId);
    } catch (error) {
      console.error("Failed to ignore request:", error);
    }
  };

  const handleOpenChat = (chatId) => {
    setActiveChatId(chatId);
    setShowChatPanel(true);
    if (String(chatId).startsWith("group:")) {
      setActiveTab("groups");
    } else {
      setActiveTab("contacts");
    }
    markChatRead(chatId);
    loadMessages(chatId);
    markMessagesSeen(chatId);
  };

  const handleCloseChat = () => {
    setShowChatPanel(false);
    setActiveChatId(null);
  };

  const showToast = useCallback((toast) => {
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 3000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [contactsData, requestsData] = await Promise.all([
        loadContacts(),
        loadRequests(),
      ]);
      if (cancelled) return;
      setContacts(contactsData);
      contactsData.forEach((contact) => {
        updatePresence(contact.id, {
          isOnline: contact.isOnline || false,
          lastSeen: contact.lastSeen || "",
        });
      });
      setRequests(requestsData);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [loadContacts, loadRequests, updatePresence]);

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

    const handleMessage = (msg) => {
      const target = String(msg?.to || "");
      const isGroupMessage = target.startsWith("group:");
      const chatId = isGroupMessage ? target : msg.from === currentUser.id ? msg.to : msg.from;
      const senderId = msg.from === currentUser.id ? msg.to : msg.from;
      const sender =
        allContacts.find((contact) => contact.id === chatId) ||
        contacts.find((contact) => contact.id === senderId);
      const senderName = sender?.displayName || "New message";
      mergeMessages(chatId, [msg]);
      updateChatMeta(chatId, msg, {
        incrementUnread: chatId !== activeChatRef.current,
      });

      if (chatId !== activeChatRef.current) {
        showToast({
          id: `${chatId}-${msg.createdAt}`,
          chatId,
          title: `New message from ${senderName}`,
          message: truncateMessage(msg.text),
        });
        playNotificationSound();
        if (navigator.vibrate) navigator.vibrate(40);
      } else {
        markChatRead(chatId);
        markMessagesSeen(chatId);
        scrollToBottom();
      }
    };

    socket.off("chat-message", handleMessage);
    socket.on("chat-message", handleMessage);

    return () => socket.off("chat-message", handleMessage);
  }, [
    allContacts,
    contacts,
    currentUser?.id,
    markChatRead,
    markMessagesSeen,
    mergeMessages,
    playNotificationSound,
    scrollToBottom,
    showToast,
    updateChatMeta,
  ]);

  const visibleMessages = useMemo(() => {
    const activeMessages = messagesByChat[activeChatId] || [];
    return activeMessages.filter((msg) => {
      const senderId = msg.from || msg.senderId || msg.userId;
      return isMessageRecent(msg) && !isUserBlocked(senderId);
    });
  }, [messagesByChat, activeChatId, isUserBlocked]);
  const activeChatUser = allContacts.find((c) => c.id === activeChatId);
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
      return bTime - aTime;
    });
  }, [contacts, chatMeta]);

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
    <div id="chat-view" className="min-h-screen flex flex-col pb-24 sm:pb-0">
      <Header />

      <div className="flex-1 flex overflow-hidden">
        <div
          id="chat-sidebar"
          className={`w-full sm:w-1/3 border-r border-white/10 bg-[#1a120b]/85 backdrop-blur-xl flex flex-col ${
            isMobile && showChatPanel ? "hidden" : "flex"
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

          <div id="chat-list-container" className="flex-grow overflow-y-auto p-4 space-y-2">
            {activeTab === "contacts" &&
              (contactsList.length === 0 ? (
                <p className="text-center text-[#b9b4c7] mt-10">No contacts yet</p>
              ) : (
                contactsList.map((contact) => {
                  const meta = chatMeta[contact.id] || {};
                  const unreadCount = meta.unreadCount || 0;
                  const presence = getPresence(contact.id, contact);
                  const isOnline = presence.isOnline;
                  return (
                    <Motion.div
                      key={contact.id}
                      onClick={() => handleOpenChat(contact.id)}
                      className={`flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-colors border-l-4 ${
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
                          alt={contact.displayName}
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
                          {contact.displayName}
                        </p>
                        <p
                          className={`text-xs truncate ${
                            unreadCount > 0 ? "text-[#faf0e6]" : "text-[#b9b4c7]"
                          }`}
                        >
                          {truncateMessage(meta.lastMessage?.text) ||
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
              ))}

            {activeTab === "groups" &&
              (groupsSorted.length === 0 ? (
                <p className="text-center text-[#b9b4c7] mt-10">No groups available</p>
              ) : (
                groupsSorted.map((group) => {
                  const meta = chatMeta[group.id] || {};
                  const unreadCount = meta.unreadCount || 0;
                  const memberCount = group.memberCount ?? group.members?.length;
                  return (
                    <Motion.div
                      key={group.id}
                      onClick={() => handleOpenChat(group.id)}
                      className={`flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-colors border-l-4 ${
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
                          {truncateMessage(meta.lastMessage?.text) || "Campus group channel"}
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
              ))}

            {activeTab === "requests" &&
              (requests.length === 0 ? (
                <p className="text-center text-[#b9b4c7] mt-10">No pending requests</p>
              ) : (
                requests.map((req, index) => {
                  const requesterId = req.user?.id || req.fromUserId;
                  const requestKey = req._id || req.id || requesterId || "req";
                  const requesterFriends = req.user?.friends || [];
                  const mutualCount = (currentUser?.friends || []).filter((id) =>
                    requesterFriends.includes(id)
                  ).length;
                  return (
                    <div
                      key={`${requestKey}-${index}`}
                      className="flex flex-col gap-3 p-3 rounded-2xl bg-white/5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center flex-grow gap-3">
                          <img
                            src={req.user?.profilePicUrl || ANONYMOUS_AVATAR}
                            alt={req.user?.displayName}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                          <div className="flex-grow">
                            <p className="font-semibold text-sm text-[#faf0e6]">
                              {req.user?.displayName || "User"}
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
                          onClick={() => handleAcceptRequest(requesterId)}
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
              ))}
          </div>
        </div>

        <AnimatePresence>
          {(showChatPanel || !isMobile) && activeChatId && (
            <Motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              id="active-chat-panel"
              className={`w-full sm:w-2/3 bg-[#1a120b]/85 backdrop-blur-xl flex flex-col min-h-0 overflow-hidden ${
                isMobile ? "fixed inset-0 z-50 h-[100dvh] max-h-[100dvh]" : ""
              }`}
            >
              <div
                id="chat-header"
                className="flex-shrink-0 z-20 p-4 min-h-[64px] border-b border-white/10 flex items-center justify-between bg-[#1a120b]/95 backdrop-blur-xl"
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
                    alt={activeChatUser?.displayName}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div>
                    <p className="font-semibold text-[#faf0e6] flex items-center gap-2">
                      {activeChatUser?.displayName || "Chat"}
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
                    return (
                      <Motion.div
                        key={messageKey(msg)}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`message-row ${isMine ? "mine" : "theirs"}`}
                      >
                        <div className="message-bubble">
                          <span className="text-sm">{msg.text}</span>
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

              <div className="flex-shrink-0 z-20 p-4 border-t border-white/10 bg-[#1a120b]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
                <form onSubmit={handleSendMessage} className="flex space-x-3">
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-grow px-4 py-2 rounded-full glass-input text-sm"
                  />
                  <Motion.button
                    type="submit"
                    className="liquid-button text-[#faf0e6] rounded-full h-10 w-10 flex items-center justify-center"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <i className="fa-solid fa-paper-plane"></i>
                  </Motion.button>
                </form>
              </div>
            </Motion.div>
          )}
        </AnimatePresence>

        {!activeChatId && !isMobile && (
          <div className="w-2/3 flex items-center justify-center bg-[#1a120b]/85 backdrop-blur-xl">
            <p className="text-[#b9b4c7]">Select a chat to start messaging</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {toasts.length > 0 && (
          <div className="fixed top-20 right-4 left-4 sm:left-auto z-50 space-y-3">
            {toasts.map((toast) => (
              <Motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="toast-card rounded-2xl px-4 py-3 text-sm text-[#faf0e6] shadow-lg cursor-pointer"
                onClick={() => {
                  if (toast.chatId) handleOpenChat(toast.chatId);
                }}
              >
                <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">
                  {toast.title}
                </p>
                <p className="mt-1">{toast.message}</p>
              </Motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

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
      <ReportModal
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmit={submitMessageReport}
        title="Report Message"
      />
      <BottomNav
        hidden={isMobile && activeChatId}
        onCreate={() => setShowCreateModal(true)}
        overlay={showCreateModal}
      />
    </div>
  );
}
