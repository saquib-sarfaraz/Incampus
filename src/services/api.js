import { normalizeInBuzzList, normalizeInBuzzReel } from "../utils/inbuzz";

const normalizeBaseUrl = (base) => {
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
};

const isAbsoluteUrl = (value) => /^https?:\/\//i.test(value);

const API_PREFIX = "/api";
const IS_DEV = import.meta.env.DEV;
const RAW_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "";
const resolveApiBaseUrl = (raw) => {
  const base = normalizeBaseUrl(raw);
  if (!IS_DEV) return base || API_PREFIX;

  // In dev, prefer the Vite `/api` proxy when env points at localhost.
  // This avoids CORS issues and also works when testing from a phone via LAN IP.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/i.test(base)) {
    return API_PREFIX;
  }

  return base || API_PREFIX;
};

const API_BASE_URL = resolveApiBaseUrl(RAW_API_BASE_URL);
const API_BASE_HAS_PREFIX = API_BASE_URL.endsWith(API_PREFIX);
const RAW_COLLEGES_API_URL =
  import.meta.env.VITE_COLLEGES_API_URL || import.meta.env.COLLEGES_API_URL || "";
const RAW_COLLEGE_SEARCH_URL =
  import.meta.env.VITE_COLLEGE_SEARCH_URL || import.meta.env.COLLEGE_SEARCH_URL || "";
const DEFAULT_COLLEGE_SEARCH_URL = import.meta.env.VITE_DEFAULT_COLLEGE_SEARCH_URL || "";
const COLLEGE_SEARCH_URL =
  normalizeBaseUrl(RAW_COLLEGE_SEARCH_URL) ||
  normalizeBaseUrl(DEFAULT_COLLEGE_SEARCH_URL);
const COLLEGES_API_BASE_URL = normalizeBaseUrl(RAW_COLLEGES_API_URL);
const RAW_POST_COMMENTS_PATHS =
  import.meta.env.VITE_POST_COMMENTS_PATHS ||
  import.meta.env.POST_COMMENTS_PATHS ||
  import.meta.env.VITE_POST_COMMENTS_PATH ||
  import.meta.env.POST_COMMENTS_PATH ||
  "";
const DEFAULT_POST_COMMENTS_PATHS = ["/posts/:id/comments"];
const POST_COMMENTS_PATHS = RAW_POST_COMMENTS_PATHS
  ? RAW_POST_COMMENTS_PATHS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : DEFAULT_POST_COMMENTS_PATHS;

const RAW_FRIENDS_COUNT_PATHS =
  import.meta.env.VITE_FRIENDS_COUNT_PATHS ||
  import.meta.env.FRIENDS_COUNT_PATHS ||
  "";
const FRIENDS_COUNT_PATHS = RAW_FRIENDS_COUNT_PATHS
  ? RAW_FRIENDS_COUNT_PATHS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : [];
const FRIENDS_COUNT_ALLOW_LIST_FALLBACK = String(
  import.meta.env.VITE_FRIENDS_COUNT_ALLOW_LIST_FALLBACK || ""
).toLowerCase() === "true";

const RAW_FRIENDS_LIST_PATHS =
  import.meta.env.VITE_FRIENDS_LIST_PATHS ||
  import.meta.env.FRIENDS_LIST_PATHS ||
  "";
const DEFAULT_FRIENDS_LIST_PATHS = [
  "/friends/list",
  "/friends",
  "/friend/list",
];
const FRIENDS_LIST_PATHS = RAW_FRIENDS_LIST_PATHS
  ? RAW_FRIENDS_LIST_PATHS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : DEFAULT_FRIENDS_LIST_PATHS;

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
    signal,
    cache,
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
    const resolvedCache =
      cache !== undefined
        ? cache
        : method.toUpperCase() === "GET"
          ? "no-store"
          : undefined;

    const res = await fetch(buildUrl(path, params), {
      method,
      headers: finalHeaders,
      body:
        body === undefined || body === null
          ? undefined
          : isFormData || isBodyFormData
            ? body
            : JSON.stringify(body),
      signal,
      cache: resolvedCache,
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
      const status = error?.status;
      // Only fallback on "route missing" style errors.
      // Network errors or real server errors should surface immediately.
      if (!status) {
        throw error;
      }
      if (![404, 405].includes(status)) {
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

const extractInBuzzList = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.reels)) return data.reels;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.reels)) return data.data.reels;
  if (Array.isArray(data?.data?.items)) return data.data.items;
  if (Array.isArray(data?.data?.data)) return data.data.data;
  return [];
};

const extractInBuzzItem = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.reel && typeof data.reel === "object") return data.reel;
  if (data.item && typeof data.item === "object") return data.item;
  const nested = data.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    if (nested.reel && typeof nested.reel === "object") return nested.reel;
    if (nested.item && typeof nested.item === "object") return nested.item;
    return nested;
  }
  return data;
};

const userRequestCache = new Map();
const userProfileBundleCache = new Map();
const userProfileBundleRequestCache = new Map();
const USER_PROFILE_BUNDLE_TTL_MS = 60 * 1000;
const USER_PROFILE_BUNDLE_CACHE_LIMIT = 50;
let cachedPostCommentsEndpointMissing = false;
let cachedFriendCountEndpointMissing = false;
let cachedFriendListEndpointMissing = false;

const getCachedProfileBundle = (cacheKey) => {
  const entry = userProfileBundleCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.ts > USER_PROFILE_BUNDLE_TTL_MS) {
    userProfileBundleCache.delete(cacheKey);
    return null;
  }
  return entry.data;
};

const setCachedProfileBundle = (cacheKey, data) => {
  if (!data) return;
  userProfileBundleCache.set(cacheKey, { data, ts: Date.now() });
  if (userProfileBundleCache.size > USER_PROFILE_BUNDLE_CACHE_LIMIT) {
    const oldestKey = userProfileBundleCache.keys().next().value;
    if (oldestKey) userProfileBundleCache.delete(oldestKey);
  }
};

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
      graduationYear: userData.graduationYear || userData.passoutYear,
      year: userData.year,
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

const normalizeUser = (user) => {
  if (!user || typeof user !== "object") return user;
  const resolvedAvatar =
    user.profilePicUrl ||
    user.profilePic ||
    user.avatarUrl ||
    user.avatar ||
    user.photoUrl ||
    user.photo ||
    user.imageUrl ||
    user.image ||
    "";
  if (resolvedAvatar && !user.profilePicUrl) {
    return { ...user, profilePicUrl: resolvedAvatar };
  }
  return user;
};

// User APIs
export const getCurrentUser = async () => {
  const data = await apiFetch("/users/me");
  return normalizeUser(data?.user || data);
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
      const resolved =
        (
        data?.user ||
        data?.profile ||
        data?.data?.user ||
        data?.data?.profile ||
        data?.data?.item ||
        data?.item ||
        data
        );
      return normalizeUser(resolved);
    } catch (_error) {
      void _error;
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

export const getUserProfileBundle = async (userId) => {
  if (!userId) return null;
  const cacheKey = String(userId);
  const cached = getCachedProfileBundle(cacheKey);
  if (cached) return cached;
  if (userProfileBundleRequestCache.has(cacheKey)) {
    return userProfileBundleRequestCache.get(cacheKey);
  }

  const request = (async () => {
    try {
      const data = await apiFetch(`/users/${encodeURIComponent(userId)}`);
      const user = normalizeUser(
        data?.user ||
          data?.profile ||
          data?.data?.user ||
          data?.data?.profile ||
          data?.data?.item ||
          data?.item ||
          data
      );
      const publicPosts =
        data?.publicPosts ||
        data?.public_posts ||
        data?.posts ||
        data?.data?.publicPosts ||
        data?.data?.posts ||
        [];
      const publicPostsCount =
        data?.publicPostsCount ||
        data?.publicPostCount ||
        data?.public_posts_count ||
        (Array.isArray(publicPosts) ? publicPosts.length : 0);
      const bundle = {
        user,
        publicPosts: Array.isArray(publicPosts) ? publicPosts : [],
        publicPostsCount,
        raw: data,
      };
      setCachedProfileBundle(cacheKey, bundle);
      return bundle;
    } catch (_error) {
      void _error;
      return null;
    }
  })();

  userProfileBundleRequestCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    userProfileBundleRequestCache.delete(cacheKey);
  }
};

export const getUserPublicPosts = async (userId, params = {}) => {
  if (!userId) return null;
  const resolveId = (value) => {
    if (!value) return "";
    if (typeof value === "string" || typeof value === "number") {
      const raw = String(value).trim();
      if (!raw) return "";
      if (raw.includes("[object Object]")) return "";
      const lowered = raw.toLowerCase();
      if (lowered === "undefined" || lowered === "null") return "";
      return raw;
    }
    if (typeof value === "object") {
      if (value.$oid) return String(value.$oid);
      const nested =
        value._id ||
        value.id ||
        value.userId ||
        value.user_id ||
        value.profileId ||
        value.profile_id ||
        "";
      if (nested) return resolveId(nested);
    }
    return "";
  };
  const resolvedId = resolveId(userId);
  if (!resolvedId) return null;
  const safeId = encodeURIComponent(resolvedId);
  return apiFetch(`/users/${safeId}/public`, { params });
};

export const registerPushToken = async (token, meta = {}) => {
  if (!token) return null;
  const body = {
    token,
    fcmToken: token,
    fcm_token: token,
    deviceType: meta.deviceType || "web",
    device_type: meta.device_type || meta.deviceType || "web",
    platform: meta.platform || "web",
    ...meta,
  };

  const paths = [
    "/push/register",
    "/push/token",
    "/push/subscribe",
    "/notifications/register-device",
    "/notifications/register_device",
    "/notifications/register",
  ];

  try {
    return await apiFetchWithFallback(paths, {
      method: "POST",
      body,
    });
  } catch (error) {
    void error;
    return null;
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
    return await apiFetch("/users/settings/profile", {
      method: "PATCH",
      body: updates,
    });
  } catch (error) {
    if (error?.status !== 404 && error?.status !== 405) {
      throw error;
    }
  }
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

export const updateEducationInfo = async (updates) => {
  try {
    return await apiFetch("/users/settings/education", {
      method: "PATCH",
      body: updates,
    });
  } catch (error) {
    if (error?.status !== 404 && error?.status !== 405) {
      throw error;
    }
  }
  return updateUser(updates);
};

export const changePassword = async ({
  currentPassword,
  newPassword,
  confirmPassword,
} = {}) => {
  if (!newPassword) {
    throw new Error("New password is required.");
  }
  const payload = {
    newPassword,
    confirmPassword: confirmPassword || newPassword,
  };
  if (currentPassword) {
    payload.currentPassword = currentPassword;
  }
  try {
    return await apiFetch("/users/settings/password", {
      method: "PATCH",
      body: payload,
    });
  } catch (error) {
    if (error?.status === 404 || error?.status === 405) {
      return apiFetch("/users/me/password", {
        method: "PUT",
        body: payload,
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

const resolveSearchOptions = (paramsOrOptions = {}) => {
  if (!paramsOrOptions) return { params: {}, signal: undefined };
  const { signal, params, ...rest } = paramsOrOptions;
  if (signal || params) {
    return { params: params || rest, signal };
  }
  return { params: rest, signal: undefined };
};

export const searchUsers = async (query, paramsOrOptions = {}) => {
  if (!query) return [];
  const { params, signal } = resolveSearchOptions(paramsOrOptions);
  try {
    const data = await apiFetch("/search/users", {
      params: { q: query, ...params },
      signal,
    });
    return normalizeList(data, ["users", "items", "results"]);
  } catch {
    try {
      const data = await apiFetch("/users/search", {
        params: { query },
        signal,
      });
      return normalizeList(data, ["users", "items", "results"]);
    } catch {
      return [];
    }
  }
};

export const searchAll = async (query, paramsOrOptions = {}) => {
  if (!query) return null;
  const { params, signal } = resolveSearchOptions(paramsOrOptions);
  const data = await apiFetchWithFallback(["/search", "/search/all"], {
    params: { q: query, query, type: "all", ...params },
    signal,
  });
  return data;
};

export const searchColleges = async (query, params = {}) => {
  if (!query) return [];
  const resolvedParams =
    typeof params === "number" ? { limit: params } : { ...params };
  const searchParams = { q: query, search: query, ...resolvedParams };
  const collegeBase = COLLEGES_API_BASE_URL;
  const externalPaths = [];
  if (COLLEGE_SEARCH_URL) {
    externalPaths.push(COLLEGE_SEARCH_URL);
  } else if (collegeBase) {
    externalPaths.push(`${collegeBase}/api/search-tags`);
  }

  for (const path of externalPaths) {
    try {
      const data = await apiFetch(path, {
        params: searchParams,
        auth: false,
      });
      const list = normalizeList(data, [
        "colleges",
        "items",
        "data",
        "results",
        "tags",
      ]);
      if (list.length) return list;
    } catch (error) {
      if (error?.status && error.status !== 404) {
        throw error;
      }
    }
  }

  // Fallback to existing backend paths if external search doesn't return results.
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

export const createGroup = async (payload = {}, imageFile) => {
  if (!payload) return null;
  const baseName =
    payload.name ||
    payload.title ||
    payload.groupName ||
    payload.group_name ||
    payload.displayName ||
    payload.display_name ||
    "";
  const baseDescription =
    payload.description ||
    payload.about ||
    payload.bio ||
    payload.summary ||
    payload.details ||
    "";
  const visibility =
    payload.visibility ||
    payload.privacy ||
    payload.access ||
    payload.groupVisibility ||
    "";
  const body = {
    ...payload,
    ...(baseName
      ? {
          name: baseName,
          title: baseName,
          groupName: baseName,
          displayName: baseName,
        }
      : {}),
    ...(baseDescription
      ? {
          description: baseDescription,
          about: baseDescription,
          bio: baseDescription,
        }
      : {}),
    ...(visibility
      ? {
          visibility,
          privacy: visibility,
          isPrivate: String(visibility).toLowerCase() === "private",
          isPublic: String(visibility).toLowerCase() === "public",
        }
      : {}),
  };

  const endpoints = ["/groups/create", "/group/create", "/groups"];

  const sendFormData = async () => {
    const formData = new FormData();
    Object.entries(body).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      formData.append(key, value);
    });
    if (imageFile) {
      formData.append("profileImage", imageFile);
      formData.append("image", imageFile);
    }
    return apiFetchWithFallback(endpoints, {
      method: "POST",
      body: formData,
      isFormData: true,
    });
  };

  if (imageFile) {
    return sendFormData();
  }

  try {
    return await apiFetchWithFallback(endpoints, {
      method: "POST",
      body,
    });
  } catch {
    return sendFormData();
  }
};

const safeDecodeParam = (value) => {
  if (!value) return "";
  let result = String(value);
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(result);
      if (decoded === result) break;
      result = decoded;
    } catch {
      break;
    }
  }
  return result;
};

const encodeGroupParam = (value) => encodeURIComponent(safeDecodeParam(value));

export const getGroupDetails = async (groupId) => {
  if (!groupId) return null;
  const safeId = safeDecodeParam(groupId);
  const encodedId = encodeGroupParam(safeId);
  if (safeId.startsWith("group:college:")) {
    const collegeGroupId = safeId.replace("group:college:", "");
    const normalizedCollegeId = collegeGroupId
      ? collegeGroupId
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";
    const encodedCollegeId = encodeGroupParam(normalizedCollegeId || collegeGroupId);
    return apiFetchWithFallback(
      [
        `/groups/college/${encodedCollegeId}`,
        `/groups/${encodedId}`,
        `/group/${encodedId}`,
        `/groups/details/${encodedId}`,
      ],
      {}
    );
  }
  return apiFetchWithFallback(
    [`/groups/${encodedId}`, `/group/${encodedId}`, `/groups/details/${encodedId}`],
    {}
  );
};

export const requestGroupJoin = async (groupId) => {
  if (!groupId) return null;
  const encodedId = encodeGroupParam(groupId);
  return apiFetchWithFallback(
    [
      `/groups/${encodedId}/request`,
      `/groups/${encodedId}/join`,
      `/groups/${encodedId}/join-request`,
    ],
    { method: "POST" }
  );
};

export const approveGroupJoin = async (groupId, userId) => {
  if (!groupId || !userId) return null;
  const encodedId = encodeGroupParam(groupId);
  return apiFetchWithFallback(
    [
      `/groups/${encodedId}/approve`,
      `/groups/${encodedId}/requests/approve`,
      `/groups/${encodedId}/join/approve`,
    ],
    { method: "POST", body: { userId } }
  );
};

export const rejectGroupJoin = async (groupId, userId) => {
  if (!groupId || !userId) return null;
  const encodedId = encodeGroupParam(groupId);
  return apiFetchWithFallback(
    [
      `/groups/${encodedId}/reject`,
      `/groups/${encodedId}/requests/reject`,
      `/groups/${encodedId}/join/reject`,
    ],
    { method: "POST", body: { userId } }
  );
};

export const removeGroupMember = async (groupId, userId) => {
  if (!groupId || !userId) return null;
  const encodedId = encodeGroupParam(groupId);
  return apiFetchWithFallback(
    [
      `/groups/${encodedId}/members/remove`,
      `/groups/${encodedId}/members/${encodeURIComponent(userId)}`,
    ],
    { method: "POST", body: { userId } }
  );
};

export const addGroupMember = async (groupId, userId) => {
  if (!groupId || !userId) return null;
  const encodedId = encodeGroupParam(groupId);
  return apiFetchWithFallback(
    [
      `/groups/${encodedId}/members/add`,
      `/groups/${encodedId}/members`,
    ],
    { method: "POST", body: { userId } }
  );
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

export const fetchRankedFeedPage = async (params = {}) => {
  const data = await apiFetchWithFallback(
    ["/feed/universal", "/posts/feed", "/posts"],
    { params }
  );
  const items = normalizeList(data, ["posts", "items", "data"]);
  if (Array.isArray(data)) {
    return { items, nextCursor: "", hasMore: undefined };
  }
  const nextCursor =
    data?.nextCursor ||
    data?.next_cursor ||
    data?.cursor ||
    data?.data?.nextCursor ||
    data?.data?.next_cursor ||
    "";
  const hasMore =
    typeof data?.hasMore === "boolean"
      ? data.hasMore
      : typeof data?.data?.hasMore === "boolean"
        ? data.data.hasMore
        : undefined;
  return { items, nextCursor, hasMore };
};

export const createPost = async (postData, imageFile) => {
  const payload = {
    content: postData.content || "",
    isAnonymous: postData.isAnonymous || false,
    authorId: postData.authorId || "",
  };
  const resolvedContentType = postData.contentType || postData.postType;
  if (resolvedContentType) {
    payload.contentType = resolvedContentType;
  }
  if (postData.visibility) {
    payload.visibility = postData.visibility;
  }
  if (postData.collegeTags && Array.isArray(postData.collegeTags)) {
    payload.collegeTags = postData.collegeTags;
  }

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
  if (postData.aspectRatio) {
    payload.aspectRatio = postData.aspectRatio;
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
  if (payload.contentType) {
    formData.append("contentType", payload.contentType);
  }
  if (payload.visibility) {
    formData.append("visibility", payload.visibility);
  }
  if (payload.collegeTags) {
    payload.collegeTags.forEach((tag) => {
      if (tag !== undefined && tag !== null && tag !== "") {
        formData.append("collegeTags", String(tag));
      }
    });
  }
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
  if (payload.aspectRatio) {
    formData.append("aspectRatio", payload.aspectRatio);
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

export const fetchPostComments = async (postId, params = {}) => {
  if (!postId) return [];
  if (cachedPostCommentsEndpointMissing) {
    const error = new Error("Comments endpoint unavailable.");
    error.code = "COMMENTS_ENDPOINT_MISSING";
    throw error;
  }
  const encodedId = encodeURIComponent(postId);
  const resolvedPaths = POST_COMMENTS_PATHS.map((path) =>
    path.replace(":id", encodedId)
  );
  try {
    const data = await apiFetchWithFallback(resolvedPaths, { params });
    return normalizeList(data, ["comments", "items", "data", "results"]);
  } catch (error) {
    if (error?.status === 404) {
      cachedPostCommentsEndpointMissing = true;
      const missing = new Error("Comments endpoint unavailable.");
      missing.code = "COMMENTS_ENDPOINT_MISSING";
      throw missing;
    }
    throw error;
  }
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

export const recordPostView = async (postId) => {
  if (!postId) return null;
  try {
    return await apiFetch(`/posts/${postId}/view`, { method: "POST" });
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  return null;
};

export const recordPostStoryReshare = async (postId) => {
  if (!postId) return null;
  try {
    return await apiFetch(`/posts/${postId}/story-reshare`, { method: "POST" });
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
  }
  return null;
};

// Story APIs
export const fetchStories = async (params) => {
  const resolvedParams = params === undefined ? { last24h: true } : params;
  const data = await apiFetch("/stories", { params: resolvedParams });
  return normalizeList(data, ["stories", "items", "data"]);
};

// InBuzz APIs
export const fetchInBuzzFeed = async (params = {}) => {
  const data = await apiFetchWithFallback(
    ["/inbuzz/feed", "/inbuzz/reels", "/inbuzz"],
    { params }
  );
  const items = normalizeInBuzzList(extractInBuzzList(data));
  if (Array.isArray(data)) {
    return { items, nextCursor: "", hasMore: undefined };
  }
  const nextCursor =
    data?.nextCursor ||
    data?.next_cursor ||
    data?.cursor ||
    data?.data?.nextCursor ||
    data?.data?.next_cursor ||
    "";
  const hasMore =
    typeof data?.hasMore === "boolean"
      ? data.hasMore
      : typeof data?.data?.hasMore === "boolean"
        ? data.data.hasMore
        : undefined;
  return { items, nextCursor, hasMore };
};

export const fetchInBuzzTrending = async (params = {}) => {
  const data = await apiFetchWithFallback(
    ["/inbuzz/trending", "/inbuzz/reels/trending"],
    { params }
  );
  return normalizeInBuzzList(extractInBuzzList(data));
};

export const fetchInBuzzReel = async (reelId) => {
  if (!reelId) return null;
  const encoded = encodeURIComponent(reelId);
  const data = await apiFetchWithFallback(
    [`/inbuzz/reel/${encoded}`, `/inbuzz/${encoded}`],
    {}
  );
  const item = extractInBuzzItem(data);
  return normalizeInBuzzReel(item) || item;
};

export const fetchInBuzzStreamToken = async (reelId) => {
  if (!reelId) return "";
  const encoded = encodeURIComponent(reelId);
  const data = await apiFetchWithFallback(
    [
      `/inbuzz/stream-token/${encoded}`,
      `/inbuzz/stream_token/${encoded}`,
      `/inbuzz/reel/${encoded}/stream-token`,
      `/inbuzz/reel/${encoded}/stream_token`,
    ],
    {}
  );
  const token =
    (typeof data === "string" ? data : "") ||
    data?.token ||
    data?.streamToken ||
    data?.stream_token ||
    data?.data?.token ||
    data?.data?.streamToken ||
    data?.data?.stream_token ||
    "";
  return token ? String(token) : "";
};

export const fetchInBuzzByUser = async (userId, params = {}) => {
  if (!userId) return [];
  const encoded = encodeURIComponent(userId);
  const endpoints = [
    `/inbuzz/user/${encoded}`,
    `/inbuzz/users/${encoded}`,
    `/users/${encoded}/inbuzz`,
  ];
  if (!fetchInBuzzByUser._rejectsQueryParams) {
    fetchInBuzzByUser._rejectsQueryParams = false;
  }

  const attempt = async (attemptParams) => {
    const data = await apiFetchWithFallback(endpoints, { params: attemptParams });
    return normalizeInBuzzList(extractInBuzzList(data));
  };

  const rawParams = params && typeof params === "object" ? params : {};
  const normalizedParams = { ...rawParams };
  if (Object.prototype.hasOwnProperty.call(normalizedParams, "limit")) {
    const limit = Number(normalizedParams.limit);
    if (!Number.isFinite(limit)) {
      delete normalizedParams.limit;
    }
  }

  try {
    if (fetchInBuzzByUser._rejectsQueryParams) {
      return await attempt({});
    }
    return await attempt(normalizedParams);
  } catch (error) {
    const status = error?.status;
    if (error?.status && [404, 405].includes(error.status)) {
      return [];
    }
    // Some backends validate query params strictly for this endpoint and return 400.
    // Retry without any query params, and remember so we don't spam 400s.
    if (status === 400 && normalizedParams && Object.keys(normalizedParams).length) {
      fetchInBuzzByUser._rejectsQueryParams = true;
      try {
        return await attempt({});
      } catch (retryError) {
        if (retryError?.status && [404, 405].includes(retryError.status)) {
          return [];
        }
        throw retryError;
      }
    }
    throw error;
  }
};

export const recordInBuzzReelView = async (reelId, payload = {}) => {
  if (!reelId) return null;
  const encoded = encodeURIComponent(reelId);
  return apiFetchWithFallback(
    [`/inbuzz/reel/${encoded}/view`, `/inbuzz/${encoded}/view`],
    {
      method: "POST",
      body: payload,
    }
  );
};

export const likeInBuzzReel = async (reelId, payload = {}) => {
  if (!reelId) return null;
  const encoded = encodeURIComponent(reelId);
  return apiFetchWithFallback(
    [`/inbuzz/reel/${encoded}/like`, `/inbuzz/${encoded}/like`],
    {
      method: "POST",
      body: payload,
    }
  );
};

export const shareInBuzzReel = async (reelId, payload = {}) => {
  if (!reelId) return null;
  const encoded = encodeURIComponent(reelId);
  return apiFetchWithFallback(
    [`/inbuzz/reel/${encoded}/share`, `/inbuzz/${encoded}/share`],
    {
      method: "POST",
      body: payload,
    }
  );
};

export const fetchInBuzzComments = async (reelId, params = {}) => {
  if (!reelId) return [];
  const encoded = encodeURIComponent(reelId);
  const data = await apiFetchWithFallback(
    [`/inbuzz/reel/${encoded}/comments`, `/inbuzz/${encoded}/comments`],
    { params }
  );
  return normalizeList(data, ["comments", "items", "data"]);
};

export const addInBuzzComment = async (reelId, payload = {}) => {
  if (!reelId) return null;
  const encoded = encodeURIComponent(reelId);
  return apiFetchWithFallback(
    [`/inbuzz/reel/${encoded}/comment`, `/inbuzz/${encoded}/comment`],
    {
      method: "POST",
      body: payload,
    }
  );
};

export const deleteInBuzzComment = async (reelId, commentId, payload = {}) => {
  if (!reelId || !commentId) return null;
  const encodedReel = encodeURIComponent(reelId);
  const encodedComment = encodeURIComponent(commentId);
  const hasBody =
    payload && typeof payload === "object" && Object.keys(payload).length > 0;
  const deletePaths = [
    `/inbuzz/reel/${encodedReel}/comment/${encodedComment}`,
    `/inbuzz/reel/${encodedReel}/comments/${encodedComment}`,
    `/inbuzz/${encodedReel}/comment/${encodedComment}`,
    `/inbuzz/${encodedReel}/comments/${encodedComment}`,
    `/inbuzz/comment/${encodedComment}`,
    `/inbuzz/comments/${encodedComment}`,
  ];

  try {
    return await apiFetchWithFallback(deletePaths, {
      method: "DELETE",
      body: hasBody ? payload : undefined,
    });
  } catch (error) {
    if (error?.status && ![404, 405].includes(error.status)) {
      throw error;
    }
  }

  return apiFetchWithFallback(deletePaths, {
    method: "POST",
    body: hasBody ? payload : undefined,
  });
};

export const createInBuzzReel = async (file, meta = {}) => {
  const formData = new FormData();
  if (file) formData.append("video", file);
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    formData.append(key, value);
  });
  return apiFetchWithFallback(["/inbuzz/reel", "/inbuzz/reels", "/inbuzz"], {
    method: "POST",
    body: formData,
    isFormData: true,
  });
};

export const createInBuzzReelWithProgress = (file, meta = {}, onProgress, onReady) => {
  const formData = new FormData();
  if (file) formData.append("video", file);
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    formData.append(key, value);
  });

  return new Promise((resolve, reject) => {
    const endpoints = ["/inbuzz/reel", "/inbuzz/reels", "/inbuzz"];
    let activeXhr = null;
    let aborted = false;

    if (typeof onReady === "function") {
      onReady({
        abort: () => {
          aborted = true;
          if (activeXhr) activeXhr.abort();
        },
      });
    }

    const startRequest = (index) => {
      if (aborted) return;
      const path = endpoints[index];
      if (!path) {
        reject(new Error("Failed to upload InBuzz."));
        return;
      }

      const xhr = new XMLHttpRequest();
      activeXhr = xhr;
      xhr.open("POST", buildUrl(path), true);

      const authToken = readAuthToken();
      if (authToken) {
        xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
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

        // Only fallback when the endpoint isn't implemented.
        if ([404, 405].includes(xhr.status) && index < endpoints.length - 1) {
          startRequest(index + 1);
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
    };

    startRequest(0);
  });
};

export const getInBuzzUploadStatus = async (jobId) => {
  if (!jobId) return null;
  const encoded = encodeURIComponent(jobId);
  return apiFetchWithFallback([`/inbuzz/uploads/${encoded}`, `/inbuzz/upload/${encoded}`], {});
};

export const updateInBuzzReel = async (reelId, payload = {}) => {
  if (!reelId) return null;
  const encoded = encodeURIComponent(reelId);
  return apiFetchWithFallback(
    [`/inbuzz/reel/${encoded}`, `/inbuzz/${encoded}`],
    {
      method: "PATCH",
      body: payload,
    }
  );
};

export const deleteInBuzzReel = async (reelId, payload = {}) => {
  if (!reelId) return null;
  const encoded = encodeURIComponent(reelId);
  return apiFetchWithFallback(
    [`/inbuzz/reel/${encoded}`, `/inbuzz/${encoded}`],
    {
      method: "DELETE",
      body: payload,
    }
  );
};

export const fetchInBuzzTopCreators = async (params = {}) => {
  const data = await apiFetchWithFallback(
    ["/inbuzz/creators/top", "/inbuzz/creators/leaderboard", "/inbuzz/leaderboard"],
    { params }
  );
  return normalizeList(data, ["creators", "items", "data", "users"]);
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
    return await apiFetch(`/chat/group/${encodeGroupParam(groupId)}`, {
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

export const getPublicGroups = async (params = {}) => {
  const data = await apiFetchWithFallback(
    [
      "/groups/public",
      "/groups/discover",
      "/groups/explore",
      "/public/groups",
      "/groups",
    ],
    { params }
  );
  return normalizeList(data, ["groups", "items", "data"]);
};

export const sendChatMessage = async (payload) => {
  if (!payload) return null;
  const body = { ...payload };
  if (body.senderId && !body.from) body.from = body.senderId;
  if (body.from && !body.senderId) body.senderId = body.from;
  if (body.senderId && !body.fromUserId) body.fromUserId = body.senderId;
  if (body.to && !body.receiverId) body.receiverId = body.to;
  if (body.receiverId && !body.to) body.to = body.receiverId;
  if (body.receiverId && !body.toUserId) body.toUserId = body.receiverId;
  if (body.receiverId && !body.recipientId) body.recipientId = body.receiverId;
  if (body.receiverId && !body.targetUserId) body.targetUserId = body.receiverId;
  if (body.to && !body.chatId) body.chatId = body.to;
  if (typeof body.text === "string") {
    body.text = body.text.trim();
  }
  if (!body.messageType) body.messageType = body.type || "text";
  try {
    return await apiFetch("/chat/send", {
      method: "POST",
      body,
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
  const payload = {
    recipientId,
    targetUserId: recipientId,
    toUserId: recipientId,
    receiverId: recipientId,
  };
  return apiFetchWithFallback(
    ["/friend-requests/send", "/friend/request", "/friends/send"],
    {
      method: "POST",
      body: payload,
    }
  );
};

const RAW_FRIEND_REQUESTS_PATHS =
  import.meta.env.VITE_FRIEND_REQUESTS_PATHS ||
  import.meta.env.FRIEND_REQUESTS_PATHS ||
  import.meta.env.VITE_FRIEND_REQUESTS_PATH ||
  import.meta.env.FRIEND_REQUESTS_PATH ||
  "";

const DEFAULT_FRIEND_REQUEST_PATHS = [
  "/friend-requests/incoming",
  "/friend-requests",
  "/friend-requests/pending",
  "/friend-requests/received",
  "/friend-requests/requests",
  "/friend/requests",
  "/friends/requests",
  "/friends/requests/incoming",
  "/friend/request/incoming",
  "/friend-request/incoming",
];

const FRIEND_REQUEST_PATHS = RAW_FRIEND_REQUESTS_PATHS
  ? RAW_FRIEND_REQUESTS_PATHS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : DEFAULT_FRIEND_REQUEST_PATHS;

let cachedFriendRequestPath = null;
let cachedFriendRequestPathAt = 0;
const FRIEND_REQUEST_PATH_CACHE_TTL = 5 * 60 * 1000;

const resolveFriendRequestPath = async (probeParams) => {
  const now = Date.now();
  if (cachedFriendRequestPathAt && now - cachedFriendRequestPathAt < FRIEND_REQUEST_PATH_CACHE_TTL) {
    return cachedFriendRequestPath;
  }

  if (!FRIEND_REQUEST_PATHS.length) {
    cachedFriendRequestPath = null;
    cachedFriendRequestPathAt = now;
    return null;
  }

  if (RAW_FRIEND_REQUESTS_PATHS && FRIEND_REQUEST_PATHS.length === 1) {
    cachedFriendRequestPath = FRIEND_REQUEST_PATHS[0];
    cachedFriendRequestPathAt = now;
    return cachedFriendRequestPath;
  }

  for (const path of FRIEND_REQUEST_PATHS) {
    try {
      await apiFetch(path, {
        params: probeParams,
        cache: "no-store",
      });
      cachedFriendRequestPath = path;
      cachedFriendRequestPathAt = now;
      return path;
    } catch (error) {
      const status = error?.status;
      if (status && status !== 404 && status !== 405) {
        cachedFriendRequestPath = path;
        cachedFriendRequestPathAt = now;
        return path;
      }
      if (!status) {
        throw error;
      }
    }
  }

  cachedFriendRequestPath = null;
  cachedFriendRequestPathAt = now;
  return null;
};

export const getPendingRequests = async (params = {}) => {
  const hasStatus = params.status != null || params.state != null;
  const normalizeRequestsList = (data) => {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    const candidates = [
      data.incomingRequests,
      data.incoming,
      data.pending,
      data.pendingRequests,
      data.pending_requests,
      data.friendRequests,
      data.friend_requests,
      data.invitations,
      data.invites,
      data.requests,
      data.requests?.items,
      data.requests?.data,
      data.requests?.rows,
      data.requests?.docs,
      data.requests?.results,
      data.pendingRequests?.items,
      data.pendingRequests?.data,
      data.pendingRequests?.rows,
      data.pendingRequests?.docs,
      data.pendingRequests?.results,
      data.friendRequests?.items,
      data.friendRequests?.data,
      data.friendRequests?.rows,
      data.friendRequests?.docs,
      data.friendRequests?.results,
      data.friend_requests?.items,
      data.friend_requests?.data,
      data.friend_requests?.rows,
      data.friend_requests?.docs,
      data.friend_requests?.results,
      data.items,
      data.data,
      data.result,
      data.payload,
      data.response,
      data.requests?.items,
      data.requests?.incoming,
      data.requests?.pending,
      data.data?.requests,
      data.data?.incoming,
      data.data?.incomingRequests,
      data.data?.pendingRequests,
      data.data?.friendRequests,
      data.data?.friend_requests,
      data.data?.items,
      data.data?.data,
      data.data?.rows,
      data.data?.docs,
      data.data?.results,
      data.result?.requests,
      data.result?.incoming,
      data.result?.items,
      data.result?.data,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    const nestedData = data.data && typeof data.data === "object" ? data.data : null;
    if (nestedData) {
      const nestedArray = Object.values(nestedData).find(Array.isArray);
      if (nestedArray) return nestedArray;
    }
    const fallbackArray = Object.values(data).find(Array.isArray);
    if (fallbackArray) return fallbackArray;
    const findFirstArray = (value, depth = 2) => {
      if (!value || depth < 0) return null;
      if (Array.isArray(value)) {
        if (value.length === 0) return value;
        if (typeof value[0] === "object") return value;
        return null;
      }
      if (typeof value !== "object") return null;
      for (const entry of Object.values(value)) {
        const found = findFirstArray(entry, depth - 1);
        if (found) return found;
      }
      return null;
    };
    const deepArray = findFirstArray(data, 3);
    if (deepArray) return deepArray;
    const single =
      data.request ||
      data.friendRequest ||
      data.friend_request ||
      data.pendingRequest ||
      data.incomingRequest ||
      data.invite ||
      data.data?.request ||
      data.data?.friendRequest ||
      data.data?.pendingRequest ||
      null;
    return single ? [single] : [];
  };
  const fetchRequests = async (paths, query) => {
    let lastList = [];
    for (const path of paths) {
      try {
        const data = await apiFetch(path, {
          params: query,
          cache: "no-store",
        });
        const list = normalizeRequestsList(data);
        if (Array.isArray(list) && list.length > 0) {
          return list;
        }
        lastList = Array.isArray(list) ? list : [];
      } catch (error) {
        if (error?.status && error.status !== 404 && error.status !== 405) {
          throw error;
        }
      }
    }
    return lastList;
  };

  const resolvedStatus = hasStatus ? params.status ?? params.state : "pending";
  const rawUserId =
    params.userId ||
    params.receiverId ||
    params.recipientId ||
    params.targetUserId ||
    params.toUserId ||
    params.id ||
    params.user_id ||
    params.receiver_id;

  const queries = [];
  const seen = new Set();
  const pushQuery = (query) => {
    if (!query || typeof query !== "object") return;
    const orderedKeys = Object.keys(query).sort();
    const signature = orderedKeys.map((key) => `${key}:${query[key]}`).join("|");
    if (seen.has(signature)) return;
    seen.add(signature);
    queries.push(query);
  };

  const baseParams = { ...params };
  const shouldAddStatus = !hasStatus && resolvedStatus;
  if (shouldAddStatus) {
    baseParams.status = resolvedStatus;
  }
  pushQuery(baseParams);
  if (shouldAddStatus) {
    const withoutStatus = { ...baseParams };
    delete withoutStatus.status;
    pushQuery(withoutStatus);
  }

  if (rawUserId) {
    const statusPayload = resolvedStatus ? { status: resolvedStatus } : {};
    const statusVariants = [statusPayload];
    if (shouldAddStatus) {
      statusVariants.push({});
    }
    statusVariants.forEach((variant) => {
      pushQuery({ userId: rawUserId, ...variant });
      pushQuery({ receiverId: rawUserId, ...variant });
      pushQuery({ recipientId: rawUserId, ...variant });
      pushQuery({ toUserId: rawUserId, ...variant });
      pushQuery({ targetUserId: rawUserId, ...variant });
    });
  }

  if (!rawUserId && resolvedStatus) {
    pushQuery({ status: resolvedStatus });
  }

  const probeParams = {};
  if (resolvedStatus) probeParams.status = resolvedStatus;
  if (rawUserId) probeParams.userId = rawUserId;

  const resolvedPath = await resolveFriendRequestPath(probeParams);
  const now = Date.now();
  const shouldSkipPaths =
    !resolvedPath &&
    cachedFriendRequestPathAt &&
    now - cachedFriendRequestPathAt < FRIEND_REQUEST_PATH_CACHE_TTL;
  const pathsToTry = shouldSkipPaths
    ? []
    : resolvedPath
      ? [resolvedPath]
      : FRIEND_REQUEST_PATHS;

  if (!pathsToTry.length) {
    return [];
  }

  let lastList = [];
  for (const query of queries) {
    try {
      const list = await fetchRequests(pathsToTry, query);
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
      lastList = Array.isArray(list) ? list : [];
    } catch (error) {
      if (error?.status && error.status !== 404) {
        throw error;
      }
      lastList = [];
    }
  }
  return lastList;
};

export const acceptFriendRequest = async (requestInput) => {
  let requesterId = requestInput;
  let requestId = null;

  if (requestInput && typeof requestInput === "object") {
    requestId =
      requestInput.requestId ||
      requestInput._id ||
      requestInput.id ||
      requestInput.requestID ||
      null;
    requesterId =
      requestInput.requesterId ||
      requestInput.senderId ||
      requestInput.fromUserId ||
      requestInput.userId ||
      requestInput.user?.id ||
      requestInput.user?._id ||
      requesterId;
  }

  const payload = {
    requesterId,
    senderId: requesterId,
    requestId,
  };

  if (!payload.requestId) delete payload.requestId;

  const acceptPaths = [];
  if (requestId) {
    acceptPaths.push(`/friend-requests/${encodeURIComponent(requestId)}/accept`);
  }

  return apiFetchWithFallback(
    [
      ...acceptPaths,
      "/friends/accept-request",
      "/friend-requests/accept",
      "/friend/accept",
      "/friends/accept",
      "/friends/request/accept",
      "/friend-requests/request/accept",
    ],
    {
      method: "POST",
      body: payload,
    }
  );
};

export const rejectFriendRequest = async (requesterId) => {
  const payload = { requesterId, senderId: requesterId };
  return apiFetchWithFallback(
    ["/friend-requests/reject", "/friend/reject", "/friends/reject"],
    {
      method: "POST",
      body: payload,
    }
  );
};

export const ignoreFriendRequest = async (requesterId) => {
  return rejectFriendRequest(requesterId);
};

export const cancelFriendRequest = async (recipientId) => {
  const payload = { recipientId, targetUserId: recipientId };
  return apiFetchWithFallback(
    ["/friend-requests/cancel", "/friend/cancel", "/friends/cancel"],
    {
      method: "POST",
      body: payload,
    }
  );
};

export const getFriendsList = async (params = {}) => {
  const data = await apiFetchWithFallback(FRIENDS_LIST_PATHS, { params });
  return normalizeList(data, ["friends", "items", "data"]);
};

const resolveCountFromPayload = (payload) => {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "number" && Number.isFinite(payload)) return payload;
  if (typeof payload === "string") {
    const parsed = Number(payload);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(payload)) return payload.length;
  if (typeof payload !== "object") return null;

  const numericCandidates = [
    payload.count,
    payload.total,
    payload.totalCount,
    payload.friendCount,
    payload.friendsCount,
    payload.friends_count,
    payload.totalFriends,
    payload.total_friends,
    payload.data?.count,
    payload.data?.total,
    payload.data?.totalCount,
    payload.data?.friendCount,
    payload.data?.friendsCount,
    payload.data?.friends_count,
  ];
  for (const candidate of numericCandidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }

  const listCandidates = [
    payload.friends,
    payload.items,
    payload.results,
    payload.data?.friends,
    payload.data?.items,
    payload.data?.results,
    payload.friends?.items,
    payload.friends?.data,
  ];
  for (const candidate of listCandidates) {
    if (Array.isArray(candidate)) return candidate.length;
  }

  return null;
};

export const getFriendCount = async (userId, params = {}) => {
  if (!userId) return null;
  const encodedId = encodeURIComponent(String(userId));
  const queryParams = {
    userId,
    targetUserId: userId,
    id: userId,
    ...params,
  };

  if (FRIENDS_COUNT_PATHS.length && !cachedFriendCountEndpointMissing) {
    try {
      const data = await apiFetchWithFallback(
        FRIENDS_COUNT_PATHS.map((path) => path.replace(":id", encodedId)),
        { params: queryParams }
      );
      const count = resolveCountFromPayload(data);
      if (Number.isFinite(count)) return count;
    } catch (error) {
      if (error?.status === 404) {
        cachedFriendCountEndpointMissing = true;
      } else {
        throw error;
      }
    }
  }

  if (FRIENDS_COUNT_ALLOW_LIST_FALLBACK && !cachedFriendListEndpointMissing) {
    try {
      const data = await apiFetchWithFallback(
        [
          ...FRIENDS_LIST_PATHS,
          `/users/${encodedId}/friends`,
          `/friends/${encodedId}`,
        ],
        { params: queryParams }
      );
      const count = resolveCountFromPayload(data);
      if (Number.isFinite(count)) return count;
    } catch (error) {
      if (error?.status === 404) {
        cachedFriendListEndpointMissing = true;
      } else {
        throw error;
      }
    }
  }

  return null;
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
  const resolveId = (value) => {
    if (!value) return "";
    if (typeof value === "string" || typeof value === "number") {
      const raw = String(value).trim();
      if (!raw) return "";
      const lowered = raw.toLowerCase();
      if (raw.includes("[object Object]") || lowered === "undefined" || lowered === "null") {
        return "";
      }
      return raw;
    }
    if (typeof value === "object") {
      if (value.$oid) return String(value.$oid);
      const nested =
        value._id ||
        value.id ||
        value.userId ||
        value.user_id ||
        value.ownerId ||
        value.authorId ||
        value.profileId ||
        value.profile_id ||
        "";
      if (nested) return resolveId(nested);
    }
    return "";
  };
  const resolvedId = resolveId(targetUserId);
  if (!resolvedId) throw new Error("Missing target user id.");
  const encodedId = encodeURIComponent(resolvedId);
  return apiFetchWithFallback([
    `/friend/status/${encodedId}`,
    `/friends/status/${encodedId}`,
    `/friends/check/${encodedId}`,
  ]);
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
  return apiFetchWithFallback(
    ["/notifications/read", "/notifications/mark-read"],
    {
      method: "PATCH",
      body: { notificationIds },
    }
  );
};

export const markAllNotificationsRead = async () => {
  return apiFetchWithFallback(
    ["/notifications/read-all", "/notifications/mark-all-read"],
    {
      method: "PATCH",
    }
  );
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

export const reportInBuzz = async (reelId, payload = {}) => {
  if (!reelId) throw new Error("Missing reel id.");
  const contentType = payload.content_type || payload.contentType || "inbuzz_reel";
  const body = {
    content_type: contentType,
    content_id: reelId,
    reported_user_id:
      payload.reported_user_id ||
      payload.reportedUserId ||
      payload.reportedUserID ||
      payload.reported_user ||
      payload.reportedUser ||
      payload.userId ||
      payload.user_id ||
      null,
    reason: payload.reason,
    details: payload.details || payload.description || payload.message || "",
    ...payload,
  };
  if (!body.reported_user_id) delete body.reported_user_id;

  try {
    return await apiFetchWithFallback(["/report", "/reports", "/moderation/report"], {
      method: "POST",
      body,
    });
  } catch (error) {
    if (error?.status && ![404, 405].includes(error.status)) {
      throw error;
    }
  }
  return reportContent({ targetType: "inbuzz", targetId: reelId, ...payload });
};

export const deleteChatMessage = async (messageId, payload = {}) => {
  if (!messageId) return null;
  const encodedId = encodeGroupParam(messageId);
  const deletePaths = [
    `/chat/messages/${encodedId}`,
    `/chat/message/${encodedId}`,
    `/messages/${encodedId}`,
    `/chat/messages/${encodedId}/delete`,
    `/chat/message/${encodedId}/delete`,
    `/chat/delete/${encodedId}`,
  ];
  try {
    return await apiFetchWithFallback(deletePaths, {
      method: "DELETE",
      body: payload,
    });
  } catch (error) {
    if (error?.status && ![404, 405].includes(error.status)) {
      throw error;
    }
  }
  return apiFetchWithFallback(deletePaths, {
    method: "POST",
    body: payload,
  });
};

export const deleteGroup = async (groupId, payload = {}) => {
  if (!groupId) return null;
  const encodedId = encodeGroupParam(groupId);
  const deletePaths = [
    `/groups/${encodedId}`,
    `/group/${encodedId}`,
    `/groups/${encodedId}/delete`,
    `/group/${encodedId}/delete`,
  ];
  try {
    return await apiFetchWithFallback(deletePaths, {
      method: "DELETE",
      body: payload,
    });
  } catch (error) {
    if (error?.status && ![404, 405].includes(error.status)) {
      throw error;
    }
  }
  return apiFetchWithFallback(deletePaths, {
    method: "POST",
    body: payload,
  });
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
