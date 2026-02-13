import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./authContext";
import {
  fetchPosts,
  fetchStories,
  fetchNotifications,
  getBlockedUsers,
  getFriendsList,
  getPendingRequests,
  getFriendStatus as fetchFriendStatus,
  sendFriendRequest as apiSendFriendRequest,
  acceptFriendRequest as apiAcceptFriendRequest,
  rejectFriendRequest as apiRejectFriendRequest,
  cancelFriendRequest as apiCancelFriendRequest,
  removeFriend as apiRemoveFriend,
} from "../services/api";
import { getSocket } from "../services/socket";
import AppContext from "./appContextBase";
import ChatToastContainer from "../components/chat/ChatToastContainer";

const CHAT_TOAST_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=U";
const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeStoriesList = (list) => {
  if (!Array.isArray(list)) return [];
  const flat = [];

  list.forEach((entry) => {
    if (Array.isArray(entry?.stories)) {
      const groupAuthor = entry.author || entry.user || entry.owner || entry.profile || {};
      const groupAuthorId =
        entry.authorId ||
        entry.author?._id ||
        entry.author?.id ||
        entry.author ||
        entry.userId ||
        entry.user?._id ||
        entry.user?.id ||
        entry.user ||
        entry.ownerId ||
        entry._id ||
        "";
      const groupName =
        entry.authorDisplayName ||
        entry.authorName ||
        groupAuthor?.displayName ||
        groupAuthor?.fullName ||
        groupAuthor?.username ||
        entry.userName ||
        "";
      const groupAvatar =
        entry.authorProfilePic ||
        entry.authorAvatar ||
        groupAuthor?.profilePicUrl ||
        groupAuthor?.avatar ||
        "";
      const groupCollege =
        entry.college ||
        entry.collegeTagName ||
        entry.university ||
        entry.school ||
        groupAuthor?.college ||
        groupAuthor?.university ||
        groupAuthor?.school ||
        "";
      const groupCollegeId =
        entry.collegeTagId ||
        entry.college_tag_id ||
        entry.collegeId ||
        entry.college_id ||
        groupAuthor?.collegeTagId ||
        groupAuthor?.college_tag_id ||
        "";

      entry.stories.forEach((story) => {
        flat.push({
          ...story,
          authorId:
            story.authorId ||
            story.author?._id ||
            story.author?.id ||
            story.author ||
            groupAuthorId,
          authorDisplayName:
            story.authorDisplayName ||
            story.author?.displayName ||
            story.author?.fullName ||
            story.author?.username ||
            groupName,
          authorProfilePic:
            story.authorProfilePic ||
            story.author?.profilePicUrl ||
            groupAvatar,
          college:
            story.college ||
            story.university ||
            story.school ||
            groupCollege,
          collegeTagName:
            story.collegeTagName ||
            story.college_tag_name ||
            entry.collegeTagName ||
            groupCollege,
          collegeTagId:
            story.collegeTagId ||
            story.college_tag_id ||
            entry.collegeTagId ||
            groupCollegeId,
        });
      });
      return;
    }

    flat.push(entry);
  });

  return flat;
};

const resolveEntityId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(
    value._id ||
      value.id ||
      value.userId ||
      value.user_id ||
      value.profileId ||
      value.ownerId ||
      value.authorId ||
      ""
  );
};

const isMessageNotification = (notif) => {
  if (!notif) return false;
  const type = String(
    notif.type ||
      notif.action ||
      notif.event ||
      notif.kind ||
      notif.notificationType ||
      notif.notification_type ||
      ""
  ).toLowerCase();
  const category = String(
    notif.category || notif.channel || notif.source || ""
  ).toLowerCase();
  const message = String(
    notif.message || notif.text || notif.title || notif.body || ""
  ).toLowerCase();
  return (
    type.includes("message") ||
    type.includes("chat") ||
    category.includes("message") ||
    category.includes("chat") ||
    message.includes("sent you a message") ||
    message.includes("new message") ||
    message.includes("sent you a chat")
  );
};

const resolvePendingRequestUsers = (request) => {
  if (!request) return { fromId: "", toId: "" };
  const fromRaw =
    request.fromUserId ||
    request.fromUser ||
    request.from ||
    request.senderId ||
    request.sender ||
    request.requesterId ||
    request.requester ||
    request.requestedBy ||
    request.pendingBy ||
    request.userA ||
    request.user;
  const toRaw =
    request.toUserId ||
    request.toUser ||
    request.to ||
    request.receiverId ||
    request.recipientId ||
    request.recipient ||
    request.targetUserId ||
    request.targetUser ||
    request.userB ||
    request.userId ||
    request.target;
  return {
    fromId: resolveEntityId(fromRaw),
    toId: resolveEntityId(toRaw),
  };
};

const resolveAuthorIdFromPost = (post) => {
  return resolveEntityId(post?.author || post?.authorId || post?.author?._id || post?.userId);
};

const resolveAuthorIdFromComment = (comment) => {
  return resolveEntityId(
    comment?.author ||
      comment?.authorId ||
      comment?.author?._id ||
      comment?.userId ||
      comment?.user ||
      comment?.owner
  );
};

const resolveAuthorIdFromStory = (story) => {
  return resolveEntityId(story?.authorId || story?.author || story?.author?._id || story?.userId);
};

const mapFriendStatus = (value, currentUserId, targetUserId, payload) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "friends" || normalized === "friend" || normalized === "accepted") {
    return "friends";
  }
  if (normalized === "blocked") return "blocked";
  if (normalized === "pending_sent" || normalized === "sent" || normalized === "requested") {
    return "pending_sent";
  }
  if (normalized === "pending_received" || normalized === "received") {
    return "pending_received";
  }
  if (normalized === "rejected" || normalized === "none") return "none";
  if (normalized === "pending") {
    const pendingBy = resolveEntityId(
      payload?.pendingBy ||
        payload?.pending_by ||
        payload?.requestedBy ||
        payload?.requesterId ||
        payload?.senderId ||
        payload?.fromUserId ||
        payload?.from ||
        payload?.user
    );
    const { fromId, toId } = resolvePendingRequestUsers(payload);
    if (pendingBy && currentUserId) {
      return pendingBy === String(currentUserId) ? "pending_sent" : "pending_received";
    }
    if (currentUserId && fromId && toId) {
      if (String(fromId) === String(currentUserId)) return "pending_sent";
      if (String(toId) === String(currentUserId)) return "pending_received";
    }
    if (currentUserId && targetUserId && fromId) {
      return String(fromId) === String(currentUserId) ? "pending_sent" : "pending_received";
    }
    return "pending_received";
  }
  return "none";
};

const resolveFriendStatus = (payload, currentUserId, targetUserId) => {
  if (!payload) return "none";
  if (typeof payload === "string") {
    return mapFriendStatus(payload, currentUserId, targetUserId, payload);
  }
  if (payload?.isFriend === true || payload?.friends === true) return "friends";
  if (payload?.blocked === true || payload?.isBlocked === true) return "blocked";
  const raw =
    payload.status ||
    payload.friendStatus ||
    payload.relationshipStatus ||
    payload.state ||
    payload.result ||
    payload?.relationship?.status ||
    payload?.data?.status ||
    "";
  return mapFriendStatus(raw, currentUserId, targetUserId, payload);
};

export const AppProvider = ({ children }) => {
  const { authToken, currentUser, refreshCurrentUser } = useAuth();
  const queryClient = useQueryClient();
  const [posts, setPosts] = useState([]);
  const [stories, setStories] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [friendMap, setFriendMap] = useState({});
  const [friendMapLoading, setFriendMapLoading] = useState(false);
  const [friendMapLoaded, setFriendMapLoaded] = useState(false);
  const [pendingSentLocal, setPendingSentLocal] = useState({});
  const [usersCache, setUsersCache] = useState({});
  const [chatMeta, setChatMeta] = useState({});
  const [chatToasts, setChatToasts] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatViewActive, setChatViewActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const postsRequestRef = useRef(false);
  const storiesRequestRef = useRef(false);
  const notificationsRequestRef = useRef(false);
  const blockedUsersRequestRef = useRef(false);
  const postsLoadedRef = useRef(false);
  const friendMapRequestRef = useRef(false);
  const friendStatusRequestRef = useRef(new Map());
  const activeChatIdRef = useRef(null);
  const chatViewActiveRef = useRef(false);
  const seenChatMessagesRef = useRef(new Map());
  const toastDedupeRef = useRef(new Map());
  const [feedScope, setFeedScope] = useState(() => {
    if (typeof window === "undefined") return "universal";
    return localStorage.getItem("feedScope") || "universal";
  });


  const loadPosts = useCallback(async () => {
    if (!authToken || postsRequestRef.current) return;
    postsRequestRef.current = true;
    const showLoading = !postsLoadedRef.current;
    try {
      if (showLoading) {
        setLoading(true);
      }
      const postsData = await queryClient.fetchQuery({
        queryKey: ["posts", authToken],
        queryFn: () => fetchPosts(),
        staleTime: 30000,
      });
      setPosts(postsData);
      postsLoadedRef.current = true;
    } catch (error) {
      console.error("Failed to load posts:", error);
    } finally {
      postsRequestRef.current = false;
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [authToken, queryClient]);

  const loadStories = useCallback(async () => {
    if (!authToken || storiesRequestRef.current) return;
    storiesRequestRef.current = true;
    try {
      const scope = feedScope === "college" ? "college" : "universal";
      const collegeTagName =
        currentUser?.collegeTagName ||
        currentUser?.collegeTag ||
        currentUser?.university ||
        currentUser?.college ||
        currentUser?.school ||
        "";
      const collegeTagId =
        currentUser?.collegeTagId ||
        currentUser?.college_tag_id ||
        currentUser?.collegeTag?._id ||
        "";
      const params = {
        last24h: true,
        scope,
      };
      if (scope === "college") {
        if (collegeTagId) params.collegeTagId = collegeTagId;
        if (collegeTagName) params.collegeTagName = collegeTagName;
      }

      const storiesData = await queryClient.fetchQuery({
        queryKey: [
          "stories",
          authToken,
          scope,
          collegeTagId || "",
          collegeTagName || "",
        ],
        queryFn: () => fetchStories(params),
        staleTime: 30000,
      });
      setStories(normalizeStoriesList(storiesData));
    } catch (error) {
      console.error("Failed to load stories:", error);
    } finally {
      storiesRequestRef.current = false;
    }
  }, [authToken, feedScope, currentUser, queryClient]);

  useEffect(() => {
    if (!authToken || !currentUser) return;
    const socket = getSocket();
    if (!socket) return;

    const handleCollegeUpdated = () => {
      loadPosts();
      loadStories();
      if (refreshCurrentUser) {
        refreshCurrentUser().catch(() => {});
      }
    };

    socket.on("college-updated", handleCollegeUpdated);
    return () => socket.off("college-updated", handleCollegeUpdated);
  }, [authToken, currentUser, loadPosts, loadStories, refreshCurrentUser]);

  const loadNotifications = useCallback(async () => {
    if (!authToken || notificationsRequestRef.current) return;
    notificationsRequestRef.current = true;
    try {
      const notifs = await queryClient.fetchQuery({
        queryKey: ["notifications", authToken],
        queryFn: () => fetchNotifications(),
        staleTime: 15000,
      });
      const list = Array.isArray(notifs) ? notifs : [];
      setNotifications(list.filter((notif) => !isMessageNotification(notif)));
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      notificationsRequestRef.current = false;
    }
  }, [authToken, queryClient]);

  const loadBlockedUsers = useCallback(async () => {
    if (!authToken || blockedUsersRequestRef.current) return;
    blockedUsersRequestRef.current = true;
    try {
      const data = await getBlockedUsers();
      const list = Array.isArray(data) ? data : [];
      const ids = list
        .map((entry) => entry?._id || entry?.id || entry?.userId || entry)
        .filter(Boolean)
        .map((id) => String(id));
      setBlockedUsers(Array.from(new Set(ids)));
    } catch (error) {
      console.error("Failed to load blocked users:", error);
      setBlockedUsers([]);
    } finally {
      blockedUsersRequestRef.current = false;
    }
  }, [authToken]);

  const addBlockedUser = useCallback((userId) => {
    if (!userId) return;
    setBlockedUsers((prev) => {
      const next = new Set(prev.map((id) => String(id)));
      next.add(String(userId));
      return Array.from(next);
    });
  }, []);

  const removeBlockedUser = useCallback((userId) => {
    if (!userId) return;
    setBlockedUsers((prev) => prev.filter((id) => String(id) !== String(userId)));
  }, []);

  const isUserBlocked = useCallback(
    (userId) => {
      if (!userId) return false;
      return blockedUsers.some((id) => String(id) === String(userId));
    },
    [blockedUsers]
  );

  const applyBlockedToMap = useCallback(
    (map) => {
      if (!blockedUsers || blockedUsers.length === 0) return map;
      const next = { ...map };
      blockedUsers.forEach((id) => {
        if (!id) return;
        next[String(id)] = "blocked";
      });
      return next;
    },
    [blockedUsers]
  );

  const setPendingSentOverride = useCallback((userId, value) => {
    if (!userId) return;
    const id = String(userId);
    setPendingSentLocal((prev) => {
      const next = { ...prev };
      if (!value) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return next;
    });
  }, []);

  const setFriendStatus = useCallback(
    (userId, status, options = {}) => {
      if (!userId) return;
      const resolvedStatus = status || "none";
      const force = options.force === true;
      const id = String(userId);
      if (resolvedStatus === "pending_sent") {
        setPendingSentOverride(id, true);
      } else {
        setPendingSentOverride(id, false);
      }
      setFriendMap((prev) => {
        const current = prev[id];
        const isBlocked = blockedUsers.some((blockedId) => String(blockedId) === id);
        if (!force && (current === "blocked" || isBlocked)) {
          if (resolvedStatus === "blocked" && current !== "blocked") {
            return { ...prev, [id]: "blocked" };
          }
          return prev;
        }
        const next = { ...prev };
        if (!resolvedStatus || resolvedStatus === "none") {
          delete next[id];
        } else {
          next[id] = resolvedStatus;
        }
        return next;
      });
    },
    [blockedUsers, setPendingSentOverride]
  );

  const getFriendStatus = useCallback(
    (userId) => {
      if (!userId) return "none";
      const id = String(userId);
      if (blockedUsers.some((blockedId) => String(blockedId) === id)) return "blocked";
      const hasFriendMap = friendMapLoaded || Object.keys(friendMap || {}).length > 0;
      if (hasFriendMap && Object.prototype.hasOwnProperty.call(friendMap, id)) {
        return friendMap[id] || "none";
      }
      if (pendingSentLocal[id]) return "pending_sent";
      if (hasFriendMap) return "none";
      const fallbackFriends = currentUser?.friends || [];
      if (fallbackFriends.some((friendId) => String(friendId) === id)) {
        return "friends";
      }
      return "none";
    },
    [blockedUsers, friendMap, friendMapLoaded, pendingSentLocal, currentUser?.friends]
  );

  const friendIds = useMemo(() => {
    return Object.entries(friendMap)
      .filter(([, status]) => status === "friends")
      .map(([id]) => id);
  }, [friendMap]);

  const friendIdSet = useMemo(() => new Set(friendIds), [friendIds]);

  const isFriend = useCallback((userId) => getFriendStatus(userId) === "friends", [
    getFriendStatus,
  ]);

  const canChat = useCallback((userId) => getFriendStatus(userId) === "friends", [
    getFriendStatus,
  ]);

  const canViewFriendStory = useCallback(
    (userId) => getFriendStatus(userId) === "friends",
    [getFriendStatus]
  );

  const canViewPrivatePost = useCallback(
    (userId) => getFriendStatus(userId) === "friends",
    [getFriendStatus]
  );

  const refreshFriendMap = useCallback(async () => {
    if (!authToken || !currentUser?.id || friendMapRequestRef.current) return;
    friendMapRequestRef.current = true;
    setFriendMapLoading(true);
    try {
      const [friendsData, pendingData] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ["friends", authToken],
          queryFn: () => getFriendsList().catch(() => []),
          staleTime: 30000,
        }),
        queryClient.fetchQuery({
          queryKey: ["friend-requests", authToken],
          queryFn: () => getPendingRequests().catch(() => []),
          staleTime: 15000,
        }),
      ]);
      const nextMap = {};
      (Array.isArray(friendsData) ? friendsData : []).forEach((friend) => {
        const id = resolveEntityId(friend);
        if (id) nextMap[id] = "friends";
      });
      (Array.isArray(pendingData) ? pendingData : []).forEach((request) => {
        const { fromId, toId } = resolvePendingRequestUsers(request);
        let targetId = "";
        let status = "pending_received";
        if (currentUser?.id && fromId && String(fromId) === String(currentUser.id)) {
          targetId = toId;
          status = "pending_sent";
        } else if (currentUser?.id && toId && String(toId) === String(currentUser.id)) {
          targetId = fromId;
          status = "pending_received";
        } else {
          const fallbackId = resolveEntityId(
            request?.user ||
              request?.requester ||
              request?.sender ||
              request?.fromUserId ||
              request?.toUserId ||
              request?.userId
          );
          if (fallbackId && fallbackId !== String(currentUser?.id || "")) {
            targetId = fallbackId;
            status = resolveFriendStatus(request, currentUser?.id, fallbackId);
            if (status === "none") status = "pending_received";
          }
        }
        if (!targetId) return;
        if (nextMap[targetId] !== "friends") {
          nextMap[targetId] = status;
        }
      });
      setFriendMap(applyBlockedToMap(nextMap));
      setFriendMapLoaded(true);
    } catch (error) {
      console.error("Failed to load friend map:", error);
    } finally {
      friendMapRequestRef.current = false;
      setFriendMapLoading(false);
    }
  }, [authToken, currentUser?.id, applyBlockedToMap, queryClient]);

  const ensureFriendStatus = useCallback(
    async (userId) => {
      if (!userId) return "none";
      const id = String(userId);
      if (getFriendStatus(id) !== "none") return getFriendStatus(id);
      if (Object.prototype.hasOwnProperty.call(friendMap, id)) {
        return friendMap[id] || "none";
      }
      const pendingRequest = friendStatusRequestRef.current.get(id);
      if (pendingRequest) return pendingRequest;
      if (!authToken || !currentUser?.id) return "none";
      const request = (async () => {
        try {
          const data = await fetchFriendStatus(id);
          const status = resolveFriendStatus(data, currentUser?.id, id);
          setFriendStatus(id, status, { force: true });
          return status;
        } catch {
          return "none";
        } finally {
          friendStatusRequestRef.current.delete(id);
        }
      })();
      friendStatusRequestRef.current.set(id, request);
      return request;
    },
    [authToken, currentUser?.id, friendMap, getFriendStatus, setFriendStatus]
  );

  const sendFriendRequest = useCallback(
    async (targetUserId) => {
      if (!targetUserId) return null;
      setFriendStatus(targetUserId, "pending_sent", { force: true });
      try {
        const res = await apiSendFriendRequest(targetUserId);
        return res;
      } catch (error) {
        setFriendStatus(targetUserId, "none", { force: true });
        throw error;
      }
    },
    [setFriendStatus]
  );

  const acceptFriend = useCallback(
    async (requestPayload) => {
      if (!requestPayload) return null;
      const requesterId = resolveEntityId(
        typeof requestPayload === "object"
          ? requestPayload.requesterId ||
              requestPayload.senderId ||
              requestPayload.fromUserId ||
              requestPayload.userId ||
              requestPayload.user?.id ||
              requestPayload.user?._id ||
              requestPayload.requester ||
              requestPayload.fromUser
          : requestPayload
      );
      const requestId =
        typeof requestPayload === "object"
          ? requestPayload.requestId ||
            requestPayload._id ||
            requestPayload.id ||
            null
          : null;
      const res = await apiAcceptFriendRequest(
        typeof requestPayload === "object"
          ? { requesterId, requestId }
          : requesterId
      );
      if (requesterId) {
        setFriendStatus(requesterId, "friends", { force: true });
      }
      return res;
    },
    [setFriendStatus]
  );

  const rejectFriend = useCallback(
    async (requesterId) => {
      if (!requesterId) return null;
      const res = await apiRejectFriendRequest(requesterId);
      setFriendStatus(requesterId, "none", { force: true });
      return res;
    },
    [setFriendStatus]
  );

  const cancelFriend = useCallback(
    async (recipientId) => {
      if (!recipientId) return null;
      const res = await apiCancelFriendRequest(recipientId);
      setFriendStatus(recipientId, "none", { force: true });
      return res;
    },
    [setFriendStatus]
  );

  const removeFriend = useCallback(
    async (friendId) => {
      if (!friendId) return null;
      const res = await apiRemoveFriend(friendId);
      setFriendStatus(friendId, "none", { force: true });
      return res;
    },
    [setFriendStatus]
  );

  const cacheUser = useCallback((userData) => {
    if (!userData || !userData._id) return;
    setUsersCache((prev) => ({
      ...prev,
      [userData._id]: {
        id: userData._id,
        name: userData.fullName,
        displayName: userData.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
        profilePicUrl: userData.profilePicUrl,
        username: userData.username,
        isVerified: Boolean(userData?.isVerified),
      },
    }));
  }, []);

  const getUserFromCache = useCallback(
    (userId) => {
      return usersCache[userId] || null;
    },
    [usersCache]
  );

  const updateCachedUser = useCallback((userId, updates = {}) => {
    if (!userId) return;
    const id = String(userId);
    const displayName =
      updates.displayName || updates.fullName || updates.communityName || updates.name;
    setUsersCache((prev) => {
      const current = prev[id] || { id };
      return {
        ...prev,
        [id]: {
          ...current,
          ...(displayName ? { displayName } : {}),
          ...(updates.fullName ? { name: updates.fullName, fullName: updates.fullName } : {}),
          ...(updates.profilePicUrl ? { profilePicUrl: updates.profilePicUrl } : {}),
          ...(updates.bio !== undefined ? { bio: updates.bio } : {}),
          ...(updates.isVerified !== undefined
            ? { isVerified: Boolean(updates.isVerified) }
            : {}),
          ...(updates.communityDescription !== undefined
            ? { communityDescription: updates.communityDescription }
            : {}),
        },
      };
    });
  }, []);

  const updateAuthorProfile = useCallback(
    (userId, updates = {}) => {
      if (!userId) return;
      const id = String(userId);
      const displayName =
        updates.displayName || updates.fullName || updates.communityName || updates.name;

      updateCachedUser(id, updates);

      setPosts((prev) =>
        prev.map((post) => {
          const authorId = resolveAuthorIdFromPost(post);
          if (!authorId || String(authorId) !== id) {
            if (!Array.isArray(post?.comments)) return post;
            let hasCommentUpdate = false;
            const nextComments = post.comments.map((comment) => {
              const commentAuthorId = resolveAuthorIdFromComment(comment);
              if (!commentAuthorId || String(commentAuthorId) !== id) return comment;
              hasCommentUpdate = true;
              const updatedComment = { ...comment };
              if (displayName) {
                updatedComment.authorName = displayName;
                updatedComment.authorDisplayName = displayName;
                updatedComment.userName = displayName;
              }
              if (updatedComment.author && typeof updatedComment.author === "object") {
                updatedComment.author = {
                  ...updatedComment.author,
                  ...(displayName ? { displayName, fullName: displayName } : {}),
                  ...(updates.fullName ? { fullName: updates.fullName } : {}),
                  ...(updates.bio !== undefined ? { bio: updates.bio } : {}),
                };
              }
              return updatedComment;
            });
            if (!hasCommentUpdate) return post;
            return { ...post, comments: nextComments };
          }

          const updatedPost = { ...post };
          if (displayName) {
            updatedPost.authorDisplayName = displayName;
            updatedPost.authorName = displayName;
            updatedPost.authorFullName = displayName;
            updatedPost.authorFullname = displayName;
          }
          if (updatedPost.author && typeof updatedPost.author === "object") {
            updatedPost.author = {
              ...updatedPost.author,
              ...(displayName ? { displayName, fullName: displayName } : {}),
              ...(updates.fullName ? { fullName: updates.fullName } : {}),
              ...(updates.bio !== undefined ? { bio: updates.bio } : {}),
              ...(updates.communityName ? { communityName: updates.communityName } : {}),
              ...(updates.communityDescription !== undefined
                ? { communityDescription: updates.communityDescription }
                : {}),
            };
          }
          if (Array.isArray(updatedPost.comments)) {
            let hasCommentUpdate = false;
            updatedPost.comments = updatedPost.comments.map((comment) => {
              const commentAuthorId = resolveAuthorIdFromComment(comment);
              if (!commentAuthorId || String(commentAuthorId) !== id) return comment;
              hasCommentUpdate = true;
              const updatedComment = { ...comment };
              if (displayName) {
                updatedComment.authorName = displayName;
                updatedComment.authorDisplayName = displayName;
                updatedComment.userName = displayName;
              }
              if (updatedComment.author && typeof updatedComment.author === "object") {
                updatedComment.author = {
                  ...updatedComment.author,
                  ...(displayName ? { displayName, fullName: displayName } : {}),
                  ...(updates.fullName ? { fullName: updates.fullName } : {}),
                  ...(updates.bio !== undefined ? { bio: updates.bio } : {}),
                };
              }
              return updatedComment;
            });
            if (!hasCommentUpdate) {
              updatedPost.comments = post.comments;
            }
          }
          return updatedPost;
        })
      );

      setStories((prev) =>
        prev.map((story) => {
          const authorId = resolveAuthorIdFromStory(story);
          if (!authorId || String(authorId) !== id) return story;
          const updatedStory = { ...story };
          if (displayName) {
            updatedStory.authorDisplayName = displayName;
            updatedStory.authorName = displayName;
            updatedStory.authorFullName = displayName;
          }
          if (updatedStory.author && typeof updatedStory.author === "object") {
            updatedStory.author = {
              ...updatedStory.author,
              ...(displayName ? { displayName, fullName: displayName } : {}),
              ...(updates.fullName ? { fullName: updates.fullName } : {}),
              ...(updates.bio !== undefined ? { bio: updates.bio } : {}),
            };
          }
          return updatedStory;
        })
      );
    },
    [updateCachedUser]
  );

  const resolveMessagePreview = useCallback((msg) => {
    if (!msg) return "";
    if (msg.messageType === "shared_post" || msg.type === "shared_post") {
      return msg.postPreviewText || msg.postTitle || "Shared a post";
    }
    return msg.text || "";
  }, []);

  const truncateMessage = useCallback((text = "", max = 60) => {
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }, []);

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

  const updateChatMeta = useCallback(
    (chatId, message, { incrementUnread, unreadCount } = {}) => {
      if (!chatId || !message) return;
      const createdAt =
        message.createdAt ||
        message.created_at ||
        message.timestamp ||
        new Date().toISOString();
      setChatMeta((prev) => {
        const current = prev[chatId] || { unreadCount: 0 };
        const resolvedUnread =
          typeof unreadCount === "number"
            ? unreadCount
            : incrementUnread
              ? (current.unreadCount || 0) + 1
              : current.unreadCount || 0;
        const currentTime = new Date(current.lastMessageAt || 0).getTime();
        const nextTime = new Date(createdAt || 0).getTime();
        const shouldUpdateMessage = Number.isNaN(currentTime) || nextTime >= currentTime;
        return {
          ...prev,
          [chatId]: {
            ...current,
            ...(shouldUpdateMessage
              ? { lastMessage: message, lastMessageAt: createdAt }
              : {}),
            unreadCount: resolvedUnread,
          },
        };
      });
    },
    []
  );

  const setChatMetaEntry = useCallback((chatId, updater) => {
    if (!chatId) return;
    setChatMeta((prev) => {
      const current = prev[chatId] || { unreadCount: 0 };
      const nextValue =
        typeof updater === "function" ? updater(current) : { ...current, ...updater };
      if (!nextValue) {
        const copy = { ...prev };
        delete copy[chatId];
        return copy;
      }
      return {
        ...prev,
        [chatId]: {
          unreadCount: 0,
          ...nextValue,
        },
      };
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setChatMeta((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([chatId, meta]) => {
          const last = meta?.lastMessage;
          const lastAt = last?.expiresAt || meta?.lastMessageAt;
          if (!lastAt) return;
          const lastTime = new Date(lastAt).getTime();
          if (Number.isNaN(lastTime)) return;
          if (now - lastTime < DAY_MS) return;
          changed = true;
          next[chatId] = {
            ...meta,
            lastMessage: null,
            lastMessageAt: null,
            unreadCount: 0,
          };
        });
        return changed ? next : prev;
      });
    }, 60000);

    return () => clearInterval(interval);
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

  const pushChatToast = useCallback((toast) => {
    if (!toast || !toast.id) return;
    const key =
      toast.dedupeKey ||
      `${toast.chatId || "toast"}|${toast.title || ""}|${toast.message || ""}`;
    if (key) {
      const now = Date.now();
      const lastSeen = toastDedupeRef.current.get(key);
      if (lastSeen && now - lastSeen < 8000) return;
      toastDedupeRef.current.set(key, now);
      if (toastDedupeRef.current.size > 300) {
        const entries = Array.from(toastDedupeRef.current.entries());
        entries
          .sort((a, b) => a[1] - b[1])
          .slice(0, 150)
          .forEach(([oldKey]) => toastDedupeRef.current.delete(oldKey));
      }
    }
    setChatToasts((prev) =>
      prev.some((item) => item.id === toast.id) ? prev : [...prev, toast]
    );
    setTimeout(() => {
      setChatToasts((prev) => prev.filter((item) => item.id !== toast.id));
    }, 3000);
  }, []);

  const dismissChatToast = useCallback((toastId) => {
    if (!toastId) return;
    setChatToasts((prev) => prev.filter((item) => item.id !== toastId));
  }, []);

  const requestChatOpen = useCallback(
    (chatId) => {
      if (!chatId) return;
      setActiveChatId(chatId);
    },
    [setActiveChatId]
  );

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    chatViewActiveRef.current = chatViewActive;
  }, [chatViewActive]);

  const chatUnreadTotal = useMemo(() => {
    return Object.values(chatMeta).reduce(
      (sum, meta) => sum + (meta?.unreadCount || 0),
      0
    );
  }, [chatMeta]);

  // Socket listeners setup (after friendship + profile helpers)
  useEffect(() => {
    if (!authToken || !currentUser) return;

    const socket = getSocket();
    if (!socket) return;

    // Chat message listener
    const handleChatMessage = (payload = {}) => {
      const message = payload?.message || payload;
      if (!message) return;
      const chatId = resolveChatIdFromMessage(message);
      if (!chatId) return;
      const dedupeKey =
        message._id ||
        message.id ||
        `${chatId}-${message.createdAt || message.timestamp || ""}-${resolveEntityId(
          message.from || message.senderId || message.userId || message.sender
        )}-${message.text || message.postId || message.messageType || ""}`;
      if (dedupeKey) {
        const now = Date.now();
        const seenAt = seenChatMessagesRef.current.get(dedupeKey);
        if (seenAt && now - seenAt < 5000) return;
        seenChatMessagesRef.current.set(dedupeKey, now);
        if (seenChatMessagesRef.current.size > 500) {
          const entries = Array.from(seenChatMessagesRef.current.entries());
          entries
            .sort((a, b) => a[1] - b[1])
            .slice(0, 200)
            .forEach(([key]) => seenChatMessagesRef.current.delete(key));
        }
      }

      const senderId = resolveEntityId(
        message.from || message.senderId || message.userId || message.sender
      );
      const isFromSelf =
        senderId && currentUser?.id && String(senderId) === String(currentUser.id);

      const isActiveChat =
        chatViewActiveRef.current && activeChatIdRef.current === chatId;

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
    };

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
      const expiredCreated =
        message?.createdAt || message?.created_at || message?.timestamp || payload.createdAt;
      const expiredCount = expiredIds.size || (payload.messageIds?.length || 0) || 1;

      setChatMetaEntry(chatId, (current) => {
        if (!current) return current;
        const last = current.lastMessage;
        if (!last) {
          return { ...current, lastMessage: null, lastMessageAt: null, unreadCount: 0 };
        }
        const lastId = last._id || last.id;
        const lastCreated = last.createdAt || last.created_at || last.timestamp;
        const idMatches =
          lastId && expiredIds.size > 0 && expiredIds.has(String(lastId));
        const timeMatches =
          !idMatches &&
          expiredCreated &&
          lastCreated &&
          new Date(expiredCreated).getTime() === new Date(lastCreated).getTime();
        const shouldClear = idMatches || timeMatches;
        const nextUnread = Math.max((current.unreadCount || 0) - expiredCount, 0);
        if (!shouldClear && nextUnread === current.unreadCount) return current;
        return {
          ...current,
          ...(shouldClear ? { lastMessage: null, lastMessageAt: null } : {}),
          unreadCount: shouldClear ? 0 : nextUnread,
        };
      });
    };

    // Notification listener
    const handleNotification = (notif) => {
      if (!isMessageNotification(notif)) {
        setNotifications((prev) => [notif, ...prev]);
      }
    };

    const handleCommentAdded = (payload = {}) => {
      const postId = payload.postId || payload.post?._id || payload.post?.id || payload.postId;
      if (!postId) return;
      const nextCount =
        typeof payload.count === "number"
          ? payload.count
          : typeof payload.commentCount === "number"
            ? payload.commentCount
            : typeof payload.commentsCount === "number"
              ? payload.commentsCount
              : null;
      setPosts((prev) =>
        prev.map((post) => {
          const currentId = post?._id || post?.id;
          if (String(currentId) !== String(postId)) return post;
          const currentCount = Number(
            post.commentCount ||
              post.commentsCount ||
              (Array.isArray(post.comments) ? post.comments.length : 0) ||
              0
          );
          const resolvedCount = nextCount ?? currentCount + 1;
          return {
            ...post,
            commentCount: resolvedCount,
            commentsCount: resolvedCount,
          };
        })
      );
    };

    const handlePostLiked = (payload = {}) => {
      const postId = payload.postId || payload.post?._id || payload.post?.id || payload.postId;
      if (!postId) return;
      const likedByRaw =
        payload.likedBy ||
        payload.likes ||
        payload.post?.likedBy ||
        payload.post?.likes ||
        payload.data?.likedBy ||
        payload.data?.likes ||
        null;
      const likedBy = Array.isArray(likedByRaw)
        ? likedByRaw.map((like) =>
            String(
              like?._id ||
                like?.id ||
                like?.userId ||
                like?.user ||
                like?.authorId ||
                like?.author ||
                like ||
                ""
            )
          ).filter(Boolean)
        : null;
      const nextCount =
        typeof payload.likeCount === "number"
          ? payload.likeCount
          : typeof payload.likesCount === "number"
            ? payload.likesCount
            : typeof payload.count === "number"
              ? payload.count
              : Array.isArray(likedBy)
                ? likedBy.length
              : null;
      setPosts((prev) =>
        prev.map((post) => {
          const currentId = post?._id || post?.id;
          if (String(currentId) !== String(postId)) return post;
          const baseLikes = Array.isArray(post.likes) ? post.likes : [];
          const currentCount = Number(
            post.likeCount || post.likesCount || baseLikes.length || 0
          );
          const resolvedCount = nextCount ?? currentCount;
          return {
            ...post,
            ...(likedBy ? { likes: likedBy, likedBy } : {}),
            likeCount: resolvedCount,
            likesCount: resolvedCount,
          };
        })
      );
    };

    const handleStoryViewed = (payload = {}) => {
      const storyId =
        payload.storyId ||
        payload.story?._id ||
        payload.story?.id ||
        payload.story?.storyId ||
        payload.story_id ||
        payload.id;
      if (!storyId) return;

      const nextCount =
        typeof payload.viewCount === "number"
          ? payload.viewCount
          : typeof payload.viewsCount === "number"
            ? payload.viewsCount
            : typeof payload.count === "number"
              ? payload.count
              : null;

      setStories((prev) =>
        prev.map((story) => {
          const currentId =
            story?._id || story?.id || story?.storyId || story?.story_id || "";
          if (String(currentId) !== String(storyId)) return story;
          const baseViews = Array.isArray(story.views) ? story.views : [];
          const currentCount = Number(
            story.viewCount || story.viewsCount || baseViews.length || 0
          );
          const resolvedCount =
            nextCount ?? (payload.isNew === false ? currentCount : currentCount + 1);
          return {
            ...story,
            viewCount: resolvedCount,
            viewsCount: resolvedCount,
          };
        })
      );
    };

    const handleFriendRequested = (payload = {}) => {
      const requestPayload = payload.request || payload;
      const fromId = resolveEntityId(
        requestPayload.fromUserId ||
          requestPayload.fromUser ||
          requestPayload.from ||
          requestPayload.requesterId ||
          requestPayload.senderId ||
          requestPayload.userA ||
          requestPayload.user
      );
      const toId = resolveEntityId(
        requestPayload.toUserId ||
          requestPayload.toUser ||
          requestPayload.to ||
          requestPayload.targetUserId ||
          requestPayload.recipientId ||
          requestPayload.userB ||
          requestPayload.target
      );
      if (!currentUser?.id) return;
      if (fromId && String(fromId) === String(currentUser.id) && toId) {
        setFriendStatus(toId, "pending_sent", { force: true });
      } else if (toId && String(toId) === String(currentUser.id) && fromId) {
        setFriendStatus(fromId, "pending_received", { force: true });
      }
    };

    const handleFriendAccepted = (payload = {}) => {
      if (payload?.userId && currentUser?.id) {
        const otherId = resolveEntityId(payload.userId);
        if (otherId && String(otherId) !== String(currentUser.id)) {
          setFriendStatus(otherId, "friends", { force: true });
          refreshFriendMap();
          return;
        }
      }
      const userA = resolveEntityId(
        payload.userA ||
          payload.userAId ||
          payload.requesterId ||
          payload.fromUserId ||
          payload.from
      );
      const userB = resolveEntityId(
        payload.userB ||
          payload.userBId ||
          payload.targetUserId ||
          payload.toUserId ||
          payload.to
      );
      if (!currentUser?.id) return;
      const otherId =
        userA && String(userA) === String(currentUser.id)
          ? userB
          : userB && String(userB) === String(currentUser.id)
            ? userA
            : "";
      if (otherId) {
        setFriendStatus(otherId, "friends", { force: true });
        refreshFriendMap();
      }
    };

    const handleFriendRemoved = (payload = {}) => {
      const userA = resolveEntityId(payload.userA || payload.userAId || payload.userId);
      const userB = resolveEntityId(payload.userB || payload.userBId || payload.targetUserId);
      if (!currentUser?.id) return;
      const otherId =
        userA && String(userA) === String(currentUser.id)
          ? userB
          : userB && String(userB) === String(currentUser.id)
            ? userA
            : resolveEntityId(payload.otherUserId || payload.other || payload.user);
      if (otherId) {
        setFriendStatus(otherId, "none", { force: true });
      }
    };

    const handleFriendBlocked = (payload = {}) => {
      const blockerId = resolveEntityId(payload.blockerId || payload.blockedBy || payload.userA);
      const blockedId = resolveEntityId(payload.blockedId || payload.targetUserId || payload.userB);
      if (!currentUser?.id) return;
      const otherId =
        blockerId && String(blockerId) === String(currentUser.id)
          ? blockedId
          : blockedId && String(blockedId) === String(currentUser.id)
            ? blockerId
            : resolveEntityId(payload.userId || payload.otherUserId);
      if (otherId) {
        setFriendStatus(otherId, "blocked", { force: true });
      }
    };

    const handleUserProfileUpdated = (payload = {}) => {
      const userId = resolveEntityId(payload.userId || payload.id || payload.user || payload._id);
      if (!userId) return;
      const updates = {
        fullName: payload.fullName || payload.name || payload.displayName,
        displayName: payload.displayName || payload.fullName || payload.name,
        bio: payload.bio,
        communityName: payload.communityName,
        communityDescription: payload.communityDescription,
      };
      updateAuthorProfile(userId, updates);
    };

    socket.on("chat-message", handleChatMessage);
    socket.on("chat:newMessage", handleChatMessage);
    socket.on("chat:messageSent", handleChatMessage);
    socket.on("chat:newMessagePopup", handleChatMessage);
    socket.on("notification", handleNotification);
    socket.on("comment-added", handleCommentAdded);
    socket.on("post-liked", handlePostLiked);
    socket.on("post-like-updated", handlePostLiked);
    socket.on("story-viewed", handleStoryViewed);
    socket.on("friend-requested", handleFriendRequested);
    socket.on("friend-request-received", handleFriendRequested);
    socket.on("friend_request_received", handleFriendRequested);
    socket.on("friend-accepted", handleFriendAccepted);
    socket.on("friend_request_accepted", handleFriendAccepted);
    socket.on("friendRequestAccepted", handleFriendAccepted);
    socket.on("friendRequestsUpdated", handleFriendRequested);
    socket.on("friend_list_updated", refreshFriendMap);
    socket.on("friendsListUpdated", refreshFriendMap);
    socket.on("chatUnlocked", handleFriendAccepted);
    socket.on("friend-removed", handleFriendRemoved);
    socket.on("friend-blocked", handleFriendBlocked);
    socket.on("user-profile-updated", handleUserProfileUpdated);
    socket.on("message-expired", handleMessageExpired);

    return () => {
      socket.off("chat-message", handleChatMessage);
      socket.off("chat:newMessage", handleChatMessage);
      socket.off("chat:messageSent", handleChatMessage);
      socket.off("chat:newMessagePopup", handleChatMessage);
      socket.off("notification", handleNotification);
      socket.off("comment-added", handleCommentAdded);
      socket.off("post-liked", handlePostLiked);
      socket.off("post-like-updated", handlePostLiked);
      socket.off("story-viewed", handleStoryViewed);
      socket.off("friend-requested", handleFriendRequested);
      socket.off("friend-request-received", handleFriendRequested);
      socket.off("friend_request_received", handleFriendRequested);
      socket.off("friend-accepted", handleFriendAccepted);
      socket.off("friend_request_accepted", handleFriendAccepted);
      socket.off("friendRequestAccepted", handleFriendAccepted);
      socket.off("friendRequestsUpdated", handleFriendRequested);
      socket.off("friend_list_updated", refreshFriendMap);
      socket.off("friendsListUpdated", refreshFriendMap);
      socket.off("chatUnlocked", handleFriendAccepted);
      socket.off("friend-removed", handleFriendRemoved);
      socket.off("friend-blocked", handleFriendBlocked);
      socket.off("user-profile-updated", handleUserProfileUpdated);
      socket.off("message-expired", handleMessageExpired);
    };
  }, [
    authToken,
    currentUser,
    setFriendStatus,
    updateAuthorProfile,
    resolveChatIdFromMessage,
    updateChatMeta,
    setChatMetaEntry,
    getUserFromCache,
    truncateMessage,
    resolveMessagePreview,
    pushChatToast,
    refreshFriendMap,
  ]);

  const updatePost = useCallback((postId, updates) => {
    setPosts((prev) =>
      prev.map((p) => (p._id === postId ? { ...p, ...updates } : p))
    );
  }, []);

  const addPost = useCallback((newPost) => {
    setPosts((prev) => [newPost, ...prev]);
  }, []);

  const removePost = useCallback((postId) => {
    setPosts((prev) => prev.filter((p) => p._id !== postId));
  }, []);

  const addStory = useCallback((newStory) => {
    setStories((prev) => [...prev, newStory]);
  }, []);

  const removeStory = useCallback((storyId) => {
    setStories((prev) => prev.filter((s) => s._id !== storyId));
  }, []);

  useEffect(() => {
    if (authToken) {
      loadPosts();
      loadStories();
      loadNotifications();
      loadBlockedUsers();
      if (currentUser?.id) {
        refreshFriendMap();
      }
    } else {
      setFriendMap({});
      setFriendMapLoaded(false);
      setPendingSentLocal({});
    }
  }, [
    authToken,
    currentUser?.id,
    loadPosts,
    loadStories,
    loadNotifications,
    loadBlockedUsers,
    refreshFriendMap,
  ]);

  useEffect(() => {
    if (!blockedUsers || blockedUsers.length === 0) return;
    setFriendMap((prev) => applyBlockedToMap(prev));
  }, [blockedUsers, applyBlockedToMap]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("feedScope", feedScope);
  }, [feedScope]);

  const value = {
    posts,
    stories,
    notifications,
    usersCache,
    chatMeta,
    chatToasts,
    chatUnreadTotal,
    activeChatId,
    chatViewActive,
    loading,
    loadPosts,
    loadStories,
    loadNotifications,
    cacheUser,
    updateCachedUser,
    updateAuthorProfile,
    getUserFromCache,
    updateChatMeta,
    setChatMetaEntry,
    markChatRead,
    setActiveChatId,
    setChatViewActive,
    requestChatOpen,
    pushChatToast,
    dismissChatToast,
    updatePost,
    addPost,
    removePost,
    addStory,
    removeStory,
    setNotifications,
    feedScope,
    setFeedScope,
    blockedUsers,
    loadBlockedUsers,
    addBlockedUser,
    removeBlockedUser,
    isUserBlocked,
    friendMap,
    friendMapLoading,
    friendMapLoaded,
    friendIds,
    friendIdSet,
    refreshFriendMap,
    ensureFriendStatus,
    getFriendStatus,
    setFriendStatus,
    sendFriendRequest,
    acceptFriend,
    rejectFriend,
    cancelFriend,
    removeFriend,
    isFriend,
    canChat,
    canViewFriendStory,
    canViewPrivatePost,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <ChatToastContainer />
    </AppContext.Provider>
  );
};
