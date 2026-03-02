import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../context/authContext";
import { useApp } from "../context/useApp";
import { buildUserPreview, normalizeUserId } from "../utils/userProfile";
import {
  getChatMessages,
  getGroupChatMessages,
  getChatGroups,
  getPublicGroups,
  getPendingRequests,
  getUserById,
  sendChatMessage,
  markChatSeen,
  reportMessage,
  blockUser,
  requestGroupJoin,
  approveGroupJoin,
  rejectGroupJoin,
  deleteChatMessage,
} from "../services/api";
import { getSocket, ensureSocketConnected, joinSocket } from "../services/socket";
import Header from "../components/common/Header";
import BottomNav from "../components/common/BottomNav";
import CreatePostModal from "../components/feed/CreatePostModal";
import ReportModal from "../components/moderation/ReportModal";
import PostModal from "../components/profile/PostModal";
import BlueTick from "../components/common/BlueTick";
import CreateGroupModal from "../components/chat/CreateGroupModal";
import GroupProfileModal from "../components/chat/GroupProfileModal";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const DEFAULT_GROUP_AVATAR = "/incampus-icon.svg";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONTACTS_CACHE_KEY = "incampus:chat:contacts";
const CONTACTS_CACHE_TTL = 5 * 60 * 1000;
const REQUESTS_CACHE_KEY = "incampus:chat:requests";
const REQUESTS_CACHE_TTL = 2 * 60 * 1000;
const MESSAGE_CACHE_PREFIX = "incampus:chat:messages:";
const MESSAGE_CACHE_TTL = 5 * 60 * 1000;
const MESSAGE_CACHE_LIMIT = 50;
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

const readMessagesCache = (userId, chatId) => {
  if (!userId || !chatId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${MESSAGE_CACHE_PREFIX}${userId}:${chatId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - parsed.ts > MESSAGE_CACHE_TTL) return null;
    return Array.isArray(parsed.messages) ? parsed.messages : null;
  } catch {
    return null;
  }
};

const writeMessagesCache = (userId, chatId, messages) => {
  if (!userId || !chatId || typeof window === "undefined") return;
  try {
    const trimmed = Array.isArray(messages)
      ? messages.slice(-MESSAGE_CACHE_LIMIT)
      : [];
    localStorage.setItem(
      `${MESSAGE_CACHE_PREFIX}${userId}:${chatId}`,
      JSON.stringify({ ts: Date.now(), messages: trimmed })
    );
  } catch {
    // Ignore storage errors.
  }
};

const isGroupChatId = (chatId) => String(chatId || "").startsWith("group:");

const resolveGroupIdValue = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return String(
      value._id || value.id || value.groupId || value.group_id || value.group || ""
    );
  }
  return "";
};

const ensureGroupRoomId = (value) => {
  const raw = resolveGroupIdValue(value);
  if (!raw) return "";
  return raw.startsWith("group:") ? raw : `group:${raw}`;
};

const resolveGroupApiId = (group) => {
  if (!group) return "";
  if (group.apiId) return String(group.apiId);
  if (typeof group === "object") {
    const candidate = group._id || group.id || group.groupId || group.group_id;
    if (candidate) return String(candidate);
  }
  if (typeof group === "string") {
    if (!group.startsWith("group:")) return group;
    const stripped = group.slice(6);
    if (
      stripped.startsWith("college:") ||
      stripped.startsWith("global") ||
      stripped.startsWith("campus:")
    ) {
      return "";
    }
    return stripped;
  }
  return "";
};

const resolveGroupRequestMeta = (request) => {
  if (!request || typeof request !== "object") {
    return { isGroup: false, groupId: "", groupApiId: "", groupName: "" };
  }
  const typeRaw = String(
    request.type || request.requestType || request.kind || request.category || ""
  )
    .trim()
    .toLowerCase();
  const groupObject =
    request.group && typeof request.group === "object" ? request.group : null;
  const groupCandidate =
    request.groupId ||
    request.group_id ||
    request.group ||
    request.groupRef ||
    request.groupRefId ||
    request.groupIdRef ||
    request.chatId ||
    request.chat_id ||
    request.roomId ||
    groupObject ||
    "";
  const groupId = groupCandidate ? ensureGroupRoomId(groupCandidate) : "";
  const groupApiId = groupCandidate ? resolveGroupApiId(groupCandidate) : "";
  const groupName =
    groupObject?.name ||
    groupObject?.title ||
    request.groupName ||
    request.group_title ||
    request.communityName ||
    "";
  const isGroup =
    typeRaw.includes("group") ||
    typeRaw.includes("community") ||
    Boolean(groupApiId) ||
    (groupId && groupId.startsWith("group:"));
  return { isGroup, groupId, groupApiId, groupName };
};

const normalizeGroupItem = (group, currentUserId, fallbackRank = 10) => {
  if (!group) return null;
  const chatId = ensureGroupRoomId(group);
  if (!chatId) return null;
  const apiId = resolveGroupApiId(group);
  const isSystemGroup = Boolean(group?.isSystemGroup) || !apiId;
  const resolveMemberId = (value) => {
    if (!value) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (typeof value === "object") {
      return String(
        value._id || value.id || value.userId || value.user_id || value.memberId || ""
      );
    }
    return "";
  };
  const displayName =
    group.displayName ||
    group.name ||
    group.title ||
    group.groupName ||
    group.communityName ||
    "Group";
  const membersRaw = group.members || group.memberIds || group.member_ids || [];
  const adminsRaw = group.admins || group.adminIds || group.admin_ids || [];
  const requestsRaw = group.joinRequests || group.join_requests || [];
  const memberIds = Array.isArray(membersRaw)
    ? membersRaw.map(resolveMemberId).filter(Boolean)
    : [];
  const adminIds = Array.isArray(adminsRaw)
    ? adminsRaw.map(resolveMemberId).filter(Boolean)
    : [];
  const requestIds = Array.isArray(requestsRaw)
    ? requestsRaw.map(resolveMemberId).filter(Boolean)
    : [];
  const isMember =
    group.isMember ??
    (currentUserId
      ? memberIds.some((id) => String(id) === String(currentUserId)) || isSystemGroup
      : isSystemGroup);
  const isAdmin =
    group.isAdmin ??
    (currentUserId
      ? adminIds.some((id) => String(id) === String(currentUserId)) ||
        String(resolveMemberId(group.createdBy || group.created_by)) ===
          String(currentUserId)
      : false);
  const isPending =
    group.isPending ??
    (currentUserId
      ? requestIds.some((id) => String(id) === String(currentUserId))
      : false);
  const visibility =
    group.visibility ||
    (group.isPrivate ? "private" : group.isPublic ? "public" : "public");
  return {
    id: chatId,
    apiId,
    displayName,
    profilePicUrl:
      group.profilePicUrl ||
      group.profileImage ||
      group.avatarUrl ||
      group.avatar ||
      group.image ||
      DEFAULT_GROUP_AVATAR,
    isGroup: true,
    isSystemGroup,
    isMember,
    isAdmin,
    isPending,
    visibility,
    memberCount:
      group.memberCount ??
      group.membersCount ??
      group.member_count ??
      (Array.isArray(group.members) ? group.members.length : undefined),
    rank: group.rank ?? fallbackRank,
    raw: group,
  };
};

const normalizeCollegeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const resolveContactCollege = (contact) =>
  contact?.college ||
  contact?.university ||
  contact?.school ||
  contact?.collegeName ||
  contact?.collegeTagName ||
  contact?.collegeTag ||
  "";

const isContactAlumni = (contact) => {
  if (!contact) return false;
  if (contact.isAlumni || contact.is_alumni) return true;
  const raw = String(
    contact.studentType ||
      contact.student_type ||
      contact.accountType ||
      contact.userType ||
      contact.user_type ||
      contact.role ||
      ""
  )
    .trim()
    .toLowerCase();
  if (!raw) return false;
  return (
    raw.includes("alumni") ||
    raw.includes("alumnus") ||
    raw.includes("graduate") ||
    raw.includes("grad")
  );
};

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

const ChatMessage = memo(function ChatMessage({
  msg,
  isMine,
  isActiveGroupChat,
  isDirectChat,
  isMobile,
  onOpenSharedPost,
  onReport,
  onDelete,
  canDelete,
  resolveMessageSender,
  onOpenProfile,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isSharedPost = msg.messageType === "shared_post" || msg.type === "shared_post";
  const previewText = resolveMessagePreview(msg);
  const previewThumb = msg.postThumbnail;
  const senderInfo = !isMine && isActiveGroupChat ? resolveMessageSender(msg) : null;
  const senderProfileId = senderInfo?.id || resolveMessageSenderId(msg);
  const isDeleted = Boolean(
    msg.isDeleted ||
      msg.deleted ||
      msg.is_deleted ||
      msg.deletedAt ||
      msg.deleted_at ||
      msg.status === "deleted"
  );
  const canReport = !isMine && !isDeleted;
  const showMenu = (canDelete && !isDeleted) || canReport;
  return (
    <Motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`message-row ${isMine ? "mine" : "theirs"}`}
    >
      <div className="message-bubble">
        {senderInfo && (
          <button
            type="button"
            onClick={() => onOpenProfile?.(senderProfileId, senderInfo)}
            className="mb-2 flex items-center gap-2 text-left"
          >
            <img
              src={senderInfo.avatar || ANONYMOUS_AVATAR}
              alt={senderInfo.name}
              className="h-6 w-6 rounded-full object-cover border border-white/10"
              loading="lazy"
              decoding="async"
            />
            <span className="text-[11px] font-semibold text-[#faf0e6] flex items-center gap-1">
              {senderInfo.name}
              {senderInfo.isVerified && <BlueTick className="text-[10px]" />}
            </span>
          </button>
        )}
        {isDeleted ? (
          <span className="text-xs italic text-[#b9b4c7]">Message deleted</span>
        ) : isSharedPost ? (
          <button
            type="button"
            onClick={() => onOpenSharedPost(msg)}
            className="w-full text-left space-y-2"
          >
            <div className="rounded-xl overflow-hidden border border-white/10 bg-black/30">
              {previewThumb ? (
                <img
                  src={previewThumb}
                  alt="Shared post"
                  className="w-full h-32 object-cover"
                  loading="lazy"
                  decoding="async"
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
          {isMine && isDirectChat && (
            <span
              className={`text-[10px] ${
                msg.seenAt
                  ? "text-[#b9b4c7]"
                  : msg.deliveredAt
                    ? "text-[#b9b4c7]/80"
                    : "text-[#b9b4c7]/60"
              }`}
            >
              {msg.seenAt ? "Seen" : msg.deliveredAt ? "Delivered" : "Sent"}
            </span>
          )}
          {showMenu && (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen((prev) => !prev);
                  }}
                  className="p-1 text-white/60 hover:text-white transition"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title="More actions"
                >
                  ⋮
                </button>
                {!isMobile && menuOpen && (
                  <div className="absolute right-0 mt-2 w-36 max-w-[90vw] bg-[#1a120b]/95 backdrop-blur-md border border-white/10 rounded-xl shadow-lg z-50">
                    {canDelete && !isDeleted && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuOpen(false);
                          onDelete?.(msg);
                        }}
                        className="block w-full text-left px-4 py-2 text-red-400 hover:bg-white/5"
                      >
                        Delete
                      </button>
                    )}
                    {canReport && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuOpen(false);
                          onReport(msg);
                        }}
                        className="block w-full text-left px-4 py-2 text-yellow-400 hover:bg-white/5"
                      >
                        Report
                      </button>
                    )}
                  </div>
                )}
              </div>
              {isMobile && menuOpen && (
                <div
                  className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-end"
                  onClick={() => setMenuOpen(false)}
                >
                  <div
                    className="w-full bg-[#1a120b] rounded-t-2xl p-4 space-y-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {canReport && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onReport(msg);
                        }}
                        className="w-full text-left px-3 py-3 rounded-xl text-yellow-300 hover:bg-white/5"
                      >
                        Report
                      </button>
                    )}
                    {canDelete && !isDeleted && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete?.(msg);
                        }}
                        className="w-full text-left px-3 py-3 rounded-xl text-red-400 hover:bg-white/5"
                      >
                        Delete
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMenuOpen(false)}
                      className="w-full text-left px-3 py-3 rounded-xl text-[#b9b4c7] hover:bg-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </span>
      </div>
    </Motion.div>
  );
});

const ContactListItem = memo(function ContactListItem({
  contactId,
  avatarUrl,
  displayName,
  isVerified,
  isOnline,
  unreadCount,
  lastMessageText,
  lastMessageAt,
  onOpen,
}) {
  const handleClick = useCallback(() => {
    if (contactId) onOpen(contactId);
  }, [contactId, onOpen]);
  return (
    <Motion.div
      onClick={handleClick}
      className={`chat-row ${unreadCount > 0 ? "chat-row-unread" : "chat-row-idle"}`}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="relative">
        <img
          src={avatarUrl}
          alt={displayName}
          className="chat-avatar"
          loading="lazy"
          decoding="async"
        />
        {isOnline && (
          <span className="chat-online-dot">
            <span className="chat-online-ping" />
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`chat-name ${unreadCount > 0 ? "chat-name-unread" : ""}`}>
          <span className="inline-flex items-center gap-1">
            {displayName}
            {isVerified && <BlueTick className="text-[10px]" />}
          </span>
        </p>
        <p className={`chat-preview ${unreadCount > 0 ? "chat-preview-unread" : ""}`}>
          {lastMessageText}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="chat-time">{formatTime(lastMessageAt)}</span>
        {unreadCount > 0 && (
          <div className="flex items-center gap-1">
            <span className="chat-unread-dot" />
            <span className="chat-unread-badge">{unreadCount}</span>
          </div>
        )}
      </div>
    </Motion.div>
  );
});

const GroupListItem = memo(function GroupListItem({
  groupId,
  groupApiId,
  avatarUrl,
  displayName,
  memberCount,
  unreadCount,
  lastMessageText,
  lastMessageAt,
  visibility,
  isMember,
  isPending,
  onOpen,
  onRequestJoin,
  joinLoading,
}) {
  const handleClick = useCallback(() => {
    if (groupId) onOpen(groupId);
  }, [groupId, onOpen]);
  const handleRequestJoin = useCallback(
    (event) => {
      event.stopPropagation();
      if (!onRequestJoin) return;
      onRequestJoin({
        groupId,
        groupApiId,
        visibility,
        isMember,
        isPending,
      });
    },
    [groupApiId, groupId, isMember, isPending, onRequestJoin, visibility]
  );
  const isPrivate = visibility === "private";
  const canRequestJoin = !isMember && !isPending && !isPrivate;
  return (
    <Motion.div
      onClick={handleClick}
      className={`chat-row chat-row-group ${
        unreadCount > 0 ? "chat-row-unread" : "chat-row-idle"
      }`}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="relative">
        <img
          src={avatarUrl}
          alt={displayName}
          className="chat-avatar chat-avatar-group"
          loading="lazy"
          decoding="async"
        />
        <span className="chat-group-icon">
          <i className="fa-solid fa-users" />
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`chat-name ${unreadCount > 0 ? "chat-name-unread" : ""}`}>
          <span className="inline-flex items-center gap-1 flex-wrap">
            {displayName}
            {isPrivate && <i className="fa-solid fa-lock text-[10px] chat-muted" />}
          </span>
        </p>
        <p className={`chat-preview ${unreadCount > 0 ? "chat-preview-unread" : ""}`}>
          {!isMember
            ? isPending
              ? "Join request pending"
              : isPrivate
                ? "Private group"
                : "Tap to request access"
            : lastMessageText}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="chat-time">{formatTime(lastMessageAt)}</span>
        <span className="chat-time">
          {memberCount ? `${memberCount} members` : "Members"}
        </span>
        {canRequestJoin && (
          <button
            type="button"
            className="chat-join-button"
            onClick={handleRequestJoin}
            disabled={joinLoading}
          >
            {joinLoading ? "Sending..." : "Request Join"}
          </button>
        )}
        {!isMember && isPending && (
          <span className="chat-join-pill">Pending</span>
        )}
        {unreadCount > 0 && (
          <div className="flex items-center gap-1">
            <span className="chat-unread-dot" />
            <span className="chat-unread-badge">{unreadCount}</span>
          </div>
        )}
      </div>
    </Motion.div>
  );
});

const MessageList = memo(function MessageList({
  messages,
  currentUserId,
  isActiveGroupChat,
  isDirectChat,
  isMobile,
  onOpenSharedPost,
  onReport,
  onDelete,
  canDeleteMessage,
  resolveMessageSender,
  onOpenProfile,
  messagesEndRef,
}) {
  if (messages.length === 0) {
    return (
      <p className="text-center text-[#b9b4c7] mt-10">No messages yet. Say hi!</p>
    );
  }
  return (
    <>
      {messages.map((msg) => {
        const senderId = resolveMessageSenderId(msg);
        const isMine =
          senderId && currentUserId && String(senderId) === String(currentUserId);
        const canDelete = typeof canDeleteMessage === "function"
          ? canDeleteMessage(msg)
          : false;
        return (
          <ChatMessage
            key={messageKey(msg)}
            msg={msg}
            isMine={isMine}
            isActiveGroupChat={isActiveGroupChat}
            isDirectChat={isDirectChat}
            isMobile={isMobile}
            onOpenSharedPost={onOpenSharedPost}
            onReport={onReport}
            onDelete={onDelete}
            canDelete={canDelete}
            resolveMessageSender={resolveMessageSender}
            onOpenProfile={onOpenProfile}
          />
        );
      })}
      <div ref={messagesEndRef} />
    </>
  );
});

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

const normalizeMessageStatus = (msg) => {
  if (!msg || typeof msg !== "object") return msg;
  const deliveredAt = msg.deliveredAt || msg.delivered_at;
  const seenAt =
    msg.seenAt ||
    msg.seen_at ||
    msg.readAt ||
    msg.read_at ||
    msg.viewedAt ||
    msg.viewed_at;
  const status = String(
    msg.status || msg.deliveryStatus || msg.messageStatus || msg.state || ""
  ).toLowerCase();
  const isDelivered = Boolean(msg.delivered || msg.isDelivered);
  const isSeen = Boolean(msg.seen || msg.isSeen);
  const fallback =
    msg.updatedAt ||
    msg.updated_at ||
    msg.createdAt ||
    msg.created_at ||
    msg.timestamp ||
    "";

  let nextDelivered = deliveredAt;
  let nextSeen = seenAt;

  if ((status === "delivered" || isDelivered) && !nextDelivered) {
    nextDelivered = fallback || new Date().toISOString();
  }
  if ((status === "seen" || isSeen) && !nextSeen) {
    nextSeen = fallback || new Date().toISOString();
  }
  if ((status === "seen" || isSeen) && !nextDelivered) {
    nextDelivered = nextSeen || fallback || new Date().toISOString();
  }

  if (!nextDelivered && !nextSeen) return msg;
  return {
    ...msg,
    deliveredAt: nextDelivered || msg.deliveredAt,
    seenAt: nextSeen || msg.seenAt,
  };
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
    prefetchUserProfile,
  } = useApp();
  const handleOpenProfile = useCallback(
    (userId, preview) => {
      const safeUserId = normalizeUserId(userId || preview);
      if (!safeUserId) return;
      const cachedUser = getUserFromCache?.(safeUserId);
      prefetchUserProfile?.(safeUserId, cachedUser || preview);
      const previewUser = buildUserPreview({ ...(cachedUser || {}), ...(preview || {}) }, {
        _id: safeUserId,
      });
      navigate(`/profile/${safeUserId}`, {
        state: { userPreview: previewUser, modal: true },
      });
    },
    [navigate, prefetchUserProfile, getUserFromCache]
  );
  const [activeTab, setActiveTab] = useState("contacts");
  const [searchQuery, setSearchQuery] = useState("");
  const [contactFilter, setContactFilter] = useState("All");
  const searchInputRef = useRef(null);
  const [showDiscoverOnly, setShowDiscoverOnly] = useState(false);
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
  const [typingMap, setTypingMap] = useState({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showGroupProfile, setShowGroupProfile] = useState(false);
  const [serverGroups, setServerGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [discoverGroups, setDiscoverGroups] = useState([]);
  const [discoverGroupsLoading, setDiscoverGroupsLoading] = useState(false);
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
  const [groupRequestLoading, setGroupRequestLoading] = useState(false);
  const [groupJoinLoadingId, setGroupJoinLoadingId] = useState(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const activeChatRef = useRef(activeChatId);
  const messageIndexRef = useRef({});
  const loadedChatsRef = useRef(new Set());
  const lastSeenSentRef = useRef(new Map());
  const missingGroupSenderRef = useRef(new Set());
  const typingTimeoutsRef = useRef({});
  const lastTypingSentRef = useRef({});
  const mergeMessagesRef = useRef(null);

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
  const canCreateGroup = useMemo(() => {
    const role = String(currentUser?.role || "");
    return role === "super_admin" || (role === "community_admin" && currentUser?.isVerifiedCommunity);
  }, [currentUser?.role, currentUser?.isVerifiedCommunity]);

  const { groupRequests, friendRequests } = useMemo(() => {
    const group = [];
    const friend = [];
    requests.forEach((req) => {
      const meta = resolveGroupRequestMeta(req);
      if (meta.isGroup) {
        group.push({ req, meta });
      } else {
        friend.push({ req, meta });
      }
    });
    return { groupRequests: group, friendRequests: friend };
  }, [requests]);

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

  useEffect(() => {
    if (!currentUser?.id) {
      setServerGroups([]);
      return;
    }
    const candidates = [
      currentUser?.groups,
      currentUser?.groupMemberships,
      currentUser?.groupIds,
    ].filter(Boolean);
    const normalized = [];
    candidates.forEach((entry) => {
      if (Array.isArray(entry)) {
        entry.forEach((item) => {
          const normalizedItem =
            typeof item === "string" || typeof item === "number"
              ? normalizeGroupItem({ id: item, isMember: true }, currentUser?.id)
              : normalizeGroupItem(item, currentUser?.id);
          if (normalizedItem) normalized.push(normalizedItem);
        });
      } else {
        const normalizedItem =
          typeof entry === "string" || typeof entry === "number"
            ? normalizeGroupItem({ id: entry, isMember: true }, currentUser?.id)
            : normalizeGroupItem(entry, currentUser?.id);
        if (normalizedItem) normalized.push(normalizedItem);
      }
    });
    const deduped = [];
    const seen = new Set();
    normalized.forEach((item) => {
      const key = String(item.id);
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(item);
    });
    if (deduped.length) {
      setServerGroups(deduped);
    }
  }, [currentUser?.id, currentUser?.groups, currentUser?.groupMemberships, currentUser?.groupIds]);

  useEffect(() => {
    if (!currentUser?.id) return;
    let active = true;
    setGroupsLoading(true);
    getChatGroups()
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        const normalized = list
          .map((item, index) => normalizeGroupItem(item, currentUser?.id, 10 + index))
          .filter(Boolean);
        if (normalized.length === 0) return;
        setServerGroups((prev) => {
          const mergedMap = new Map(prev.map((item) => [String(item.id), item]));
          normalized.forEach((item) => {
            const key = String(item.id);
            const existing = mergedMap.get(key);
            if (!existing) {
              mergedMap.set(key, item);
              return;
            }
            const merged = { ...existing, ...item };
            if (existing.isMember && item.isMember !== true) {
              merged.isMember = true;
            }
            if (existing.isAdmin && item.isAdmin !== true) {
              merged.isAdmin = true;
            }
            if (existing.isPending && !item.isPending) {
              merged.isPending = true;
            }
            mergedMap.set(key, merged);
          });
          return Array.from(mergedMap.values());
        });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setGroupsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) return;
    let active = true;
    setDiscoverGroupsLoading(true);
    getPublicGroups({ visibility: "public", scope: "public", includePublic: true })
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        const normalized = list
          .map((item, index) => normalizeGroupItem(item, currentUser?.id, 200 + index))
          .filter(Boolean);
        if (normalized.length) {
          const seen = new Set();
          const deduped = [];
          normalized.forEach((group) => {
            const key = String(group.id);
            if (seen.has(key)) return;
            seen.add(key);
            deduped.push(group);
          });
          setDiscoverGroups(deduped);
        } else {
          setDiscoverGroups([]);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setDiscoverGroupsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser?.id]);

  const handleReportMessage = useCallback((msg) => {
    setReportTarget(msg);
  }, []);

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
      setReportTarget(null);
    } catch (error) {
      alert(error.message || "Failed to report message");
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
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distance =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      shouldAutoScrollRef.current = distance < 120;
    };
    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [activeChatId]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !isMobile) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateViewportVars = () => {
      const height = Math.max(0, Math.round(viewport.height || 0));
      const offsetTop = Math.max(0, Math.round(viewport.offsetTop || 0));
      const layoutHeight = Math.max(0, Math.round(window.innerHeight || 0));
      const keyboard = Math.max(0, layoutHeight - height - offsetTop);
      document.documentElement.style.setProperty("--chat-keyboard", `${keyboard}px`);
    };
    updateViewportVars();
    viewport.addEventListener("resize", updateViewportVars);
    viewport.addEventListener("scroll", updateViewportVars);
    return () => {
      viewport.removeEventListener("resize", updateViewportVars);
      viewport.removeEventListener("scroll", updateViewportVars);
      document.documentElement.style.removeProperty("--chat-keyboard");
    };
  }, [isMobile]);

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

  const emitTyping = useCallback(
    (value) => {
      const text = typeof value === "string" ? value : messageText;
      if (!text || !currentUser?.id || !activeChatId) return;
      if (String(activeChatId).startsWith("group:")) return;
      const now = Date.now();
      const lastSent = lastTypingSentRef.current[activeChatId] || 0;
      if (now - lastSent < 1200) return;
      lastTypingSentRef.current[activeChatId] = now;

      const socket = getSocket();
      if (!socket) return;
      const payload = {
        chatId: activeChatId,
        senderId: currentUser.id,
        receiverId: activeChatId,
      };
      socket.emit("typing", payload);
      socket.emit("chat:typing", payload);
      socket.emit("user_typing", payload);
    },
    [messageText, currentUser?.id, activeChatId]
  );

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
          contact.isVerifiedCommunity ||
          contact.verifiedCommunity ||
          contact.communityVerified ||
          contact.verified ||
          contact.is_verified ||
          cached?.isVerified ||
          cached?.isVerifiedCommunity ||
          cached?.verifiedCommunity ||
          cached?.communityVerified ||
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
          senderEntity?.isVerifiedCommunity ||
          senderEntity?.verifiedCommunity ||
          senderEntity?.communityVerified ||
          senderEntity?.verified ||
          senderEntity?.is_verified ||
          msg.senderVerified ||
          msg.userVerified ||
          cached?.isVerified ||
          cached?.isVerifiedCommunity ||
          cached?.verifiedCommunity ||
          cached?.communityVerified ||
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
        const filteredIncoming = filterMessagesForChat(chatId, incomingMessages, now).map(
          normalizeMessageStatus
        );
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
  mergeMessagesRef.current = mergeMessages;

  useEffect(() => {
    if (!currentUser?.id || !activeChatId) return;
    const existing = messagesByChat[activeChatId];
    if (existing && existing.length) return;
    const cached = readMessagesCache(currentUser.id, activeChatId);
    if (cached && cached.length && mergeMessagesRef.current) {
      mergeMessagesRef.current(activeChatId, cached);
    }
  }, [currentUser?.id, activeChatId, messagesByChat]);

  useEffect(() => {
    if (!currentUser?.id || !activeChatId) return;
    const messages = messagesByChat[activeChatId];
    if (!messages || messages.length === 0) return;
    writeMessagesCache(currentUser.id, activeChatId, messages);
  }, [currentUser?.id, activeChatId, messagesByChat]);

  const patchMessages = useCallback((chatId, predicate, updater) => {
    if (typeof predicate !== "function") return;
    setMessagesByChat((prev) => {
      const applyUpdates = (list = []) => {
        let changed = false;
        const next = list.map((msg) => {
          if (!predicate(msg)) return msg;
          const updated =
            typeof updater === "function" ? updater(msg) : { ...msg, ...updater };
          if (updated !== msg) changed = true;
          return updated;
        });
        return { next, changed };
      };

      if (chatId) {
        const existing = prev[chatId] || [];
        const { next, changed } = applyUpdates(existing);
        return changed ? { ...prev, [chatId]: next } : prev;
      }

      let anyChanged = false;
      const nextState = { ...prev };
      Object.keys(prev).forEach((key) => {
        const { next, changed } = applyUpdates(prev[key]);
        if (changed) {
          nextState[key] = next;
          anyChanged = true;
        }
      });
      return anyChanged ? nextState : prev;
    });
  }, []);

  const handleDeleteMessage = useCallback(
    async (msg) => {
      if (!msg || !activeChatId) return;
      const messageId = msg._id || msg.id || msg.messageId;
      if (!messageId) return;
      if (!confirm("Delete this message?")) return;
      try {
        await deleteChatMessage(messageId, { chatId: activeChatId });
      } catch (_error) {
        void _error;
      } finally {
        patchMessages(
          activeChatId,
          (item) => {
            const itemId = item._id || item.id || item.messageId;
            return (
              (itemId && String(itemId) === String(messageId)) ||
              messageKey(item) === messageKey(msg)
            );
          },
          (item) => ({
            ...item,
            isDeleted: true,
            deletedAt: new Date().toISOString(),
            text: "",
          })
        );
      }
    },
    [activeChatId, patchMessages]
  );

  const resolveChatIdFromPayload = useCallback(
    (payload) => {
      const message = payload?.message || payload;
      if (!message) return "";
      const rawTarget =
        message.chatId ||
        message.chat_id ||
        message.toChatId ||
        message.to ||
        message.receiverId ||
        message.recipientId ||
        payload?.chatId ||
        payload?.roomId ||
        payload?.conversationId ||
        "";
      const target = String(rawTarget || "");
      if (target.startsWith("group:")) return target;
      const fromId = resolveMessageSenderId(message);
      if (currentUser?.id && fromId && String(fromId) === String(currentUser.id)) {
        return target || fromId;
      }
      if (target && currentUser?.id && String(target) === String(currentUser.id)) {
        return fromId || target;
      }
      return fromId || target;
    },
    [currentUser?.id]
  );

  const resolveTypingPayload = useCallback(
    (payload) => {
      if (!payload) return { chatId: "", senderId: "" };
      const senderId = String(
        payload.senderId || payload.userId || payload.from || payload.user || payload.id || ""
      );
      const rawTarget =
        payload.chatId ||
        payload.chat_id ||
        payload.to ||
        payload.receiverId ||
        payload.recipientId ||
        payload.roomId ||
        payload.conversationId ||
        "";
      const target = String(rawTarget || "");
      const chatId = target.startsWith("group:")
        ? target
        : currentUser?.id && target && String(target) === String(currentUser.id)
          ? senderId || target
          : target || senderId;
      return { chatId: String(chatId || ""), senderId };
    },
    [currentUser?.id]
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
        const payload = {
          chatId,
          userId: currentUser.id,
          seenAt,
        };
        socket.emit("message-seen", payload);
        socket.emit("message_seen", payload);
        socket.emit("mark_seen", payload);
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

  const scrollToBottom = useCallback((force = false) => {
    if (!force && !shouldAutoScrollRef.current) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
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
              isVerified: Boolean(
                userData.isVerified ||
                  userData.isVerifiedCommunity ||
                  userData.verifiedCommunity ||
                  userData.communityVerified
              ),
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
        void requestsData;
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
                  isVerified: Boolean(
                    embeddedUser.isVerified ||
                      embeddedUser.isVerifiedCommunity ||
                      embeddedUser.verifiedCommunity ||
                      embeddedUser.communityVerified
                  ),
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
                  isVerified: Boolean(
                    userData.isVerified ||
                      userData.isVerifiedCommunity ||
                      userData.verifiedCommunity ||
                      userData.communityVerified
                  ),
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
        void formattedRequests;
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
                    isVerified: Boolean(
                      sender?.isVerified ||
                        sender?.isVerifiedCommunity ||
                        sender?.verifiedCommunity ||
                        sender?.communityVerified
                    ),
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
    } catch (_error) {
      void _error;
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
          } catch (_error) {
            void _error;
          }
        })
      );
    },
    [fetchChatMessages, mergeMessages, updateChatMeta, resolveUnreadCount]
  );

  const refreshChatMessages = useCallback(
    async (chatId) => {
      if (!chatId) return;
      try {
        const msgs = await fetchChatMessages(chatId);
        const scopedMsgs = filterMessagesForChat(chatId, msgs);
        mergeMessages(chatId, scopedMsgs);
        if (scopedMsgs.length > 0) {
          const last = scopedMsgs[scopedMsgs.length - 1];
          updateChatMeta(chatId, last, {
            unreadCount: resolveUnreadCount(scopedMsgs, chatId),
          });
        } else if (isGroupChatId(chatId)) {
          syncChatMetaFromMessages(chatId, []);
        }
      } catch (_error) {
        void _error;
      }
    },
    [fetchChatMessages, mergeMessages, updateChatMeta, resolveUnreadCount, syncChatMetaFromMessages]
  );

  useEffect(() => {
    if (!activeChatId) {
      if (typeof window !== "undefined") {
        window.__activeChatRoom = null;
      }
      return;
    }

    if (typeof window !== "undefined") {
      window.__activeChatRoom = activeChatId;
    }

    shouldAutoScrollRef.current = true;
    refreshChatMessages(activeChatId);
    markChatRead(activeChatId);
    markMessagesSeen(activeChatId);

    const socket = getSocket();
    const isGroupChat = String(activeChatId).startsWith("group:");
    const isSystemGroupChat =
      String(activeChatId).startsWith("group:global") ||
      String(activeChatId).startsWith("group:college:");
    const isMemberForActive =
      !isGroupChat ||
      isSystemGroupChat ||
      serverGroups.some(
        (group) =>
          String(group.id) === String(activeChatId) && group.isMember !== false
      );
    const shouldJoin = !isGroupChat || isMemberForActive;
    if (socket && shouldJoin) {
      socket.emit("chat:joinRoom", { roomId: activeChatId });
    }

    return () => {
      if (socket && shouldJoin) {
        socket.emit("chat:leaveRoom", { roomId: activeChatId });
      }
      if (typeof window !== "undefined" && window.__activeChatRoom === activeChatId) {
        window.__activeChatRoom = null;
      }
    };
  }, [activeChatId, refreshChatMessages, markChatRead, markMessagesSeen, serverGroups]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const text = messageText.trim();
    if (!text || !activeChatId || !currentUser?.id) return;

    const socket = getSocket();
    const isGroupChat = String(activeChatId).startsWith("group:");
    if (isGroupChat && !isActiveGroupMember) {
      showToast({
        id: `group-locked-${activeChatId}`,
        title: "Join required",
        message: isActiveGroupPending
          ? "Your join request is pending approval."
          : isActiveGroupPrivate
            ? "This group is private."
            : "Request access to start chatting.",
      });
      return;
    }
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
      status: "sent",
      clientMessageId: `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pending: true,
    };

    mergeMessages(activeChatId, [newMessage]);
    updateChatMeta(activeChatId, newMessage);
    markChatRead(activeChatId);
    const socketPayload = {
      ...newMessage,
      senderId: currentUser.id,
      receiverId: activeChatId,
      chatId: activeChatId,
    };
    if (socket?.connected) {
      socket.emit("chat:sendMessage", {
        roomId: activeChatId,
        receiverId: isGroupChat ? null : activeChatId,
        message: socketPayload,
      });
    } else {
      sendChatMessage(newMessage)
        .then((response) => {
          const saved = response?.message || response;
          if (saved) {
            mergeMessages(activeChatId, [saved]);
            updateChatMeta(activeChatId, saved);
          }
        })
        .catch(() => {});
    }
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
    const groupMeta = resolveGroupRequestMeta(request);

    try {
      if (groupMeta.isGroup) {
        const groupApiId = groupMeta.groupApiId || resolveGroupApiId(groupMeta.groupId);
        if (!groupApiId || !requesterId) return;
        await approveGroupJoin(groupApiId, requesterId);
      } else {
        await acceptFriend(request);
      }
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
          if (groupMeta.isGroup) {
            const reqGroup = resolveGroupRequestMeta(req);
            if (!reqGroup.isGroup) return true;
            const sameGroup =
              (reqGroup.groupApiId && groupMeta.groupApiId &&
                String(reqGroup.groupApiId) === String(groupMeta.groupApiId)) ||
              (reqGroup.groupId && groupMeta.groupId &&
                String(reqGroup.groupId) === String(groupMeta.groupId));
            const sameUser = requesterId ? String(fromId) === String(requesterId) : false;
            return !(sameGroup && sameUser);
          }
          return requesterId ? String(fromId) !== String(requesterId) : true;
        })
      );
      await refreshLists();
    } catch (error) {
      alert(error.message || "Failed to accept request");
    }
  };

  const handleIgnoreRequest = async (request) => {
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
    const groupMeta = resolveGroupRequestMeta(request);
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
        if (groupMeta.isGroup) {
          const reqGroup = resolveGroupRequestMeta(req);
          if (!reqGroup.isGroup) return true;
          const sameGroup =
            (reqGroup.groupApiId && groupMeta.groupApiId &&
              String(reqGroup.groupApiId) === String(groupMeta.groupApiId)) ||
            (reqGroup.groupId && groupMeta.groupId &&
              String(reqGroup.groupId) === String(groupMeta.groupId));
          const sameUser = requesterId ? String(id) === String(requesterId) : false;
          return !(sameGroup && sameUser);
        }
        return requesterId ? String(id) !== String(requesterId) : true;
      })
    );
    try {
      if (groupMeta.isGroup) {
        const groupApiId = groupMeta.groupApiId || resolveGroupApiId(groupMeta.groupId);
        if (!groupApiId || !requesterId) return;
        await rejectGroupJoin(groupApiId, requesterId);
      } else {
        await rejectFriend(requesterId);
      }
    } catch (_error) {
      void _error;
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

  const handleRequestJoinGroup = async () => {
    if (!activeChatUser?.isGroup) return;
    if (isActiveGroupMember || isActiveGroupPending) return;
    if (isActiveGroupPrivate || isActiveSystemGroup) {
      showToast({
        id: `group-private-${activeChatId}`,
        title: "Private group",
        message: "Only admins can add members to this group.",
      });
      return;
    }
    const groupApiId = activeChatUser?.apiId || activeChatUser?.groupId || activeChatId;
    if (!groupApiId) return;
    setGroupRequestLoading(true);
    try {
      await requestGroupJoin(groupApiId);
      setServerGroups((prev) =>
        prev.map((group) =>
          String(group.id) === String(activeChatId)
            ? { ...group, isPending: true }
            : group
        )
      );
      showToast({
        id: `group-request-${activeChatId}`,
        title: "Request sent",
        message: "Your join request was sent.",
      });
    } catch (error) {
      showToast({
        id: `group-request-failed-${activeChatId}`,
        title: "Request failed",
        message: error.message || "Unable to send request.",
      });
    } finally {
      setGroupRequestLoading(false);
    }
  };

  const markGroupPending = useCallback((groupId) => {
    if (!groupId) return;
    setServerGroups((prev) =>
      prev.map((group) =>
        String(group.id) === String(groupId) ? { ...group, isPending: true } : group
      )
    );
    setDiscoverGroups((prev) =>
      prev.map((group) =>
        String(group.id) === String(groupId) ? { ...group, isPending: true } : group
      )
    );
  }, []);

  const handleOpenChat = useCallback(
    (chatId) => {
      setActiveChatId(chatId);
      if (String(chatId).startsWith("group:")) {
        setActiveTab("groups");
      } else {
        setActiveTab("contacts");
      }
    },
    [setActiveChatId]
  );

  const handleGroupCreated = useCallback(
    (group) => {
      const normalized = normalizeGroupItem(
        {
          ...group,
          isMember: true,
          isAdmin: true,
        },
        currentUser?.id
      );
      if (!normalized) return;
      setServerGroups((prev) => {
        const exists = prev.some((item) => String(item.id) === String(normalized.id));
        if (exists) return prev;
        return [normalized, ...prev];
      });
      setActiveChatId(normalized.id);
      setActiveTab("groups");
    },
    [currentUser?.id, setActiveChatId]
  );

  const handleGroupMembershipChange = useCallback((chatId, updates = {}) => {
    if (!chatId) return;
    setServerGroups((prev) =>
      prev.map((group) =>
        String(group.id) === String(chatId) ? { ...group, ...updates } : group
      )
    );
  }, []);

  const handleGroupDeleted = useCallback(
    (chatId) => {
      if (!chatId) return;
      setServerGroups((prev) => prev.filter((group) => String(group.id) !== String(chatId)));
      if (String(activeChatId) === String(chatId)) {
        setActiveChatId(null);
      }
    },
    [activeChatId, setActiveChatId]
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

  const handleRequestJoinGroupFromList = useCallback(
    async ({ groupId, groupApiId, visibility, isMember, isPending }) => {
      if (!groupId) return;
      if (isMember || isPending) return;
      const isPrivate = String(visibility || "public").toLowerCase() === "private";
      if (isPrivate) {
        showToast({
          id: `group-private-${groupId}`,
          title: "Private group",
          message: "Only admins can add members to this group.",
        });
        return;
      }
      const requestId = groupApiId || groupId;
      if (!requestId) return;
      setGroupJoinLoadingId(groupId);
      try {
        await requestGroupJoin(requestId);
        markGroupPending(groupId);
        showToast({
          id: `group-request-${groupId}`,
          title: "Request sent",
          message: "Your join request was sent.",
        });
      } catch (error) {
        showToast({
          id: `group-request-failed-${groupId}`,
          title: "Request failed",
          message: error.message || "Unable to send request.",
        });
      } finally {
        setGroupJoinLoadingId((prev) =>
          String(prev) === String(groupId) ? null : prev
        );
      }
    },
    [markGroupPending, showToast]
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
    socket.off("user_online", handleOnline);
    socket.off("user_offline", handleOffline);
    socket.off("message_seen", handleSeen);
    socket.on("user-online", handleOnline);
    socket.on("user-offline", handleOffline);
    socket.on("message-seen", handleSeen);
    socket.on("user_online", handleOnline);
    socket.on("user_offline", handleOffline);
    socket.on("message_seen", handleSeen);

    return () => {
      socket.off("user-online", handleOnline);
      socket.off("user-offline", handleOffline);
      socket.off("message-seen", handleSeen);
      socket.off("user_online", handleOnline);
      socket.off("user_offline", handleOffline);
      socket.off("message_seen", handleSeen);
    };
  }, [currentUser?.id, updatePresence]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !currentUser?.id) return;

    const handleTyping = (payload) => {
      const { chatId, senderId } = resolveTypingPayload(payload);
      if (!chatId || !senderId) return;
      if (String(senderId) === String(currentUser.id)) return;

      setTypingMap((prev) => ({
        ...prev,
        [chatId]: { userId: senderId, ts: Date.now() },
      }));

      const existing = typingTimeoutsRef.current[chatId];
      if (existing) clearTimeout(existing);
      typingTimeoutsRef.current[chatId] = setTimeout(() => {
        setTypingMap((prev) => {
          if (!prev[chatId]) return prev;
          const next = { ...prev };
          delete next[chatId];
          return next;
        });
        delete typingTimeoutsRef.current[chatId];
      }, 1800);
    };

    socket.off("typing", handleTyping);
    socket.off("chat:typing", handleTyping);
    socket.off("user_typing", handleTyping);
    socket.off("user-typing", handleTyping);
    socket.on("typing", handleTyping);
    socket.on("chat:typing", handleTyping);
    socket.on("user_typing", handleTyping);
    socket.on("user-typing", handleTyping);

    return () => {
      socket.off("typing", handleTyping);
      socket.off("chat:typing", handleTyping);
      socket.off("user_typing", handleTyping);
      socket.off("user-typing", handleTyping);
      Object.values(typingTimeoutsRef.current).forEach((timeoutId) =>
        clearTimeout(timeoutId)
      );
      typingTimeoutsRef.current = {};
    };
  }, [currentUser?.id, resolveTypingPayload]);

  const groupContacts = useMemo(() => {
    const universityLabel = currentUser?.university || currentUser?.college || "";
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
      : universityLabel
        ? `group:college:${toSlug(universityLabel)}`
        : null;
    const collegeDisplayName = universityLabel
      ? `${universityLabel} Group`
      : "College Group";
    return [
      collegeRoomId
        ? {
            id: collegeRoomId,
            displayName: collegeDisplayName,
            profilePicUrl: DEFAULT_GROUP_AVATAR,
            isGroup: true,
            isSystemGroup: true,
            isMember: true,
            visibility: "public",
            rank: 0,
            memberCount: currentUser?.collegeMemberCount || currentUser?.universityMemberCount,
          }
        : null,
      {
        id: "group:global",
        displayName: "InCampus Global",
        profilePicUrl: DEFAULT_GROUP_AVATAR,
        isGroup: true,
        isSystemGroup: true,
        isMember: true,
        visibility: "public",
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
    currentUser?.collegeGroupId,
    currentUser?.college_group_id,
    currentUser?.groupId,
    currentUser?.collegeGroup,
  ]);

  const groupList = useMemo(() => {
    const combined = [...groupContacts, ...serverGroups];
    const seen = new Set();
    return combined.filter((group) => {
      if (!group?.id) return false;
      const key = String(group.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [groupContacts, serverGroups]);

  useEffect(() => {
    if (!serverGroups.length) return;
    serverGroups.forEach((group) => {
      if (group?.id && group.isMember !== false) {
        joinSocket(String(group.id));
      }
    });
  }, [serverGroups]);

  const allContacts = useMemo(() => {
    return [...groupList, ...contacts];
  }, [groupList, contacts]);

  const groupUnreadCount = useMemo(() => {
    return groupList.reduce((total, group) => {
      const unread = chatMeta[group.id]?.unreadCount || 0;
      return total + unread;
    }, 0);
  }, [groupList, chatMeta]);

  useEffect(() => {
    if (!currentUser?.id || typeof window === "undefined") return;

    const handleMessage = (event) => {
      const payload = event?.detail || event;
      if (import.meta.env.DEV) {
        console.debug("[chat] Received:", payload);
      }
      const msg = payload?.message || payload;
      if (!msg) return;
      const chatId = resolveChatIdFromPayload(payload);
      if (!chatId) return;
      const isGroupMessage = String(chatId).startsWith("group:");

      const senderId = resolveMessageSenderId(msg);
      const shouldIncrementUnread =
        chatId !== activeChatRef.current &&
        senderId &&
        String(senderId) !== String(currentUser.id);

      requestAnimationFrame(() => {
        mergeMessages(chatId, [msg]);
        updateChatMeta(chatId, msg, { incrementUnread: shouldIncrementUnread });
      });

      if (!isGroupMessage && senderId && String(senderId) !== String(currentUser.id)) {
        const messageId = msg._id || msg.id || msg.clientMessageId;
        const deliveredPayload = {
          messageId,
          chatId,
          senderId,
          receiverId: currentUser.id,
          deliveredAt: new Date().toISOString(),
        };
        const socket = getSocket();
        if (socket) {
          socket.emit("message_delivered", deliveredPayload);
          socket.emit("message-delivered", deliveredPayload);
        }
      }

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

    window.addEventListener("chat:activeMessage", handleMessage);

    return () => {
      window.removeEventListener("chat:activeMessage", handleMessage);
    };
  }, [
    currentUser?.id,
    markChatRead,
    markMessagesSeen,
    mergeMessages,
    updateChatMeta,
    resolveChatIdFromPayload,
    playNotificationSound,
    chatSoundEnabled,
    isMobile,
    scrollToBottom,
  ]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !currentUser?.id) return;

    const handleMessageSent = (payload) => {
      const message = normalizeMessageStatus(payload?.message || payload);
      if (!message) return;
      const chatId = resolveChatIdFromPayload(message);
      if (!chatId) return;
      mergeMessages(chatId, [message]);
      updateChatMeta(chatId, message);
    };

    const handleDelivered = (payload) => {
      const message = payload?.message || payload;
      const messageId =
        message?._id || message?.id || payload?.messageId || payload?.id || "";
      if (!messageId) return;
      const chatId = resolveChatIdFromPayload(message) || payload?.chatId || "";
      const deliveredAt =
        payload?.deliveredAt ||
        message?.deliveredAt ||
        message?.delivered_at ||
        new Date().toISOString();
      patchMessages(chatId, (msg) => {
        const id = msg?._id || msg?.id || msg?.clientMessageId || "";
        return String(id) === String(messageId);
      }, (msg) => ({
        ...msg,
        deliveredAt,
        pending: false,
        status: msg.status || "delivered",
      }));
    };

    const handleMessagesSeen = (payload) => {
      const seenAt = payload?.seenAt || payload?.readAt || new Date().toISOString();
      const messageIds = []
        .concat(payload?.messageIds || [])
        .concat(payload?.messageId ? [payload.messageId] : [])
        .map((id) => String(id))
        .filter(Boolean);
      let chatId = payload?.chatId || payload?.roomId || payload?.conversationId || "";
      if (!chatId) {
        const senderId = payload?.senderId || payload?.from || payload?.userId || "";
        const receiverId = payload?.receiverId || payload?.to || payload?.targetUserId || "";
        if (senderId && receiverId) {
          chatId = String(senderId) === String(currentUser.id) ? receiverId : senderId;
        }
      }
      if (!chatId && messageIds.length === 0) return;

      patchMessages(chatId, (msg) => {
        if (!msg) return false;
        if (messageIds.length > 0) {
          const id = msg._id || msg.id || msg.clientMessageId || "";
          return messageIds.includes(String(id));
        }
        return String(resolveMessageSenderId(msg)) === String(currentUser.id);
      }, (msg) => ({
        ...msg,
        seenAt,
        deliveredAt: msg.deliveredAt || msg.delivered_at || seenAt,
        pending: false,
        status: "seen",
      }));
    };

    socket.off("message_sent", handleMessageSent);
    socket.off("message-sent", handleMessageSent);
    socket.off("message_delivered", handleDelivered);
    socket.off("message-delivered", handleDelivered);
    socket.off("messages_seen", handleMessagesSeen);
    socket.off("messages-seen", handleMessagesSeen);
    socket.on("message_sent", handleMessageSent);
    socket.on("message-sent", handleMessageSent);
    socket.on("message_delivered", handleDelivered);
    socket.on("message-delivered", handleDelivered);
    socket.on("messages_seen", handleMessagesSeen);
    socket.on("messages-seen", handleMessagesSeen);

    return () => {
      socket.off("message_sent", handleMessageSent);
      socket.off("message-sent", handleMessageSent);
      socket.off("message_delivered", handleDelivered);
      socket.off("message-delivered", handleDelivered);
      socket.off("messages_seen", handleMessagesSeen);
      socket.off("messages-seen", handleMessagesSeen);
    };
  }, [currentUser?.id, mergeMessages, patchMessages, resolveChatIdFromPayload, updateChatMeta]);

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
  const currentUserId = currentUser?.id;
  const activeChatUser = allContacts.find((c) => c.id === activeChatId);
  const isChatOpen = Boolean(activeChatId);
  useEffect(() => {
    if (!activeChatUser?.isGroup && showGroupProfile) {
      setShowGroupProfile(false);
    }
  }, [activeChatUser?.isGroup, showGroupProfile]);
  const isActiveGroup = Boolean(activeChatUser?.isGroup);
  const isMemberFromUserGroups = useMemo(() => {
    if (!activeChatId || !String(activeChatId).startsWith("group:")) return false;
    const candidates = []
      .concat(currentUser?.groups || [])
      .concat(currentUser?.groupMemberships || [])
      .concat(currentUser?.groupIds || []);
    return candidates.some((entry) => {
      const resolved = ensureGroupRoomId(entry);
      return resolved && String(resolved) === String(activeChatId);
    });
  }, [
    activeChatId,
    currentUser?.groups,
    currentUser?.groupMemberships,
    currentUser?.groupIds,
  ]);
  const isActiveGroupMember = isActiveGroup
    ? activeChatUser?.isMember !== false || isMemberFromUserGroups
    : true;
  const isActiveGroupPending = Boolean(isActiveGroup && activeChatUser?.isPending);
  const activeGroupVisibility = isActiveGroup ? activeChatUser?.visibility || "public" : "public";
  const isActiveGroupPrivate = isActiveGroup && activeGroupVisibility === "private";
  const isActiveSystemGroup = Boolean(isActiveGroup && activeChatUser?.isSystemGroup);
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isActiveGroupAdmin = Boolean(
    isActiveGroup && (isSuperAdmin || activeChatUser?.isAdmin)
  );
  const friendStatus = activeChatUser?.isGroup
    ? "friends"
    : getFriendStatus(activeChatUser?.id || activeChatId);
  const canChatActive = activeChatUser?.isGroup
    ? isActiveGroupMember
    : canChat(activeChatUser?.id || activeChatId);
  const activeChatName = resolveContactName(activeChatUser);
  const activeChatVerified = resolveContactVerified(activeChatUser);
  const activePresence = activeChatUser?.isGroup
    ? { isOnline: false, lastSeen: "" }
    : getPresence(activeChatUser?.id, activeChatUser);
  const activeTyping = activeChatId ? typingMap[activeChatId] : null;
  const showTyping = Boolean(activeTyping && activeTyping.userId);
  const isDirectChat = !activeChatUser?.isGroup;
  const canDeleteMessage = useCallback(
    (msg) => {
      if (!msg) return false;
      const senderId = resolveMessageSenderId(msg);
      const isMine =
        senderId && currentUserId && String(senderId) === String(currentUserId);
      if (isMine) return true;
      if (isSuperAdmin) return true;
      if (isActiveGroupChat && isActiveGroupAdmin) return true;
      return false;
    },
    [currentUserId, isSuperAdmin, isActiveGroupChat, isActiveGroupAdmin]
  );

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

  const normalizedSearch = useMemo(
    () => String(searchQuery || "").trim().toLowerCase(),
    [searchQuery]
  );

  const currentCollegeKey = useMemo(
    () =>
      normalizeCollegeKey(
        currentUser?.college || currentUser?.university || currentUser?.school || ""
      ),
    [currentUser?.college, currentUser?.university, currentUser?.school]
  );

  const filteredContactsList = useMemo(() => {
    let list = contactsList;
    if (contactFilter === "Alumni") {
      list = list.filter((contact) => isContactAlumni(contact));
    } else if (contactFilter === "Same College") {
      if (!currentCollegeKey) {
        list = [];
      } else {
        list = list.filter((contact) => {
          const collegeKey = normalizeCollegeKey(resolveContactCollege(contact));
          return collegeKey && collegeKey === currentCollegeKey;
        });
      }
    }
    if (!normalizedSearch) return list;
    return list.filter((contact) => {
      const name = resolveContactName(contact);
      const username =
        contact?.username ||
        contact?.userName ||
        contact?.handle ||
        "";
      return `${name} ${username}`.toLowerCase().includes(normalizedSearch);
    });
  }, [contactsList, normalizedSearch, contactFilter, currentCollegeKey]);

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

  const filteredGroupsSorted = useMemo(() => {
    if (!normalizedSearch) return groupsSorted;
    return groupsSorted.filter((group) => {
      const name =
        group?.displayName ||
        group?.name ||
        group?.title ||
        group?.groupName ||
        "";
      return String(name).toLowerCase().includes(normalizedSearch);
    });
  }, [groupsSorted, normalizedSearch]);

  const contactItems = useMemo(() => {
    return filteredContactsList.map((contact, index) => {
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
      const lastMessageText =
        truncateMessage(resolveMessagePreview(meta.lastMessage)) ||
        "Say hello to start chatting";
      const avatarUrl = contact.profilePicUrl || ANONYMOUS_AVATAR;
      return (
        <ContactListItem
          key={String(contactKey)}
          contactId={contactId}
          avatarUrl={avatarUrl}
          displayName={displayName}
          isVerified={isVerified}
          isOnline={isOnline}
          unreadCount={unreadCount}
          lastMessageText={lastMessageText}
          lastMessageAt={meta.lastMessageAt}
          onOpen={handleOpenChat}
        />
      );
    });
  }, [
    filteredContactsList,
    chatMeta,
    getPresence,
    resolveContactName,
    resolveContactVerified,
    handleOpenChat,
  ]);

  const { memberGroups, exploreGroups } = useMemo(() => {
    const member = [];
    const explore = [];
    const publicGroups = [];
    const filteredDiscover =
      normalizedSearch
        ? discoverGroups.filter((group) => {
            const name =
              group?.displayName ||
              group?.name ||
              group?.title ||
              group?.groupName ||
              "";
            return String(name).toLowerCase().includes(normalizedSearch);
          })
        : discoverGroups;
    const combined = [...filteredGroupsSorted, ...filteredDiscover];
    const seen = new Set();
    combined.forEach((group) => {
      if (!group) return;
      const key = String(group.id);
      if (seen.has(key)) return;
      seen.add(key);
      const visibility = String(group.visibility || "public").toLowerCase();
      if (visibility === "public") {
        publicGroups.push(group);
      }
      const isMember = group.isMember !== false || group.isSystemGroup;
      if (isMember) {
        member.push(group);
        return;
      }
      if (visibility === "private" && !group.isPending) return;
      explore.push(group);
    });
    if (explore.length === 0 && publicGroups.length > 0) {
      const fallbackSeen = new Set(explore.map((group) => String(group.id)));
      publicGroups.forEach((group) => {
        const key = String(group.id);
        if (fallbackSeen.has(key)) return;
        fallbackSeen.add(key);
        explore.push(group);
      });
    }
    return { memberGroups: member, exploreGroups: explore };
  }, [filteredGroupsSorted, discoverGroups, normalizedSearch]);

  const filteredGroupRequests = useMemo(() => {
    if (!normalizedSearch) return groupRequests;
    return groupRequests.filter(({ req }) => {
      const user =
        (req.user && typeof req.user === "object" ? req.user : null) ||
        (req.fromUser && typeof req.fromUser === "object" ? req.fromUser : null) ||
        (req.sender && typeof req.sender === "object" ? req.sender : null) ||
        (req.requester && typeof req.requester === "object" ? req.requester : null) ||
        null;
      const name =
        user?.displayName ||
        user?.fullName ||
        user?.username ||
        "";
      return String(name).toLowerCase().includes(normalizedSearch);
    });
  }, [groupRequests, normalizedSearch]);

  const filteredFriendRequests = useMemo(() => {
    if (!normalizedSearch) return friendRequests;
    return friendRequests.filter(({ req }) => {
      const user =
        (req.user && typeof req.user === "object" ? req.user : null) ||
        (req.fromUser && typeof req.fromUser === "object" ? req.fromUser : null) ||
        (req.sender && typeof req.sender === "object" ? req.sender : null) ||
        (req.requester && typeof req.requester === "object" ? req.requester : null) ||
        null;
      const name =
        user?.displayName ||
        user?.fullName ||
        user?.username ||
        "";
      return String(name).toLowerCase().includes(normalizedSearch);
    });
  }, [friendRequests, normalizedSearch]);

  const handleSearchChange = useCallback((event) => {
    setSearchQuery(event.target.value);
  }, []);

  const handleDiscoverGroups = useCallback(() => {
    setActiveTab("groups");
    setShowDiscoverOnly(true);
  }, []);

  const renderGroupItems = useCallback(
    (groups) =>
      groups.map((group, index) => {
        const groupId =
          group.id ||
          group._id ||
          group.groupId ||
          group.group_id ||
          "";
        const groupApiId =
          group.apiId ||
          group.groupId ||
          group.group_id ||
          group._id ||
          "";
        const groupKey = groupId || `group-${index}`;
        const meta = chatMeta[groupId] || {};
        const unreadCount = meta.unreadCount || 0;
        const memberCount = group.memberCount ?? group.members?.length;
        const lastMessageText =
          truncateMessage(resolveMessagePreview(meta.lastMessage)) ||
          "Campus group channel";
        const avatarUrl = group.profilePicUrl || group.avatarUrl || DEFAULT_GROUP_AVATAR;
        const displayName =
          group.displayName || group.name || group.title || group.groupName || "Group";
        const visibility = group.visibility || "public";
        const isMember = group.isMember !== false;
        const isPending = Boolean(group.isPending);
        const joinLoading =
          groupJoinLoadingId && String(groupJoinLoadingId) === String(groupId);
        return (
          <GroupListItem
            key={String(groupKey)}
            groupId={groupId}
            groupApiId={groupApiId}
            avatarUrl={avatarUrl}
            displayName={displayName}
            memberCount={memberCount}
            unreadCount={unreadCount}
            lastMessageText={lastMessageText}
            lastMessageAt={meta.lastMessageAt}
            visibility={visibility}
            isMember={isMember}
            isPending={isPending}
            onOpen={handleOpenChat}
            onRequestJoin={handleRequestJoinGroupFromList}
            joinLoading={joinLoading}
          />
        );
      }),
    [chatMeta, handleOpenChat, handleRequestJoinGroupFromList, groupJoinLoadingId]
  );

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
          <div className="chat-search">
            <i className="fa-solid fa-magnifying-glass chat-search-icon" />
            <input
              type="text"
              placeholder="Search contacts, groups..."
              className="chat-search-input"
              aria-label="Search chats"
              value={searchQuery}
              onChange={handleSearchChange}
              ref={searchInputRef}
            />
          </div>

          <div className="chat-tabs">
            {[
              { key: "contacts", label: "Contacts" },
              { key: "groups", label: "Groups" },
              { key: "requests", label: "Requests" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key);
                  setShowDiscoverOnly(false);
                }}
                className={`chat-tab ${activeTab === tab.key ? "chat-tab-active" : ""}`}
              >
                <span className="flex items-center justify-center gap-2">
                  {tab.label}
                  {tab.key === "groups" && groupUnreadCount > 0 && (
                    <span className="chat-tab-dot" aria-hidden="true" />
                  )}
                </span>
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
                className="h-full overflow-y-auto p-4 space-y-3"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                <div className="chat-filters">
                  {["All", "Alumni", "Same College"].map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setContactFilter(filter)}
                      className={`chat-filter ${
                        filter === contactFilter ? "chat-filter-active" : ""
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                {contactsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((item) => (
                      <div
                        key={`contact-skeleton-${item}`}
                        className="h-16 rounded-2xl bg-white/10 animate-pulse"
                      ></div>
                    ))}
                  </div>
                ) : filteredContactsList.length === 0 ? (
                  <p className="text-center chat-muted mt-10">No contacts yet</p>
                ) : (
                  contactItems
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
                className="h-full overflow-y-auto p-4 space-y-3"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {showDiscoverOnly ? (
                  <>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setShowDiscoverOnly(false)}
                        className="chat-action-secondary text-xs px-4"
                      >
                        Back
                      </button>
                      <p className="text-[11px] uppercase tracking-[0.3em] chat-muted px-1">
                        Explore Public Groups
                      </p>
                    </div>
                    {discoverGroupsLoading ? (
                      <p className="text-center chat-muted text-xs mt-2">
                        Loading public groups...
                      </p>
                    ) : exploreGroups.length === 0 ? (
                      <p className="text-center chat-muted text-xs mt-2">
                        No public groups right now
                      </p>
                    ) : (
                      <div className="space-y-3">{renderGroupItems(exploreGroups)}</div>
                    )}
                  </>
                ) : (
                  <>
                    <div
                      className="chat-discover-card"
                      role="button"
                      tabIndex={0}
                      onClick={handleDiscoverGroups}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          handleDiscoverGroups();
                        }
                      }}
                    >
                      <div>
                        <p className="text-sm font-semibold chat-text">Discover Groups</p>
                        <p className="text-xs chat-muted">
                          Find communities that match your interest
                        </p>
                      </div>
                      <span className="chat-discover-arrow">
                        <i className="fa-solid fa-arrow-right" />
                      </span>
                    </div>
                    {canCreateGroup && (
                      <div className="chat-create-card">
                        <div>
                          <p className="text-xs font-semibold chat-text">Create group</p>
                          <p className="text-[10px] chat-muted">
                            Official or community groups
                          </p>
                        </div>
                        <Motion.button
                          type="button"
                          onClick={() => setShowGroupModal(true)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="chat-icon-button"
                          aria-label="Create group"
                        >
                          <i className="fa-solid fa-plus text-sm"></i>
                        </Motion.button>
                      </div>
                    )}
                    {groupsLoading ? (
                      <p className="text-center chat-muted mt-6">Loading groups...</p>
                    ) : memberGroups.length === 0 ? (
                      <p className="text-center chat-muted mt-10">No groups joined yet</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <p className="text-[11px] uppercase tracking-[0.3em] chat-muted px-1">
                            Your Groups
                          </p>
                          {renderGroupItems(memberGroups)}
                        </div>
                      </div>
                    )}
                  </>
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
                className="h-full overflow-y-auto p-4 space-y-3"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {filteredGroupRequests.length + filteredFriendRequests.length === 0 ? (
                  <p className="text-center chat-muted mt-10">No pending requests</p>
                ) : (
                  <div className="space-y-4">
                    {filteredGroupRequests.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <p className="text-[11px] uppercase tracking-[0.3em] chat-muted">
                            Group Requests
                          </p>
                          <span className="text-[11px] chat-muted">
                            {filteredGroupRequests.length}
                          </span>
                        </div>
                        {filteredGroupRequests.map(({ req, meta }, index) => {
                          const requestUser =
                            (req.user && typeof req.user === "object" ? req.user : null) ||
                            (req.fromUser && typeof req.fromUser === "object"
                              ? req.fromUser
                              : null) ||
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
                          return (
                            <div
                              key={`${requestKey}-group-${index}`}
                              className="chat-request-card"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleOpenProfile(requesterId, requestUser)}
                                  className="flex items-center flex-grow gap-3 text-left"
                                >
                                  <img
                                    src={requestAvatar}
                                    alt={requestDisplayName}
                                    className="chat-avatar chat-avatar-sm"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                  <div className="flex-grow">
                                    <p className="font-semibold text-sm chat-text">
                                      {requestDisplayName}
                                    </p>
                                    <p className="text-xs chat-muted">
                                      Group join request
                                    </p>
                                  </div>
                                </button>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenProfile(requesterId, requestUser)}
                                    className="chat-action-icon"
                                    title="View profile"
                                  >
                                    <i className="fa-solid fa-eye" />
                                  </button>
                                  <span className="text-[10px] chat-muted">
                                    Group Request
                                  </span>
                                </div>
                              </div>
                              {meta.groupName && (
                                <p className="text-[11px] chat-muted">
                                  Group: {meta.groupName}
                                </p>
                              )}
                              <div className="flex gap-2">
                                <Motion.button
                                  onClick={() => handleAcceptRequest(req)}
                                  className="flex-1 chat-action-primary text-xs"
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                >
                                  Accept
                                </Motion.button>
                                <Motion.button
                                  onClick={() => handleIgnoreRequest(req)}
                                  className="flex-1 chat-action-secondary text-xs"
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                >
                                  Ignore
                                </Motion.button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {filteredFriendRequests.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <p className="text-[11px] uppercase tracking-[0.3em] chat-muted">
                            Friend Requests
                          </p>
                          <span className="text-[11px] chat-muted">
                            {filteredFriendRequests.length}
                          </span>
                        </div>
                        {filteredFriendRequests.map(({ req }, index) => {
                          const requestUser =
                            (req.user && typeof req.user === "object" ? req.user : null) ||
                            (req.fromUser && typeof req.fromUser === "object"
                              ? req.fromUser
                              : null) ||
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
                              key={`${requestKey}-friend-${index}`}
                              className="chat-request-card"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleOpenProfile(requesterId, requestUser)}
                                  className="flex items-center flex-grow gap-3 text-left"
                                >
                                  <img
                                    src={requestAvatar}
                                    alt={requestDisplayName}
                                    className="chat-avatar chat-avatar-sm"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                  <div className="flex-grow">
                                    <p className="font-semibold text-sm chat-text">
                                      {requestDisplayName}
                                    </p>
                                    <p className="text-xs chat-muted">
                                      {mutualCount > 0
                                        ? `${mutualCount} mutual friends`
                                        : "No mutual friends"}
                                    </p>
                                  </div>
                                </button>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenProfile(requesterId, requestUser)}
                                    className="chat-action-icon"
                                    title="View profile"
                                  >
                                    <i className="fa-solid fa-eye" />
                                  </button>
                                  <span className="text-[10px] chat-muted">
                                    Friend Request
                                  </span>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Motion.button
                                  onClick={() => handleAcceptRequest(req)}
                                  className="flex-1 chat-action-primary text-xs"
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                >
                                  Accept
                                </Motion.button>
                                <Motion.button
                                  onClick={() => handleIgnoreRequest(req)}
                                  className="flex-1 chat-action-secondary text-xs"
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                >
                                  Ignore
                                </Motion.button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
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
                  {activeChatUser?.isGroup ? (
                    <>
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
                        </p>
                        <p className="text-xs text-[#b9b4c7]">
                          {showTyping ? "Someone is typing..." : "Group channel"}
                        </p>
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenProfile(
                          activeChatUser?.id ||
                            activeChatUser?._id ||
                            activeChatUser?.userId ||
                            activeChatUser?.user_id,
                          activeChatUser
                        )
                      }
                      className="flex items-center gap-3 text-left"
                    >
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
                          {activePresence.isOnline && (
                            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(34,197,94,0.75)]"></span>
                          )}
                        </p>
                        <p className="text-xs text-[#b9b4c7]">
                          {showTyping
                            ? "Typing..."
                            : activePresence.isOnline
                              ? "Online"
                              : formatLastSeen(activePresence.lastSeen)}
                        </p>
                      </div>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {activeChatUser?.isGroup && (
                    <button
                      type="button"
                      onClick={() => setShowGroupProfile(true)}
                      className="h-9 w-9 rounded-full border border-white/10 flex items-center justify-center text-sm text-[#b9b4c7] hover:text-[#faf0e6] transition-colors"
                      title="Group info"
                    >
                      <i className="fa-solid fa-circle-info" />
                    </button>
                  )}
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
                ref={messagesContainerRef}
              >
                <MessageList
                  messages={visibleMessages}
                  currentUserId={currentUserId}
                  isActiveGroupChat={isActiveGroupChat}
                  isDirectChat={isDirectChat}
                  onOpenSharedPost={handleOpenSharedPost}
                  onReport={handleReportMessage}
                  onDelete={handleDeleteMessage}
                  canDeleteMessage={canDeleteMessage}
                  isMobile={isMobile}
                  resolveMessageSender={resolveMessageSender}
                  onOpenProfile={handleOpenProfile}
                  messagesEndRef={messagesEndRef}
                />
              </div>

              <div
                id="chat-input-bar"
                className="flex-shrink-0 z-20 px-4 py-3 min-h-[64px] border-t border-white/10 bg-[#1a120b]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
              >
                {activeChatUser?.isGroup && !isActiveGroupMember && (
                  <div className="mb-3 flex flex-col items-start justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-[#b9b4c7] sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0">
                      {isActiveGroupPending
                        ? "Join request pending approval."
                        : isActiveGroupPrivate
                          ? "Private group. Admins can add members."
                          : "Request access to join this group."}
                    </span>
                    {!isActiveGroupPending && !isActiveGroupPrivate && (
                      <button
                        type="button"
                        onClick={handleRequestJoinGroup}
                        disabled={groupRequestLoading}
                        className="w-full rounded-full bg-[#b9b4c7]/20 px-3 py-1 text-[#faf0e6] hover:bg-[#b9b4c7]/30 transition-colors disabled:opacity-60 sm:w-auto"
                      >
                        {groupRequestLoading ? "Sending..." : "Request Join"}
                      </button>
                    )}
                  </div>
                )}
                {!canChatActive && !activeChatUser?.isGroup && activeChatId && (
                  <div className="mb-3 flex flex-col items-start justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-[#b9b4c7] sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0">Only friends can message.</span>
                    {friendStatus === "none" ? (
                      <button
                        type="button"
                        onClick={handleSendFriendRequest}
                        disabled={friendRequestLoading}
                        className="w-full rounded-full bg-[#b9b4c7]/20 px-3 py-1 text-[#faf0e6] hover:bg-[#b9b4c7]/30 transition-colors disabled:opacity-60 sm:w-auto"
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
                    onChange={(e) => {
                      const value = e.target.value;
                      setMessageText(value);
                      emitTyping(value);
                    }}
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
      <CreateGroupModal
        isOpen={showGroupModal}
        onClose={() => setShowGroupModal(false)}
        onCreated={handleGroupCreated}
      />
      <GroupProfileModal
        isOpen={showGroupProfile && Boolean(activeChatUser?.isGroup)}
        group={activeChatUser}
        onClose={() => setShowGroupProfile(false)}
        onMembershipChange={handleGroupMembershipChange}
        onDeleted={handleGroupDeleted}
      />
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
