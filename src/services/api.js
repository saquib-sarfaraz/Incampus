const normalizeBaseUrl = (base) => {
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
};

const isAbsoluteUrl = (value) => /^https?:\/\//i.test(value);

const API_PREFIX = "/api";
const RAW_API_BASE_URL = import.meta.env.VITE_API_URL || "";
const API_BASE_URL = normalizeBaseUrl(RAW_API_BASE_URL) || API_PREFIX;
const API_BASE_HAS_PREFIX = API_BASE_URL.endsWith(API_PREFIX);

const resolveApiPath = (path) => {
  if (!path) {
    return API_BASE_HAS_PREFIX ? "/" : API_PREFIX;
  }
  if (isAbsoluteUrl(path)) return path;

  const normalized = path.startsWith("/") ? path : `/${path}`;

  if (API_BASE_HAS_PREFIX) {
    if (normalized === API_PREFIX) return "/";
    if (normalized.startsWith(`${API_PREFIX}/`)) {
      return normalized.slice(API_PREFIX.length);
    }
    return normalized;
  }

  if (normalized === API_PREFIX || normalized.startsWith(`${API_PREFIX}/`)) {
    return normalized;
  }
  return `${API_PREFIX}${normalized}`;
};

const buildUrl = (path, params) => {
  const resolvedPath = resolveApiPath(path);
  const rawUrl = isAbsoluteUrl(resolvedPath)
    ? resolvedPath
    : `${API_BASE_URL}${resolvedPath}`;
  const url = new URL(rawUrl, window.location.origin);

  if (params && typeof params === "object") {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry !== undefined && entry !== null && entry !== "") {
            url.searchParams.append(key, String(entry));
          }
        });
      } else {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url.toString();
};

const readAuthToken = () => {
  const raw =
    localStorage.getItem("authToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("accessToken");
  if (!raw) return null;
  return raw.startsWith("Bearer ") ? raw.slice(7) : raw;
};

const parseResponse = async (res) => {
  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
};

const resolveErrorMessage = (data, status) => {
  if (!data) return `Request failed (${status})`;
  if (typeof data === "string") return data;
  return data.message || data.error || data.details || `Request failed (${status})`;
};

const apiFetch = async (path, options = {}) => {
  const {
    method = "GET",
    params,
    body,
    headers = {},
    auth = true,
    isFormData = false,
  } = options;

  if (!API_BASE_URL) {
    throw new Error("VITE_API_URL is not configured.");
  }

  const finalHeaders = { ...headers };
  if (auth) {
    const authToken = readAuthToken();
    if (authToken) {
      finalHeaders.Authorization = `Bearer ${authToken}`;
    }
  }

  const isBodyFormData = body instanceof FormData;
  if (!isFormData && !isBodyFormData && body !== undefined && body !== null) {
    finalHeaders["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(buildUrl(path, params), {
      method,
      headers: finalHeaders,
      body:
        body === undefined || body === null
          ? undefined
          : isFormData || isBodyFormData
            ? body
            : JSON.stringify(body),
    });

    const data = await parseResponse(res);
    if (!res.ok) {
      const error = new Error(resolveErrorMessage(data, res.status));
      error.status = res.status;
      error.data = data;
      if (res.status === 401) {
        localStorage.removeItem("authToken");
        localStorage.removeItem("currentUserId");
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("auth:invalid-token"));
        }
      }
      throw error;
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      const networkError = new Error("Network error: Failed to fetch.");
      networkError.cause = error;
      throw networkError;
    }
    throw error;
  }
};

const apiFetchWithFallback = async (paths, options = {}) => {
  const queue = Array.isArray(paths) ? paths : [paths];
  let lastError = null;
  for (const path of queue) {
    if (!path) continue;
    try {
      return await apiFetch(path, options);
    } catch (error) {
      lastError = error;
      if (error?.status && error.status !== 404) {
        throw error;
      }
    }
  }
  if (lastError) throw lastError;
  throw new Error("Request failed.");
};

const normalizeList = (data, keys = []) => {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
};

const userRequestCache = new Map();

// Auth APIs
export const login = async (username, password) => {
  return apiFetch("/users/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
};

export const register = async (userData) => {
  return apiFetch("/users/register", {
    method: "POST",
    body: {
      email: userData.email,
      password: userData.password,
      fullName: userData.fullName,
      university: userData.university,
      college: userData.university,
      course: userData.course,
      graduationYear: userData.graduationYear || userData.year || userData.passoutYear,
      year: userData.graduationYear || userData.year || userData.passoutYear,
      passoutYear: userData.passoutYear,
      industry: userData.industry,
      student_type: userData.studentType || userData.student_type,
      studentType: userData.studentType || userData.student_type,
      userType: userData.userType || userData.user_type,
      user_type: userData.user_type,
      studentEmail: userData.studentEmail || userData.student_email,
      communityName: userData.communityName || userData.community_name,
      communityType: userData.communityType || userData.community_type,
      communityDescription: userData.communityDescription || userData.community_description,
      communityEmail: userData.communityEmail || userData.community_email,
      communityCollege: userData.communityCollege,
      username: userData.username,
      recaptchaToken: userData.recaptchaToken,
    },
    auth: false,
  });
};

export const logout = async () => {
  return apiFetch("/users/logout", { method: "POST" });
};

export const forgotPassword = async (email) => {
  return apiFetch("/users/forgot-password", {
    method: "POST",
    body: { email },
    auth: false,
  });
};

export const resetPassword = async (tokenOrPayload, password) => {
  const body =
    tokenOrPayload && typeof tokenOrPayload === "object"
      ? tokenOrPayload
      : { token: tokenOrPayload, password };
  return apiFetch("/users/reset-password", {
    method: "POST",
    body,
    auth: false,
  });
};

// User APIs
export const getCurrentUser = async () => {
  const data = await apiFetch("/users/me");
  return data?.user || data;
};

export const getUserById = async (userId) => {
  if (!userId) return null;
  const cacheKey = String(userId);
  if (userRequestCache.has(cacheKey)) {
    return userRequestCache.get(cacheKey);
  }

  const request = (async () => {
    try {
      const data = await apiFetch(`/users/${encodeURIComponent(userId)}`);
      return data?.user || data;
    } catch (error) {
      console.error("getUserById failed:", error);
      return null;
    }
  })();

  userRequestCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    userRequestCache.delete(cacheKey);
  }
};

export const updateUser = async (updates) => {
  return apiFetch("/users/me", {
    method: "PUT",
    body: updates,
  });
};

export const updateProfileInfo = async (updates) => {
  try {
    return await apiFetch("/users/me", {
      method: "PATCH",
      body: updates,
    });
  } catch (error) {
    if (error?.status === 404 || error?.status === 405) {
      return updateUser(updates);
    }
    throw error;
  }
};

export const changePassword = async ({ currentPassword, newPassword }) => {
  if (!currentPassword || !newPassword) {
    throw new Error("Current and new password are required.");
  }
  try {
    return await apiFetch("/users/me/password", {
      method: "PATCH",
      body: { currentPassword, newPassword },
    });
  } catch (error) {
    if (error?.status === 404 || error?.status === 405) {
      return apiFetch("/users/me/password", {
        method: "PUT",
        body: { currentPassword, newPassword },
      });
    }
    throw error;
  }
};

export const uploadProfilePic = async (file) => {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch("/users/me/profile-pic", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
};

export const deleteProfilePic = async () => {
  return apiFetch("/users/me/profile-pic", {
    method: "DELETE",
  });
};

export const searchUsers = async (query, params = {}) => {
  if (!query) return [];
  try {
    const data = await apiFetch("/search/users", {
      params: { q: query, ...params },
    });
    return normalizeList(data, ["users", "items", "results"]);
  } catch {
    try {
      const data = await apiFetch("/users/search", {
        params: { query },
      });
      return normalizeList(data, ["users", "items", "results"]);
    } catch {
      return [];
    }
  }
};

export const searchAll = async (query, params = {}) => {
  if (!query) return [];
  const data = await apiFetch("/search", {
    params: { query, type: "all", ...params },
  });
  return normalizeList(data, ["items", "results", "data"]);
};

export const searchColleges = async (query, params = {}) => {
  if (!query) return [];
  const resolvedParams =
    typeof params === "number" ? { limit: params } : { ...params };
  try {
    const data = await apiFetch("/colleges", {
      params: { search: query, ...resolvedParams },
    });
    const list = normalizeList(data, ["colleges", "items", "data"]);
    if (list.length) return list;
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }

  const data = await apiFetch("/search/colleges", {
    params: { q: query, ...resolvedParams },
  });
  return normalizeList(data, ["colleges", "items", "data", "results"]);
};

export const searchTrending = async (params = {}) => {
  return apiFetch("/search/trending", { params });
};

export const verifyOrCreateCollege = async (payload) => {
  try {
    return await apiFetch("/college/verify-or-create", {
      method: "POST",
      body: payload,
    });
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  return apiFetch("/colleges/verify-or-create", {
    method: "POST",
    body: payload,
  });
};

export const autoAssignGroups = async (payload) => {
  return apiFetch("/groups/auto-assign", {
    method: "POST",
    body: payload,
  });
};

export const setupCollege = async (payload) => {
  return apiFetch("/users/setup-college", {
    method: "POST",
    body: payload,
  });
};

// Post APIs
export const fetchPosts = async (params = {}) => {
  const data = await apiFetch("/posts", { params });
  return normalizeList(data, ["posts", "items", "data"]);
};

export const createPost = async (postData, imageFile) => {
  const payload = {
    content: postData.content || "",
    isAnonymous: postData.isAnonymous || false,
    authorId: postData.authorId || "",
  };

  if (postData.authorCollegeId) {
    payload.authorCollegeId = postData.authorCollegeId;
    payload.collegeGroupId = postData.authorCollegeId;
  }
  if (postData.collegeTagName) {
    payload.collegeTagName = postData.collegeTagName;
    payload.college = postData.collegeTagName;
    payload.university = postData.collegeTagName;
  }
  if (postData.collegeTagId) {
    payload.collegeTagId = postData.collegeTagId;
  }

  if (!imageFile) {
    return apiFetch("/posts", {
      method: "POST",
      body: payload,
    });
  }

  const formData = new FormData();
  formData.append("content", payload.content);
  formData.append("isAnonymous", payload.isAnonymous);
  formData.append("authorId", payload.authorId);
  if (payload.authorCollegeId) {
    formData.append("authorCollegeId", payload.authorCollegeId);
    formData.append("collegeGroupId", payload.authorCollegeId);
  }
  if (payload.collegeTagName) {
    formData.append("collegeTagName", payload.collegeTagName);
    formData.append("college", payload.collegeTagName);
    formData.append("university", payload.collegeTagName);
  }
  if (payload.collegeTagId) {
    formData.append("collegeTagId", payload.collegeTagId);
  }
  formData.append("image", imageFile);

  return apiFetch("/posts", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
};

export const likePost = async (postId, method = "POST") => {
  return apiFetch(`/posts/${postId}/like`, {
    method,
  });
};

export const addComment = async (postId, content, isAnonymous) => {
  try {
    return await apiFetch(`/posts/${postId}/comment`, {
      method: "POST",
      body: { content, isAnonymous },
    });
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  return apiFetch(`/posts/${postId}/comments`, {
    method: "POST",
    body: { content, isAnonymous },
  });
};

export const deleteComment = async (postId, commentId) => {
  return apiFetch(`/posts/${postId}/comment/${commentId}`, {
    method: "DELETE",
  });
};

export const deletePost = async (postId) => {
  return apiFetch(`/posts/${postId}`, {
    method: "DELETE",
  });
};

export const sharePost = async (postId) => {
  return apiFetch(`/posts/${postId}/share`, {
    method: "POST",
  });
};

// Story APIs
export const fetchStories = async (params) => {
  const resolvedParams = params === undefined ? { last24h: true } : params;
  const data = await apiFetch("/stories", { params: resolvedParams });
  return normalizeList(data, ["stories", "items", "data"]);
};

export const createStory = async (file, meta = {}) => {
  const formData = new FormData();
  if (file) {
    formData.append("img", file);
  }
  const authorId = localStorage.getItem("currentUserId");
  if (authorId) {
    formData.append("authorId", authorId);
  }
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      formData.append(key, value);
    }
  });

  return apiFetch("/stories", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
};

const parseXhrResponse = (xhr) => {
  const contentType = xhr.getResponseHeader("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(xhr.responseText || "null");
    } catch {
      return null;
    }
  }
  return xhr.responseText || null;
};

export const createStoryWithProgress = (file, meta = {}, onProgress, onReady) => {
  const formData = new FormData();
  if (file) {
    formData.append("img", file);
  }
  const authorId = localStorage.getItem("currentUserId");
  if (authorId) {
    formData.append("authorId", authorId);
  }
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      formData.append(key, value);
    }
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", buildUrl("/stories"), true);

    const authToken = readAuthToken();
    if (authToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
    }

    if (typeof onReady === "function") {
      onReady({
        abort: () => xhr.abort(),
      });
    }

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      onProgress(percent, { loaded: event.loaded, total: event.total });
    };

    xhr.onload = () => {
      const data = parseXhrResponse(xhr);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      const error = new Error(resolveErrorMessage(data, xhr.status));
      error.status = xhr.status;
      error.data = data;
      if (xhr.status === 401) {
        localStorage.removeItem("authToken");
        localStorage.removeItem("currentUserId");
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("auth:invalid-token"));
        }
      }
      reject(error);
    };

    xhr.onerror = () => {
      const error = new Error("Network error: Failed to upload.");
      reject(error);
    };

    xhr.onabort = () => {
      const error = new Error("Upload cancelled.");
      error.name = "AbortError";
      reject(error);
    };

    xhr.send(formData);
  });
};

export const deleteStory = async (storyId) => {
  if (!storyId) {
    throw new Error("Story id is missing.");
  }
  return apiFetch(`/stories/${storyId}`, {
    method: "DELETE",
  });
};

export const recordStoryView = async (storyId) => {
  if (!storyId) return null;
  const payload = { viewedAt: new Date().toISOString() };
  try {
    return await apiFetch(`/stories/${storyId}/views`, {
      method: "POST",
      body: payload,
    });
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  try {
    return await apiFetch(`/stories/${storyId}/view`, {
      method: "POST",
      body: payload,
    });
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  return null;
};

export const fetchStoryViews = async (storyId, params) => {
  if (!storyId) return [];
  const resolvedParams = params === undefined ? { last24h: true } : params;
  try {
    const data = await apiFetch(`/stories/${storyId}/views`, {
      params: resolvedParams,
    });
    const list = normalizeList(data, ["views", "viewers", "items", "data"]);
    const count = typeof data?.count === "number" ? data.count : null;
    if (count !== null && Array.isArray(list)) {
      list.count = count;
      return list;
    }
    return list.length === 0 && count !== null ? { count } : list;
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  try {
    const data = await apiFetch(`/stories/${storyId}/viewers`, {
      params: resolvedParams,
    });
    const list = normalizeList(data, ["views", "viewers", "items", "data"]);
    const count = typeof data?.count === "number" ? data.count : null;
    if (count !== null && Array.isArray(list)) {
      list.count = count;
      return list;
    }
    return list.length === 0 && count !== null ? { count } : list;
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  return [];
};

// Chat APIs
export const getChatMessages = async (userId, params) => {
  if (!userId) return { messages: [] };
  const resolvedParams = params === undefined ? { last24h: true } : params;
  try {
    return await apiFetch(`/chat/${encodeURIComponent(userId)}`, {
      params: resolvedParams,
    });
  } catch {
    return { messages: [] };
  }
};

export const getGroupChatMessages = async (groupId, params) => {
  if (!groupId) return { messages: [] };
  const resolvedParams = params === undefined ? { last24h: true } : params;
  try {
    return await apiFetch(`/chat/group/${encodeURIComponent(groupId)}`, {
      params: resolvedParams,
    });
  } catch {
    return { messages: [] };
  }
};

export const getChatGroups = async (params = {}) => {
  const data = await apiFetch("/chat/groups", { params });
  return normalizeList(data, ["groups", "items", "data"]);
};

export const sendChatMessage = async (payload) => {
  if (!payload) return null;
  try {
    return await apiFetch("/chat/send", {
      method: "POST",
      body: payload,
    });
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  return null;
};

export const markChatSeen = async (payload) => {
  if (!payload) return null;
  try {
    return await apiFetch("/chat/seen", {
      method: "POST",
      body: payload,
    });
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  return null;
};

// Friend APIs
export const sendFriendRequest = async (recipientId) => {
  const payload = { recipientId, targetUserId: recipientId };
  return apiFetchWithFallback(["/friend/request", "/friends/send"], {
    method: "POST",
    body: payload,
  });
};

export const getPendingRequests = async (params = {}) => {
  const data = await apiFetch("/friends/pending", {
    params,
  });
  return normalizeList(data, ["requests", "items", "data"]);
};

export const acceptFriendRequest = async (requesterId) => {
  const payload = { requesterId, senderId: requesterId };
  return apiFetchWithFallback(["/friend/accept", "/friends/accept"], {
    method: "POST",
    body: payload,
  });
};

export const rejectFriendRequest = async (requesterId) => {
  const payload = { requesterId, senderId: requesterId };
  return apiFetchWithFallback(["/friend/reject", "/friends/reject"], {
    method: "POST",
    body: payload,
  });
};

export const ignoreFriendRequest = async (requesterId) => {
  return rejectFriendRequest(requesterId);
};

export const cancelFriendRequest = async (recipientId) => {
  const payload = { recipientId, targetUserId: recipientId };
  return apiFetchWithFallback(["/friend/cancel", "/friends/cancel"], {
    method: "POST",
    body: payload,
  });
};

export const getFriendsList = async (params = {}) => {
  const data = await apiFetch("/friends/list", { params });
  return normalizeList(data, ["friends", "items", "data"]);
};

export const getMutualFriends = async (params = {}) => {
  const data = await apiFetch("/friends/mutual", { params });
  return normalizeList(data, ["friends", "items", "data"]);
};

export const removeFriend = async (friendId) => {
  if (!friendId) throw new Error("Missing friend id.");
  const payload = { friendId, userId: friendId, targetUserId: friendId };
  return apiFetchWithFallback(
    ["/friend/remove", "/friends/remove", "/friends/unfriend", "/friends/delete"],
    {
      method: "POST",
      body: payload,
    }
  );
};

export const getFriendStatus = async (targetUserId) => {
  if (!targetUserId) throw new Error("Missing target user id.");
  const encodedId = encodeURIComponent(targetUserId);
  return apiFetchWithFallback([`/friend/status/${encodedId}`, `/friends/status/${encodedId}`]);
};

// Notification APIs
export const fetchNotifications = async (params = {}) => {
  const data = await apiFetch("/notifications", { params });
  return normalizeList(data, ["notifications", "items", "data"]);
};

export const fetchNotificationsMeta = async (params = {}) => {
  return apiFetch("/notifications", { params });
};

export const markNotificationsRead = async (notificationIds = []) => {
  return apiFetch("/notifications/mark-read", {
    method: "POST",
    body: { notificationIds },
  });
};

export const markAllNotificationsRead = async () => {
  return apiFetch("/notifications/mark-all-read", {
    method: "POST",
  });
};

export const createNotification = async (payload) => {
  return apiFetch("/notifications/create", {
    method: "POST",
    body: payload,
    auth: false,
  });
};

// Trending APIs
export const getTrendingPosts = async (params = {}) => {
  const data = await apiFetch("/trending/posts", { params });
  return normalizeList(data, ["posts", "items", "data"]);
};

export const getMostLikedPosts = async (params = {}) => {
  const data = await apiFetch("/trending/posts/most-liked", { params });
  return normalizeList(data, ["posts", "items", "data"]);
};

export const getMostCommentedPosts = async (params = {}) => {
  const data = await apiFetch("/trending/posts/most-commented", { params });
  return normalizeList(data, ["posts", "items", "data"]);
};

export const getMostViewedStories = async (params = {}) => {
  const data = await apiFetch("/trending/stories/most-viewed", { params });
  return normalizeList(data, ["stories", "items", "data"]);
};

// Presence APIs
export const getPresence = async (userIds) => {
  if (!userIds || (Array.isArray(userIds) && userIds.length === 0)) return [];
  const ids = Array.isArray(userIds) ? userIds.join(",") : userIds;
  const data = await apiFetch("/presence", { params: { userIds: ids } });
  return normalizeList(data, ["presence", "items", "data"]);
};

export const getConversationLastRead = async (conversationId) => {
  if (!conversationId) return null;
  return apiFetch(`/presence/conversations/${conversationId}/last-read`);
};

// Moderation / Reports
export const reportContent = async ({ targetType, targetId, reason, details }) => {
  if (!targetType || !targetId) {
    throw new Error("Missing report target.");
  }
  return apiFetch("/moderation/report", {
    method: "POST",
    body: { targetType, targetId, reason, details },
  });
};

export const reportPost = async (postId, payload = {}) => {
  return reportContent({ targetType: "post", targetId: postId, ...payload });
};

export const reportComment = async (commentId, payload = {}) => {
  return reportContent({ targetType: "comment", targetId: commentId, ...payload });
};

export const reportStory = async (storyId, payload = {}) => {
  return reportContent({ targetType: "story", targetId: storyId, ...payload });
};

export const reportMessage = async (messageId, payload = {}) => {
  return reportContent({ targetType: "message", targetId: messageId, ...payload });
};

export const reportUser = async (userId, payload = {}) => {
  return reportContent({ targetType: "user", targetId: userId, ...payload });
};

export const blockUser = async (userId, payload = {}) => {
  if (!userId) throw new Error("Missing user id.");
  return apiFetch("/moderation/block-user", {
    method: "POST",
    body: { userId, ...payload },
  });
};

export const getBlockedUsers = async () => {
  const data = await apiFetch("/moderation/blocked-users");
  return normalizeList(data, ["users", "items", "blockedUsers", "data"]);
};

export const getReports = async (params = {}) => {
  const data = await apiFetch("/reports", { params });
  return normalizeList(data, ["reports", "items", "data"]);
};

export const resolveReport = async (reportId, payload = {}) => {
  if (!reportId) throw new Error("Missing report id.");
  return apiFetch(`/reports/${reportId}/resolve`, {
    method: "POST",
    body: payload,
  });
};

export const getModerationReports = async (params = {}) => {
  const data = await apiFetch("/moderation/reports", { params });
  return normalizeList(data, ["reports", "items", "data"]);
};

export const resolveModerationReport = async (reportId, payload = {}) => {
  if (!reportId) throw new Error("Missing report id.");
  return apiFetch(`/moderation/reports/${reportId}/resolve`, {
    method: "POST",
    body: payload,
  });
};

// Function to get Stream Chat token
export const getStreamChatToken = () => apiFetch('/stream-chat/token', { method: 'POST' });

// Function to create a direct chat channel
export const createDirectChat = (targetUserId) => apiFetch('/stream-chat/create-direct', { method: 'POST', body: { targetUserId } });
