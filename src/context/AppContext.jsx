import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./authContext";
import {
  fetchPosts,
  fetchStories,
  fetchNotifications,
  getBlockedUsers,
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

export const AppProvider = ({ children }) => {
  const { authToken, currentUser, refreshCurrentUser } = useAuth();
  const [posts, setPosts] = useState([]);
  const [stories, setStories] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [usersCache, setUsersCache] = useState({});
  const [loading, setLoading] = useState(false);
  const postsRequestRef = useRef(false);
  const storiesRequestRef = useRef(false);
  const notificationsRequestRef = useRef(false);
  const blockedUsersRequestRef = useRef(false);
  const [feedScope, setFeedScope] = useState(() => {
    if (typeof window === "undefined") return "universal";
    return localStorage.getItem("feedScope") || "universal";
  });

  // Socket listeners setup
  useEffect(() => {
    if (!authToken || !currentUser) return;

    const socket = getSocket();
    if (!socket) return;

    // Chat message listener
    const handleChatMessage = () => {
      // Handle real-time chat messages
      // This will be handled in Chat component
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

    socket.on("chat-message", handleChatMessage);
    socket.on("notification", handleNotification);
    socket.on("comment-added", handleCommentAdded);
    socket.on("post-liked", handlePostLiked);
    socket.on("story-viewed", handleStoryViewed);

    return () => {
      socket.off("chat-message", handleChatMessage);
      socket.off("notification", handleNotification);
      socket.off("comment-added", handleCommentAdded);
      socket.off("post-liked", handlePostLiked);
      socket.off("story-viewed", handleStoryViewed);
    };
  }, [authToken, currentUser]);

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
    }
  }, [authToken, loadPosts, loadStories, loadNotifications, loadBlockedUsers]);

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
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
