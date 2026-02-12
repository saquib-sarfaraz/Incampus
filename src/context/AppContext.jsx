import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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

const resolvePendingRequestUsers = (request) => {
  if (!request) return { fromId: "", toId: "" };
  const fromRaw =
    request.fromUserId ||
    request.from ||
    request.sender ||
    request.requester ||
    request.requestedBy ||
    request.pendingBy ||
    request.user;
  const toRaw =
    request.toUserId ||
    request.to ||
    request.recipient ||
    request.targetUserId ||
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
  const [posts, setPosts] = useState([]);
  const [stories, setStories] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [friendMap, setFriendMap] = useState({});
  const [friendMapLoading, setFriendMapLoading] = useState(false);
  const [friendMapLoaded, setFriendMapLoaded] = useState(false);
  const [usersCache, setUsersCache] = useState({});
  const [loading, setLoading] = useState(false);
  const postsRequestRef = useRef(false);
  const storiesRequestRef = useRef(false);
  const notificationsRequestRef = useRef(false);
  const blockedUsersRequestRef = useRef(false);
  const friendMapRequestRef = useRef(false);
  const [feedScope, setFeedScope] = useState(() => {
    if (typeof window === "undefined") return "universal";
    return localStorage.getItem("feedScope") || "universal";
  });


  const loadPosts = useCallback(async () => {
    if (!authToken || postsRequestRef.current) return;
    postsRequestRef.current = true;
    try {
      setLoading(true);
      const postsData = await fetchPosts();
      setPosts(postsData);
    } catch (error) {
      console.error("Failed to load posts:", error);
    } finally {
      postsRequestRef.current = false;
      setLoading(false);
    }
  }, [authToken]);

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

      const storiesData = await fetchStories(params);
      setStories(normalizeStoriesList(storiesData));
    } catch (error) {
      console.error("Failed to load stories:", error);
    } finally {
      storiesRequestRef.current = false;
    }
  }, [authToken, feedScope, currentUser]);

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
      const notifs = await fetchNotifications();
      setNotifications(notifs);
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      notificationsRequestRef.current = false;
    }
  }, [authToken]);

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

  const setFriendStatus = useCallback(
    (userId, status, options = {}) => {
      if (!userId) return;
      const resolvedStatus = status || "none";
      const force = options.force === true;
      const id = String(userId);
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
    [blockedUsers]
  );

  const getFriendStatus = useCallback(
    (userId) => {
      if (!userId) return "none";
      const id = String(userId);
      if (blockedUsers.some((blockedId) => String(blockedId) === id)) return "blocked";
      if (Object.prototype.hasOwnProperty.call(friendMap, id)) {
        return friendMap[id] || "none";
      }
      const fallbackFriends = currentUser?.friends || [];
      if (fallbackFriends.some((friendId) => String(friendId) === id)) {
        return "friends";
      }
      return "none";
    },
    [blockedUsers, friendMap, currentUser?.friends]
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
        getFriendsList().catch(() => []),
        getPendingRequests().catch(() => []),
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
  }, [authToken, currentUser?.id, applyBlockedToMap]);

  const ensureFriendStatus = useCallback(
    async (userId) => {
      if (!userId) return "none";
      const id = String(userId);
      if (getFriendStatus(id) !== "none") return getFriendStatus(id);
      if (Object.prototype.hasOwnProperty.call(friendMap, id)) {
        return friendMap[id] || "none";
      }
      if (!authToken || !currentUser?.id) return "none";
      try {
        const data = await fetchFriendStatus(id);
        const status = resolveFriendStatus(data, currentUser?.id, id);
        setFriendStatus(id, status, { force: true });
        return status;
      } catch {
        return "none";
      }
    },
    [authToken, currentUser?.id, friendMap, getFriendStatus, setFriendStatus]
  );

  const sendFriendRequest = useCallback(
    async (targetUserId) => {
      if (!targetUserId) return null;
      const res = await apiSendFriendRequest(targetUserId);
      setFriendStatus(targetUserId, "pending_sent", { force: true });
      return res;
    },
    [setFriendStatus]
  );

  const acceptFriend = useCallback(
    async (requesterId) => {
      if (!requesterId) return null;
      const res = await apiAcceptFriendRequest(requesterId);
      setFriendStatus(requesterId, "friends", { force: true });
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

  // Socket listeners setup (after friendship + profile helpers)
  useEffect(() => {
    if (!authToken || !currentUser) return;

    const socket = getSocket();
    if (!socket) return;

    // Chat message listener
    const handleChatMessage = () => {
      // Handled in Chat component
    };

    // Notification listener
    const handleNotification = (notif) => {
      setNotifications((prev) => [notif, ...prev]);
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
      const nextCount =
        typeof payload.likeCount === "number"
          ? payload.likeCount
          : typeof payload.likesCount === "number"
            ? payload.likesCount
            : typeof payload.count === "number"
              ? payload.count
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
      const fromId = resolveEntityId(
        payload.fromUserId ||
          payload.from ||
          payload.requesterId ||
          payload.senderId ||
          payload.userA ||
          payload.user
      );
      const toId = resolveEntityId(
        payload.toUserId ||
          payload.to ||
          payload.targetUserId ||
          payload.recipientId ||
          payload.userB ||
          payload.target
      );
      if (!currentUser?.id) return;
      if (fromId && String(fromId) === String(currentUser.id) && toId) {
        setFriendStatus(toId, "pending_sent", { force: true });
      } else if (toId && String(toId) === String(currentUser.id) && fromId) {
        setFriendStatus(fromId, "pending_received", { force: true });
      }
    };

    const handleFriendAccepted = (payload = {}) => {
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
    socket.on("notification", handleNotification);
    socket.on("comment-added", handleCommentAdded);
    socket.on("post-liked", handlePostLiked);
    socket.on("story-viewed", handleStoryViewed);
    socket.on("friend-requested", handleFriendRequested);
    socket.on("friend-accepted", handleFriendAccepted);
    socket.on("friend-removed", handleFriendRemoved);
    socket.on("friend-blocked", handleFriendBlocked);
    socket.on("user-profile-updated", handleUserProfileUpdated);

    return () => {
      socket.off("chat-message", handleChatMessage);
      socket.off("notification", handleNotification);
      socket.off("comment-added", handleCommentAdded);
      socket.off("post-liked", handlePostLiked);
      socket.off("story-viewed", handleStoryViewed);
      socket.off("friend-requested", handleFriendRequested);
      socket.off("friend-accepted", handleFriendAccepted);
      socket.off("friend-removed", handleFriendRemoved);
      socket.off("friend-blocked", handleFriendBlocked);
      socket.off("user-profile-updated", handleUserProfileUpdated);
    };
  }, [authToken, currentUser, setFriendStatus, updateAuthorProfile]);

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
    loading,
    loadPosts,
    loadStories,
    loadNotifications,
    cacheUser,
    updateCachedUser,
    updateAuthorProfile,
    getUserFromCache,
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

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
