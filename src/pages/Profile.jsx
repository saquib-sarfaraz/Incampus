import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../context/authContext";
import { useApp } from "../context/useApp";
import {
  updateUser,
  updateProfileInfo,
  updateEducationInfo,
  changePassword,
  uploadProfilePic,
  deleteProfilePic,
  deletePost,
  getUserById,
  getUserPublicPosts,
  fetchRankedFeedPage,
  getFriendsList,
  getFriendCount,
  searchColleges,
} from "../services/api";
import Header from "../components/common/Header";
import BottomNav from "../components/common/BottomNav";
import BlueTick from "../components/common/BlueTick";
import PostModal from "../components/profile/PostModal";
import CreatePostModal from "../components/feed/CreatePostModal";
import UserProfileModal from "../components/profile/UserProfileModal";
import { joinSocket, leaveSocket, getSocket } from "../services/socket";
import {
  resolveUserType,
  formatUserType,
  resolveStudentType,
  formatStudentType,
  resolveCommunityType,
  formatCommunityType,
  resolveCollegeName,
  resolveCommunityName,
  resolveCommunityDescription,
  resolveMemberCount,
  buildUserPreview,
  normalizeUserId,
} from "../utils/userProfile";
import {
  readAnonymousPostIds,
  readAnonymousPosts,
  rememberAnonymousPost,
  forgetAnonymousPost,
} from "../utils/anonymousPosts";
import { readFeedSnapshotPosts } from "../utils/feedSnapshot";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const HELP_CENTER_URL = "https://incampus-help.online";
const COLLEGE_SEARCH_DEBOUNCE_MS = 150;
const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;
const AVATAR_OUTPUT_SIZE = 512;
const AVATAR_PREVIEW_SIZE = 96;
const AVATAR_ZOOM_MIN = 1;
const AVATAR_ZOOM_MAX = 3;
const ANON_RECOVERY_LIMIT = 50;
const ANON_RECOVERY_SESSION_PREFIX = "incampus:anon:recovery:";
const PROFILE_POSTS_LIMIT = 20;
const PROFILE_POSTS_CACHE_PREFIX = "incampus:profile:posts:cache:";
const PROFILE_POSTS_CACHE_TTL = 5 * 60 * 1000;
const THEME_STORAGE_KEY = "incampus-theme";
const THEME_ANIM_CLASS = "theme-transition";
const THEME_ANIM_DURATION = 400;
const readAnonSet = (userId) =>
  new Set(readAnonymousPostIds(userId).map((id) => String(id)));

const resolveStoredTheme = () => {
  if (typeof window === "undefined") return "current";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (
      stored === "current" ||
      stored === "dark" ||
      stored === "light" ||
      stored === "ocean" ||
      stored === "sky" ||
      stored === "midnight"
    ) {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return "current";
};

const readProfilePostsCache = (userId) => {
  if (!userId || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${PROFILE_POSTS_CACHE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - parsed.ts > PROFILE_POSTS_CACHE_TTL) return [];
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
};

const writeProfilePostsCache = (userId, posts) => {
  if (!userId || typeof window === "undefined") return;
  const items = Array.isArray(posts) ? posts.slice(0, 60) : [];
  try {
    localStorage.setItem(
      `${PROFILE_POSTS_CACHE_PREFIX}${userId}`,
      JSON.stringify({ ts: Date.now(), items })
    );
  } catch {
    // ignore storage errors
  }
};

const resolveIdValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") {
    const raw = String(value).trim();
    if (!raw || raw === "[object Object]") return "";
    return raw;
  }
  if (typeof value === "object") {
    if (value.$oid) return String(value.$oid);
    const nested = value._id || value.id || value.postId || value.post_id || value.value;
    if (nested) return resolveIdValue(nested);
  }
  return "";
};

const resolvePostIdentity = (post) =>
  resolveIdValue(post?._id || post?.id || post?.postId || post?.post_id || "");

const normalizeProfilePostsResponse = (response) => {
  if (Array.isArray(response)) {
    return { items: response, nextCursor: "", hasMore: undefined };
  }
  const items = Array.isArray(response?.items)
    ? response.items
    : Array.isArray(response?.posts)
      ? response.posts
      : Array.isArray(response?.publicPosts)
        ? response.publicPosts
        : Array.isArray(response?.data?.items)
          ? response.data.items
          : Array.isArray(response?.data?.posts)
            ? response.data.posts
            : Array.isArray(response?.data?.publicPosts)
              ? response.data.publicPosts
              : Array.isArray(response?.data)
                ? response.data
                : [];
  const nextCursor =
    response?.nextCursor ||
    response?.next_cursor ||
    response?.cursor ||
    response?.data?.nextCursor ||
    response?.data?.next_cursor ||
    "";
  const hasMore =
    typeof response?.hasMore === "boolean"
      ? response.hasMore
      : typeof response?.data?.hasMore === "boolean"
        ? response.data.hasMore
        : undefined;
  return { items, nextCursor, hasMore };
};

const mergePostsByIdentity = (primary = [], secondary = []) => {
  const combined = [];
  const indexById = new Map();
  const add = (post) => {
    const id = resolvePostIdentity(post);
    if (!id) {
      combined.push(post);
      return;
    }
    if (indexById.has(id)) {
      const idx = indexById.get(id);
      const current = combined[idx];
      combined[idx] = current === post ? current : { ...current, ...post };
      return;
    }
    indexById.set(id, combined.length);
    combined.push(post);
  };
  (Array.isArray(primary) ? primary : []).forEach(add);
  (Array.isArray(secondary) ? secondary : []).forEach(add);
  return combined;
};

const isPostAnonymous = (post) =>
  Boolean(
    post?.isAnonymous ||
      post?.is_anonymous ||
      post?.anonymous ||
      post?.isAnon ||
      post?.isAnonymousPost ||
      post?.author?.isAnonymous ||
    post?.author?.anonymous
  );

const shouldRunAnonRecovery = (userId) => {
  if (!userId || typeof window === "undefined") return false;
  const key = `${ANON_RECOVERY_SESSION_PREFIX}${userId}`;
  if (sessionStorage.getItem(key)) return false;
  sessionStorage.setItem(key, String(Date.now()));
  return true;
};

const resolvePostOwnerId = (post) =>
  normalizeUserId([
    post?.authorId,
    post?.author_id,
    post?.userId,
    post?.user_id,
    post?.ownerId,
    post?.owner_id,
    post?.createdById,
    post?.created_by,
    post?.creatorId,
    post?.creator_id,
    post?.author,
    post?.user,
    post?.owner,
    post?.createdBy,
    post?.creator,
    post?.__localAuthorId,
    post?.localAuthorId,
  ]);

const clampValue = (value, min, max) => Math.min(Math.max(value, min), max);

const loadImageFromFile = (file, fallbackUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image"));
    if (fallbackUrl) {
      image.src = fallbackUrl;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });

const renderAvatarCanvas = ({
  image,
  outputSize,
  cropSize,
  zoom,
  rotate,
  offset,
}) => {
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const safeCropSize = cropSize || outputSize;
  const baseScale = Math.max(safeCropSize / image.width, safeCropSize / image.height);
  const scale = baseScale * (zoom || 1);
  const outputScale = outputSize / safeCropSize;
  const offsetScale = outputScale;
  const offsetX = (offset?.x || 0) * offsetScale;
  const offsetY = (offset?.y || 0) * offsetScale;

  ctx.save();
  ctx.translate(outputSize / 2 + offsetX, outputSize / 2 + offsetY);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(scale * outputScale, scale * outputScale);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  ctx.restore();

  return canvas;
};

const getPasswordStrength = (value = "") => {
  const hasLetter = /[A-Za-z]/.test(value);
  const hasNumber = /[0-9]/.test(value);
  const hasSpecial = /[^A-Za-z0-9]/.test(value);
  const lengthScore = value.length >= 12 ? 2 : value.length >= 8 ? 1 : 0;
  const varietyScore = [hasLetter, hasNumber, hasSpecial].filter(Boolean).length;
  const score = Math.min(4, lengthScore + varietyScore);
  const label =
    score >= 4 ? "Strong" : score >= 3 ? "Good" : score >= 2 ? "Fair" : "Weak";
  const color =
    score >= 4
      ? "bg-emerald-400"
      : score >= 3
        ? "bg-green-400"
        : score >= 2
          ? "bg-amber-400"
          : "bg-red-400";
  return { score, label, color, hasLetter, hasNumber, hasSpecial };
};

const readStoredAuthToken = () => {
  if (typeof window === "undefined") return "";
  return (
    localStorage.getItem("authToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("accessToken") ||
    ""
  );
};

export default function Profile() {
  const { currentUser, setCurrentUser, logout, authToken, loading: authLoading } = useAuth();
  const { userId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    posts,
    loadPosts,
    cacheUser,
    getUserFromCache,
    setFeedScope,
    friendIds,
    friendMapLoaded,
    friendMap,
    updateAuthorProfile,
    removePost,
    prefetchUserProfile,
  } = useApp();
  const previewUser = location.state?.userPreview;
  const cachedProfileUser = useMemo(
    () => (userId ? getUserFromCache?.(userId) : null),
    [getUserFromCache, userId]
  );
  const initialProfileUser = previewUser || cachedProfileUser || (userId ? { _id: userId } : null);
  const [userPosts, setUserPosts] = useState([]);
  const [visiblePostsCount, setVisiblePostsCount] = useState(20);
  const [selectedPost, setSelectedPost] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedTheme, setSelectedTheme] = useState(() => resolveStoredTheme());
  const [profilePosts, setProfilePosts] = useState([]);
  const [profilePostsLoading, setProfilePostsLoading] = useState(false);
  const [profilePostsHasMore, setProfilePostsHasMore] = useState(true);
  const [profilePostsLoaded, setProfilePostsLoaded] = useState(false);
  const profilePostsCursorRef = useRef("");
  const profilePostsRef = useRef([]);
  const profileAuthTokenRef = useRef("");
  const [bio, setBio] = useState("");
  const [settingsName, setSettingsName] = useState("");
  const [settingsUsername, setSettingsUsername] = useState("");
  const [settingsBio, setSettingsBio] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [educationCollege, setEducationCollege] = useState("");
  const [educationYear, setEducationYear] = useState("");
  const [educationType, setEducationType] = useState("student");
  const [collegeInput, setCollegeInput] = useState("");
  const [showCollegeDropdown, setShowCollegeDropdown] = useState(false);
  const [collegeLoading, setCollegeLoading] = useState(false);
  const [collegeError, setCollegeError] = useState("");
  const [colleges, setColleges] = useState([]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [settingsSuccess, setSettingsSuccess] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [privacyPublic, setPrivacyPublic] = useState(true);
  const [friendsList, setFriendsList] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const friendsLoadedRef = useRef(false);
  const friendsLoadRequestRef = useRef(0);
  const friendsCountsLoadedRef = useRef(false);
  const friendsIdsKeyRef = useRef("");
  const [savingBio, setSavingBio] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingEducation, setSavingEducation] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState(null);
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarRotate, setAvatarRotate] = useState(0);
  const [avatarOffset, setAvatarOffset] = useState({ x: 0, y: 0 });
  const [avatarCropSize, setAvatarCropSize] = useState(0);
  const [avatarPreviewSmall, setAvatarPreviewSmall] = useState(null);
  const [avatarImageMeta, setAvatarImageMeta] = useState({ width: 0, height: 0 });
  const resolvedCurrentUserId =
    currentUser?.id || currentUser?._id || currentUser?.userId || currentUser?.user_id || "";
  const isViewingOtherUser = Boolean(
    userId && (!resolvedCurrentUserId || String(userId) !== String(resolvedCurrentUserId))
  );
  const [toast, setToast] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMobileSettings, setShowMobileSettings] = useState(false);
  const [isMobileView, setIsMobileView] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 639px)").matches;
  });
  const fileInputRef = useRef(null);
  const avatarCropRef = useRef(null);
  const avatarImageRef = useRef(null);
  const avatarDragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const avatarPreviewRafRef = useRef(null);
  const avatarBaseScale = useMemo(() => {
    if (!avatarCropSize || !avatarImageMeta.width || !avatarImageMeta.height) return 1;
    return Math.max(
      avatarCropSize / avatarImageMeta.width,
      avatarCropSize / avatarImageMeta.height
    );
  }, [avatarCropSize, avatarImageMeta]);
  const collegeRef = useRef(null);
  const profileLoadMoreRef = useRef(null);
  const [bioSuccess, setBioSuccess] = useState("");
  const userType = useMemo(() => resolveUserType(currentUser), [currentUser]);
  const isCommunity = userType === "community";
  const userTypeBadge = formatUserType(userType);
  const studentTypeLabel = formatStudentType(resolveStudentType(currentUser));
  const communityTypeLabel = formatCommunityType(resolveCommunityType(currentUser));
  const collegeLabel = resolveCollegeName(currentUser) || (isCommunity ? "" : "Verified Campus");
  const communityName = resolveCommunityName(currentUser) || currentUser?.fullName || "";
  const profileDisplayName = isCommunity
    ? communityName || "Community"
    : currentUser?.displayName || currentUser?.fullName || "User";
  const showVerifiedTick = Boolean(
    currentUser?.isVerified || currentUser?.isVerifiedCommunity
  );
  const isDarkTheme = useMemo(
    () => !["light", "sky"].includes(selectedTheme),
    [selectedTheme]
  );
  const activeThemeId = useMemo(
    () => (selectedTheme === "dark" ? "current" : selectedTheme),
    [selectedTheme]
  );
  const themeOptions = useMemo(
    () => [
      { id: "current", label: "Default", caption: "Current" },
      { id: "ocean", label: "Ocean", caption: "Brand" },
      { id: "sky", label: "Sky", caption: "Light" },
      { id: "midnight", label: "Midnight", caption: "Dark" },
    ],
    []
  );
  const applyTheme = useCallback((theme) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.add(THEME_ANIM_CLASS);
    if (theme && theme !== "current") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
    const scheme = theme === "light" || theme === "sky" ? "light" : "dark";
    root.style.colorScheme = scheme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
    window.setTimeout(() => {
      root.classList.remove(THEME_ANIM_CLASS);
    }, THEME_ANIM_DURATION);
  }, []);
  const handleToggleTheme = useCallback(() => {
    const nextTheme = isDarkTheme ? "light" : "dark";
    setSelectedTheme(nextTheme);
    applyTheme(nextTheme);
  }, [applyTheme, isDarkTheme]);
  const handleSelectTheme = useCallback(
    (theme) => {
      setSelectedTheme(theme);
      applyTheme(theme);
    },
    [applyTheme]
  );

  const loadProfilePosts = useCallback(
    async ({ reset = false } = {}) => {
      if (!resolvedCurrentUserId || isViewingOtherUser) return;
      if (profilePostsLoading) return;
      const storedToken = readStoredAuthToken();
      if (storedToken) {
        profileAuthTokenRef.current = storedToken;
      } else if (authLoading) {
        return;
      }
      setProfilePostsLoading(true);
      try {
        const cursorParam = reset ? "" : profilePostsCursorRef.current || "";
        const params = {
          limit: PROFILE_POSTS_LIMIT,
          ...(cursorParam ? { cursor: cursorParam } : {}),
        };
        const response = await getUserPublicPosts(resolvedCurrentUserId, params);
        const { items, nextCursor, hasMore } = normalizeProfilePostsResponse(response);
        const enriched = items.map((post) => {
          if (!post || typeof post !== "object") return post;
          const ownerId = resolvePostOwnerId(post);
          if (ownerId) return post;
          return { ...post, __localAuthorId: resolvedCurrentUserId };
        });
        const base = reset ? [] : profilePostsRef.current;
        const merged = mergePostsByIdentity(base, enriched);
        profilePostsRef.current = merged;
        setProfilePosts(merged);
        if (merged.length) {
          writeProfilePostsCache(resolvedCurrentUserId, merged);
        }
        if (nextCursor) {
          profilePostsCursorRef.current = nextCursor;
        }
        setProfilePostsHasMore(
          typeof hasMore === "boolean" ? hasMore : items.length >= PROFILE_POSTS_LIMIT
        );
        setProfilePostsLoaded(true);
      } catch {
        setProfilePostsHasMore(false);
        setProfilePostsLoaded(true);
      } finally {
        setProfilePostsLoading(false);
      }
    },
    [resolvedCurrentUserId, isViewingOtherUser, profilePostsLoading]
  );

  useEffect(() => {
    if (!resolvedCurrentUserId || isViewingOtherUser) return;
    profilePostsCursorRef.current = "";
    setProfilePostsHasMore(true);
    const cachedPosts = readProfilePostsCache(resolvedCurrentUserId);
    if (cachedPosts.length > 0) {
      profilePostsRef.current = cachedPosts;
      setProfilePosts(cachedPosts);
      setUserPosts(cachedPosts);
      setProfilePostsLoaded(true);
    } else {
      profilePostsRef.current = [];
      setProfilePosts([]);
      setUserPosts([]);
      setProfilePostsLoaded(false);
    }
    loadProfilePosts({ reset: true });
  }, [resolvedCurrentUserId, isViewingOtherUser, loadProfilePosts]);

  useEffect(() => {
    if (!resolvedCurrentUserId || isViewingOtherUser) return;
    if (!authToken) return;
    if (profileAuthTokenRef.current === authToken) return;
    profileAuthTokenRef.current = authToken;
    loadProfilePosts({ reset: true });
  }, [resolvedCurrentUserId, isViewingOtherUser, authToken, loadProfilePosts]);

  useEffect(() => {
    if (previewUser && previewUser._id) {
      cacheUser?.(previewUser);
    }
  }, [previewUser, cacheUser]);

  const memberCount = Number(resolveMemberCount(currentUser) || 0);
  const resolvedFriendIds = useMemo(() => {
    if (friendMapLoaded || Object.keys(friendMap || {}).length > 0) return friendIds;
    return currentUser?.friends || [];
  }, [friendIds, friendMapLoaded, friendMap, currentUser?.friends]);
  const friendCount = resolvedFriendIds.length;
  const passwordStrength = useMemo(
    () => getPasswordStrength(newPassword),
    [newPassword]
  );
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const settingsBaseName = isCommunity
    ? resolveCommunityName(currentUser) || currentUser?.fullName || ""
    : currentUser?.fullName || currentUser?.displayName || "";
  const settingsBaseUsername = currentUser?.username || "";
  const settingsBaseBio = isCommunity
    ? resolveCommunityDescription(currentUser) || ""
    : currentUser?.bio || "";
  const normalizedUsername = settingsUsername.trim().toLowerCase();
  const usernameChanged =
    normalizedUsername !== String(settingsBaseUsername || "").trim();
  const isUsernameValid = !usernameChanged || USERNAME_REGEX.test(normalizedUsername);
  const settingsChanged =
    settingsName.trim() !== String(settingsBaseName || "").trim() ||
    normalizedUsername !== String(settingsBaseUsername || "").trim() ||
    settingsBio.trim() !== String(settingsBaseBio || "").trim() ||
    privacyPublic !== (currentUser?.privacyPublic ?? true);
  const canSaveSettings =
    settingsChanged &&
    settingsName.trim().length > 1 &&
    isUsernameValid &&
    !savingSettings;
  const canUpdatePassword =
    !savingPassword &&
    newPassword.length >= 8 &&
    passwordStrength.hasLetter &&
    passwordStrength.hasNumber &&
    confirmPassword.length > 0 &&
    passwordsMatch;
  const trustScoreValue = useMemo(() => {
    const raw = Number(currentUser?.trustScore ?? currentUser?.trust_score);
    return Number.isFinite(raw) ? raw : 100;
  }, [currentUser?.trustScore, currentUser?.trust_score]);
  const warningsValue = useMemo(() => {
    const raw = Number(
      currentUser?.warnings ??
        currentUser?.warningCount ??
        currentUser?.warningsCount ??
        0
    );
    return Number.isFinite(raw) ? raw : 0;
  }, [currentUser?.warnings, currentUser?.warningCount, currentUser?.warningsCount]);
  const accountCreatedLabel = useMemo(() => {
    const raw =
      currentUser?.createdAt ||
      currentUser?.created_at ||
      currentUser?.joinedAt ||
      currentUser?.createdOn;
    if (!raw) return "—";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-US", { month: "short", year: "numeric" });
  }, [currentUser?.createdAt, currentUser?.created_at, currentUser?.joinedAt, currentUser?.createdOn]);

  const handleOpenHelp = useCallback(() => {
    if (typeof window === "undefined") return;
    const prefersCoarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    const isSmallScreen = window.innerWidth <= 768;
    const openInSameTab = prefersCoarse || isSmallScreen;
    if (openInSameTab) {
      window.location.assign(HELP_CENTER_URL);
      return;
    }
    window.open(HELP_CENTER_URL, "_blank", "noopener,noreferrer");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const handleChange = (event) => {
      setIsMobileView(event.matches);
      if (!event.matches) {
        setShowMobileSettings(false);
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  const handleOpenSettings = useCallback(() => {
    setActiveTab("settings");
    if (isMobileView) {
      setShowMobileSettings(true);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    }
  }, [isMobileView]);

  const handleCloseMobileSettings = useCallback(() => {
    setShowMobileSettings(false);
    setActiveTab("overview");
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const currentId = String(currentUser.id || currentUser._id || "");
    if (!currentId) return;
    const anonSet = readAnonSet(currentId);
    const anonSnapshots = readAnonymousPosts(currentId);
    const feedSnapshot = readFeedSnapshotPosts();
    const feedAnon = Array.isArray(feedSnapshot)
      ? feedSnapshot.filter(
          (post) =>
            isPostAnonymous(post) &&
            String(resolvePostOwnerId(post)) === String(currentId)
        )
      : [];
    feedAnon.forEach((post) => rememberAnonymousPost(currentId, post));

    const baseProfile = Array.isArray(profilePosts) ? profilePosts : [];
    const normalizedBase = baseProfile.map((post) => {
      if (!post || typeof post !== "object") return post;
      const ownerId = resolvePostOwnerId(post);
      if (ownerId) return post;
      return { ...post, __localAuthorId: currentId, __isLocalOwner: true };
    });

    const extrasSource = mergePostsByIdentity(posts || [], [
      ...anonSnapshots,
      ...feedAnon,
    ]);
    const extras = extrasSource.filter((post) => {
      const ownerId = resolvePostOwnerId(post);
      if (ownerId && String(ownerId) === currentId) return true;
      if (!ownerId) {
        const postId = resolvePostIdentity(post);
        return postId && anonSet.has(postId);
      }
      return false;
    });

    const merged = mergePostsByIdentity(normalizedBase, extras);
    const owned = merged.map((post) => {
      if (!post || typeof post !== "object") return post;
      if (post.__isLocalOwner) return post;
      const ownerId = resolvePostOwnerId(post);
      const localOwnerId = ownerId || currentId;
      return {
        ...post,
        __isLocalOwner: true,
        ...(localOwnerId ? { __localAuthorId: localOwnerId } : {}),
      };
    });
    setUserPosts(owned);
  }, [posts, currentUser, profilePosts]);

  useEffect(() => {
    const userId = currentUser?.id || currentUser?._id;
    if (!userId || isViewingOtherUser) return;
    if (!shouldRunAnonRecovery(userId)) return;
    let active = true;
    const recover = async () => {
      try {
        const response = await fetchRankedFeedPage({
          page: 1,
          limit: ANON_RECOVERY_LIMIT,
        });
        const list = Array.isArray(response?.items)
          ? response.items
          : Array.isArray(response)
            ? response
            : [];
        const recovered = list.filter(
          (post) =>
            isPostAnonymous(post) &&
            String(resolvePostOwnerId(post)) === String(userId)
        );
        if (!recovered.length) return;
        recovered.forEach((post) => rememberAnonymousPost(userId, post));
        if (!active) return;
        setUserPosts((prev) => mergePostsByIdentity(prev, recovered));
      } catch {
        // ignore recovery errors
      }
    };
    recover();
    return () => {
      active = false;
    };
  }, [currentUser?.id, currentUser?._id, isViewingOtherUser, fetchRankedFeedPage]);

  useEffect(() => {
    setVisiblePostsCount((prev) => {
      const next = userPosts.length || 0;
      if (next === 0) return 0;
      const baseline = 20;
      return Math.min(Math.max(baseline, prev), next);
    });
  }, [userPosts.length]);

  const visibleUserPosts = useMemo(
    () => userPosts.slice(0, visiblePostsCount),
    [userPosts, visiblePostsCount]
  );
  const hasMoreUserPosts = visiblePostsCount < userPosts.length;
  const canLoadMorePosts = hasMoreUserPosts || profilePostsHasMore;

  useEffect(() => {
    if (!profileLoadMoreRef.current) return;
    if (!canLoadMorePosts) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (visiblePostsCount < userPosts.length) {
          setVisiblePostsCount((prev) =>
            Math.min(prev + 20, userPosts.length)
          );
          return;
        }
        if (profilePostsHasMore && !profilePostsLoading) {
          loadProfilePosts();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(profileLoadMoreRef.current);
    return () => observer.disconnect();
  }, [
    canLoadMorePosts,
    userPosts.length,
    visiblePostsCount,
    profilePostsHasMore,
    profilePostsLoading,
    loadProfilePosts,
  ]);

  useEffect(() => {
    if (!currentUser) return;
    const resolvedIsCommunity = resolveUserType(currentUser) === "community";
    const resolvedName = resolvedIsCommunity
      ? resolveCommunityName(currentUser) || currentUser.fullName || ""
      : currentUser.fullName || "";
    const resolvedBio = resolvedIsCommunity
      ? resolveCommunityDescription(currentUser) || ""
      : currentUser.bio || "";
    setBio(resolvedBio);
    setSettingsName(resolvedName);
    setSettingsUsername(currentUser.username || "");
    setSettingsBio(resolvedBio);
    setPrivacyPublic(currentUser.privacyPublic ?? true);
    const currentCollege = currentUser.university || currentUser.college || "";
    setEducationCollege(currentCollege);
    setCollegeInput(currentCollege);
    setEducationYear(String(currentUser.graduationYear || currentUser.year || ""));
    const rawType = currentUser.studentType || currentUser.student_type || "undergraduate";
    setEducationType(rawType === "student" ? "undergraduate" : rawType);
  }, [currentUser]);

  useEffect(() => {
    if (passwordError) {
      setPasswordError("");
    }
  }, [newPassword, confirmPassword, passwordError]);

  useEffect(() => {
    if (bioSuccess) {
      setBioSuccess("");
    }
  }, [bio, bioSuccess]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timeout);
  }, [toast]);

  const normalizeCollege = (item) => {
    if (!item) return "";
    if (typeof item === "string") return item.trim();
    if (typeof item === "object") {
      return (
        item.name ||
        item.tagName ||
        item.tag ||
        item.collegeTagName ||
        item.collegeName ||
        item.college ||
        item.university ||
        item.institution ||
        item.school ||
        item.title ||
        item.value ||
        item.displayName ||
        ""
      ).trim();
    }
    return "";
  };

  useEffect(() => {
    if (!showCollegeDropdown) return;
    const query = collegeInput.trim();
    if (query.length < 2) {
      setColleges([]);
      setCollegeLoading(false);
      setCollegeError("");
      return;
    }

    let isMounted = true;
    setCollegeLoading(true);
    setCollegeError("");
    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchColleges(query, 8);
        if (!isMounted) return;
        const list = results.map(normalizeCollege).filter(Boolean);
        setColleges(list);
      } catch {
        if (isMounted) {
          setColleges([]);
          setCollegeError("Unable to load colleges. You can type your college manually.");
        }
      } finally {
        if (isMounted) setCollegeLoading(false);
      }
    }, COLLEGE_SEARCH_DEBOUNCE_MS);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [collegeInput, showCollegeDropdown]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (collegeRef.current && !collegeRef.current.contains(event.target)) {
        setShowCollegeDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const start = currentYear - 10;
    const end = currentYear + 6;
    const years = [];
    for (let year = start; year <= end; year += 1) {
      years.push(String(year));
    }
    return years;
  }, []);

  const filteredColleges = useMemo(() => {
    if (!collegeInput) return colleges;
    const query = collegeInput.toLowerCase();
    return colleges.filter((college) => college.toLowerCase().includes(query));
  }, [colleges, collegeInput]);

  const topMatches = useMemo(() => filteredColleges.slice(0, 5), [filteredColleges]);

  const handleSaveBio = async () => {
    if (!currentUser) return;
    setSavingBio(true);
    setSettingsSuccess("");
    setBioSuccess("");
    const resolvedBio = bio.trim();
    const previousBio = isCommunity
      ? currentUser?.communityDescription || ""
      : currentUser?.bio || "";
    try {
      if (isCommunity) {
        setCurrentUser((prev) => ({ ...prev, communityDescription: resolvedBio }));
        setSettingsBio(resolvedBio);
        updateAuthorProfile(currentUser.id, {
          communityDescription: resolvedBio,
          displayName: resolveCommunityName(currentUser) || currentUser.displayName,
        });
        await updateUser({ communityDescription: resolvedBio });
      } else {
        setCurrentUser((prev) => ({ ...prev, bio: resolvedBio }));
        setSettingsBio(resolvedBio);
        updateAuthorProfile(currentUser.id, {
          fullName: currentUser.fullName,
          displayName: currentUser.displayName || currentUser.fullName,
          bio: resolvedBio,
        });
        await updateProfileInfo({ bio: resolvedBio });
      }
      const socket = getSocket();
      socket?.emit("user-profile-updated", {
        userId: currentUser.id,
        fullName: currentUser.fullName,
        displayName: currentUser.displayName || currentUser.fullName,
        bio: resolvedBio,
        communityDescription: isCommunity ? resolvedBio : undefined,
      });
      const successLabel = isCommunity ? "Description updated." : "Bio updated.";
      setBioSuccess(successLabel);
      setSettingsSuccess(successLabel);
      setTimeout(() => {
        setBioSuccess("");
        setSettingsSuccess("");
      }, 2500);
    } catch (error) {
      if (isCommunity) {
        setCurrentUser((prev) => ({ ...prev, communityDescription: previousBio }));
        setSettingsBio(previousBio);
        updateAuthorProfile(currentUser.id, {
          communityDescription: previousBio,
          displayName: resolveCommunityName(currentUser) || currentUser.displayName,
        });
      } else {
        setCurrentUser((prev) => ({ ...prev, bio: previousBio }));
        setSettingsBio(previousBio);
        updateAuthorProfile(currentUser.id, {
          fullName: currentUser.fullName,
          displayName: currentUser.displayName || currentUser.fullName,
          bio: previousBio,
        });
      }
      alert(error.message || "Failed to update bio");
    } finally {
      setSavingBio(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!currentUser) return;
    if (!settingsChanged) return;
    if (!isUsernameValid) {
      setUsernameError("Username must be 3-30 characters and use a-z, 0-9, _.");
      return;
    }
    setSavingSettings(true);
    setSettingsSuccess("");
    setUsernameError("");
    const resolvedName = settingsName.trim();
    const resolvedUsername = normalizedUsername;
    const resolvedBio = settingsBio.trim();
    const previousSnapshot = {
      fullName: currentUser.fullName || "",
      displayName: currentUser.displayName || "",
      bio: currentUser.bio || "",
      communityName: currentUser.communityName || "",
      communityDescription: currentUser.communityDescription || "",
      privacyPublic: currentUser.privacyPublic,
      username: currentUser.username || "",
    };
    try {
      if (isCommunity) {
        setCurrentUser((prev) => ({
          ...prev,
          communityName: resolvedName,
          displayName: resolvedName,
          communityDescription: resolvedBio,
          privacyPublic,
          username: resolvedUsername || prev?.username,
        }));
        setSettingsName(resolvedName);
        if (usernameChanged) setSettingsUsername(resolvedUsername);
        setSettingsBio(resolvedBio);
        updateAuthorProfile(currentUser.id, {
          communityName: resolvedName,
          displayName: resolvedName,
          communityDescription: resolvedBio,
          username: resolvedUsername || currentUser.username,
        });
        const payload = {
          communityName: resolvedName,
          communityDescription: resolvedBio,
          privacyPublic,
        };
        if (usernameChanged) payload.username = resolvedUsername;
        await updateUser(payload);
      } else {
        setCurrentUser((prev) => ({
          ...prev,
          fullName: resolvedName,
          displayName: resolvedName,
          bio: resolvedBio,
          privacyPublic,
          username: resolvedUsername || prev?.username,
        }));
        setSettingsName(resolvedName);
        if (usernameChanged) setSettingsUsername(resolvedUsername);
        setSettingsBio(resolvedBio);
        updateAuthorProfile(currentUser.id, {
          fullName: resolvedName,
          displayName: resolvedName,
          bio: resolvedBio,
          username: resolvedUsername || currentUser.username,
        });
        const payload = {
          fullName: resolvedName,
          bio: resolvedBio,
          privacyPublic,
        };
        if (usernameChanged) payload.username = resolvedUsername;
        await updateProfileInfo(payload);
      }
      const socket = getSocket();
      socket?.emit("user-profile-updated", {
        userId: currentUser.id,
        fullName: isCommunity ? undefined : resolvedName,
        displayName: resolvedName,
        bio: isCommunity ? undefined : resolvedBio,
        communityName: isCommunity ? resolvedName : undefined,
        communityDescription: isCommunity ? resolvedBio : undefined,
        username: usernameChanged ? resolvedUsername : currentUser.username,
      });
      setSettingsSuccess("Settings updated!");
      setTimeout(() => setSettingsSuccess(""), 2500);
    } catch (error) {
      const errorMessage = error?.message || "Failed to update settings";
      const isUsernameIssue = errorMessage.toLowerCase().includes("username");
      if (isCommunity) {
        setCurrentUser((prev) => ({
          ...prev,
          communityName: previousSnapshot.communityName,
          displayName: previousSnapshot.communityName || previousSnapshot.displayName,
          communityDescription: previousSnapshot.communityDescription,
          privacyPublic: previousSnapshot.privacyPublic,
          username: previousSnapshot.username,
        }));
        setSettingsName(previousSnapshot.communityName || settingsName);
        setSettingsUsername(previousSnapshot.username || settingsUsername);
        setSettingsBio(previousSnapshot.communityDescription || settingsBio);
        updateAuthorProfile(currentUser.id, {
          communityName: previousSnapshot.communityName,
          displayName: previousSnapshot.communityName || previousSnapshot.displayName,
          communityDescription: previousSnapshot.communityDescription,
          username: previousSnapshot.username,
        });
      } else {
        setCurrentUser((prev) => ({
          ...prev,
          fullName: previousSnapshot.fullName,
          displayName: previousSnapshot.displayName || previousSnapshot.fullName,
          bio: previousSnapshot.bio,
          privacyPublic: previousSnapshot.privacyPublic,
          username: previousSnapshot.username,
        }));
        setSettingsName(previousSnapshot.fullName || settingsName);
        setSettingsUsername(previousSnapshot.username || settingsUsername);
        setSettingsBio(previousSnapshot.bio || settingsBio);
        updateAuthorProfile(currentUser.id, {
          fullName: previousSnapshot.fullName,
          displayName: previousSnapshot.displayName || previousSnapshot.fullName,
          bio: previousSnapshot.bio,
          username: previousSnapshot.username,
        });
      }
      if (isUsernameIssue) {
        setUsernameError(errorMessage);
      } else {
        alert(errorMessage);
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const buildCollegeRoom = (collegeId, collegeName) => {
    const rawId = collegeId || "";
    if (rawId) {
      const value = String(rawId);
      return value.startsWith("group:") ? value : `group:college:${value}`;
    }
    if (!collegeName) return null;
    const slug = String(collegeName)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug ? `group:college:${slug}` : null;
  };

  const handleSaveEducation = async () => {
    if (isCommunity) return;
    if (!educationCollege.trim() || !educationYear || !educationType) {
      alert("Please complete your education details.");
      return;
    }
    setSavingEducation(true);
    try {
      const oldCollege = currentUser?.university || currentUser?.college || "";
      const oldCollegeId =
        currentUser?.collegeGroupId ||
        currentUser?.college_group_id ||
        currentUser?.groupId ||
        currentUser?.collegeGroup ||
        "";
      const isAlumniLevel = educationType === "alumni";
      const payload = {
        university: educationCollege.trim(),
        college: educationCollege.trim(),
        graduationYear: educationYear,
        year: educationYear,
        student_type: educationType,
        studentType: educationType,
      };
      if (isAlumniLevel) {
        payload.passoutYear = educationYear;
      }
      const result = await updateEducationInfo(payload);
      const updated = result.user || result || {};
      const newCollege = updated.university || updated.college || educationCollege.trim();
      const newCollegeId =
        updated.collegeGroupId ||
        updated.college_group_id ||
        updated.groupId ||
        updated.collegeGroup ||
        "";

      setCurrentUser((prev) => ({
        ...prev,
        university: newCollege,
        graduationYear: updated.graduationYear || educationYear,
        year: updated.year || educationYear,
        studentType: updated.studentType || updated.student_type || educationType,
        student_type: updated.student_type || educationType,
        passoutYear: updated.passoutYear || updated.passout_year || prev?.passoutYear || "",
        collegeGroupId:
          updated.collegeGroupId ||
          updated.college_group_id ||
          updated.groupId ||
          prev?.collegeGroupId ||
          null,
      }));

      if (oldCollege && newCollege && oldCollege.toLowerCase() !== newCollege.toLowerCase()) {
        const oldRoom = buildCollegeRoom(oldCollegeId, oldCollege);
        const newRoom = buildCollegeRoom(newCollegeId, newCollege);
        if (oldRoom) leaveSocket(oldRoom);
        if (newRoom) joinSocket(newRoom);
        setFeedScope("college");
      }
      alert("Education updated!");
    } catch (error) {
      alert(error.message || "Failed to update education");
    } finally {
      setSavingEducation(false);
    }
  };

  const handlePasswordChange = async (event) => {
    if (event?.preventDefault) {
      event.preventDefault();
    }
    setPasswordError("");
    setPasswordSuccess("");
    if (!newPassword) {
      setPasswordError("Please enter a new password.");
      return;
    }
    if (!passwordStrength.hasLetter || !passwordStrength.hasNumber || newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters and include letters and numbers.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      const result = await changePassword({ newPassword, confirmPassword });
      setNewPassword("");
      setConfirmPassword("");
      const shouldForceLogout = Boolean(
        result?.forceLogout ??
          result?.force_logout ??
          result?.logout ??
          result?.logoutRequired ??
          result?.requireLogout
      );
      if (shouldForceLogout) {
        setPasswordSuccess("Password updated. Please log in again.");
        setTimeout(() => setPasswordSuccess(""), 2500);
        setTimeout(() => {
          logout();
        }, 1200);
      } else {
        setPasswordSuccess("Password updated.");
        setTimeout(() => setPasswordSuccess(""), 2500);
      }
    } catch (error) {
      setPasswordError(error.message || "Failed to update password");
    } finally {
      setSavingPassword(false);
    }
  };

  const resetAvatarModal = useCallback(() => {
    setShowAvatarModal(false);
    setAvatarFile(null);
    setAvatarZoom(1);
    setAvatarRotate(0);
    setAvatarOffset({ x: 0, y: 0 });
    setAvatarCropSize(0);
    setAvatarImageMeta({ width: 0, height: 0 });
    setAvatarPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setAvatarPreviewSmall((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    avatarImageRef.current = null;
  }, []);

  const openAvatarModal = (file) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return previewUrl;
    });
    setAvatarFile(file);
    setAvatarZoom(1);
    setAvatarRotate(0);
    setAvatarOffset({ x: 0, y: 0 });
    setAvatarImageMeta({ width: 0, height: 0 });
    setAvatarPreviewSmall((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setShowAvatarModal(true);
  };

  useEffect(() => {
    if (!showAvatarModal) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [showAvatarModal]);

  useEffect(() => {
    if (!avatarFile || !avatarPreviewUrl) {
      avatarImageRef.current = null;
      setAvatarImageMeta({ width: 0, height: 0 });
      return;
    }
    let active = true;
    loadImageFromFile(avatarFile, avatarPreviewUrl)
      .then((image) => {
        if (!active) return;
        avatarImageRef.current = image;
        setAvatarImageMeta({ width: image.width, height: image.height });
      })
      .catch(() => {
        if (!active) return;
        avatarImageRef.current = null;
        setAvatarImageMeta({ width: 0, height: 0 });
      });
    return () => {
      active = false;
    };
  }, [avatarFile, avatarPreviewUrl]);

  useEffect(() => {
    if (!showAvatarModal) return undefined;
    const node = avatarCropRef.current;
    if (!node) return undefined;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setAvatarCropSize(rect.width || 0);
    };
    updateSize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSize);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [showAvatarModal]);

  useEffect(() => {
    if (!showAvatarModal || !avatarImageRef.current || !avatarCropSize) return undefined;
    if (avatarPreviewRafRef.current) {
      cancelAnimationFrame(avatarPreviewRafRef.current);
    }
    avatarPreviewRafRef.current = requestAnimationFrame(() => {
      const canvas = renderAvatarCanvas({
        image: avatarImageRef.current,
        outputSize: AVATAR_PREVIEW_SIZE,
        cropSize: avatarCropSize,
        zoom: avatarZoom,
        rotate: avatarRotate,
        offset: avatarOffset,
      });
      if (!canvas) return;
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          setAvatarPreviewSmall((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
        },
        "image/jpeg",
        0.85
      );
    });
    return () => {
      if (avatarPreviewRafRef.current) {
        cancelAnimationFrame(avatarPreviewRafRef.current);
        avatarPreviewRafRef.current = null;
      }
    };
  }, [showAvatarModal, avatarCropSize, avatarZoom, avatarRotate, avatarOffset]);

  const clampAvatarOffset = useCallback(
    (nextOffset) => {
      if (!avatarCropSize || !avatarImageMeta.width || !avatarImageMeta.height) {
        return nextOffset;
      }
      const rotation = ((avatarRotate % 360) + 360) % 360;
      const rotated = rotation === 90 || rotation === 270;
      const sourceWidth = rotated ? avatarImageMeta.height : avatarImageMeta.width;
      const sourceHeight = rotated ? avatarImageMeta.width : avatarImageMeta.height;
      const scaledWidth = sourceWidth * avatarBaseScale * avatarZoom;
      const scaledHeight = sourceHeight * avatarBaseScale * avatarZoom;
      const maxX = Math.max(0, (scaledWidth - avatarCropSize) / 2);
      const maxY = Math.max(0, (scaledHeight - avatarCropSize) / 2);
      return {
        x: clampValue(nextOffset?.x || 0, -maxX, maxX),
        y: clampValue(nextOffset?.y || 0, -maxY, maxY),
      };
    },
    [
      avatarCropSize,
      avatarImageMeta.width,
      avatarImageMeta.height,
      avatarBaseScale,
      avatarZoom,
      avatarRotate,
    ]
  );

  useEffect(() => {
    if (!showAvatarModal) return;
    setAvatarOffset((prev) => {
      const next = clampAvatarOffset(prev);
      if (next.x === prev.x && next.y === prev.y) return prev;
      return next;
    });
  }, [showAvatarModal, avatarZoom, avatarRotate, avatarCropSize, avatarBaseScale, clampAvatarOffset]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      alert("Please upload a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      alert("Maximum upload size is 20MB.");
      return;
    }
    openAvatarModal(file);
  };

  const handleAvatarPointerDown = (event) => {
    if (!showAvatarModal) return;
    if (event.currentTarget?.setPointerCapture && event.pointerId !== undefined) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    avatarDragRef.current.dragging = true;
    avatarDragRef.current.startX = event.clientX ?? 0;
    avatarDragRef.current.startY = event.clientY ?? 0;
    avatarDragRef.current.originX = avatarOffset.x;
    avatarDragRef.current.originY = avatarOffset.y;
  };

  const handleAvatarPointerMove = (event) => {
    if (!avatarDragRef.current.dragging) return;
    event.preventDefault();
    const clientX = event.clientX ?? 0;
    const clientY = event.clientY ?? 0;
    const dx = clientX - avatarDragRef.current.startX;
    const dy = clientY - avatarDragRef.current.startY;
    setAvatarOffset(
      clampAvatarOffset({
        x: avatarDragRef.current.originX + dx,
        y: avatarDragRef.current.originY + dy,
      })
    );
  };

  const handleAvatarPointerUp = (event) => {
    avatarDragRef.current.dragging = false;
    if (event?.currentTarget?.releasePointerCapture && event.pointerId !== undefined) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore pointer release errors.
      }
    }
  };

  const handleSaveAvatar = async () => {
    if (!currentUser || !avatarImageRef.current || !avatarFile) return;
    setSavingPhoto(true);
    const previousUrl =
      currentUser?.profilePicUrl ||
      currentUser?.profilePic ||
      currentUser?.avatarUrl ||
      currentUser?.avatar ||
      null;
    const canvas = renderAvatarCanvas({
      image: avatarImageRef.current,
      outputSize: AVATAR_OUTPUT_SIZE,
      cropSize: avatarCropSize || AVATAR_OUTPUT_SIZE,
      zoom: avatarZoom,
      rotate: avatarRotate,
      offset: avatarOffset,
    });
    if (!canvas) {
      setSavingPhoto(false);
      alert("Unable to prepare image.");
      return;
    }
    const processedFile = await new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(avatarFile);
            return;
          }
          resolve(
            new File([blob], avatarFile.name.replace(/\.[^/.]+$/, ".jpg"), {
              type: "image/jpeg",
            })
          );
        },
        "image/jpeg",
        0.85
      );
    });

    const previewUrl = URL.createObjectURL(processedFile);
    let finalUrl = previewUrl;
    setCurrentUser((prev) => ({ ...prev, profilePicUrl: previewUrl }));
    updateAuthorProfile(currentUser.id, { profilePicUrl: previewUrl });
    try {
      const result = await uploadProfilePic(processedFile);
      finalUrl =
        result?.profilePicUrl ||
        result?.profilePic ||
        result?.url ||
        result?.data?.profilePicUrl ||
        previewUrl;
      setCurrentUser((prev) => ({ ...prev, profilePicUrl: finalUrl }));
      updateAuthorProfile(currentUser.id, { profilePicUrl: finalUrl });
      alert("Profile picture updated!");
      resetAvatarModal();
    } catch (error) {
      setCurrentUser((prev) => ({ ...prev, profilePicUrl: previousUrl }));
      updateAuthorProfile(currentUser.id, { profilePicUrl: previousUrl });
      alert(error.message || "Upload failed");
    } finally {
      setSavingPhoto(false);
      if (previewUrl && previewUrl.startsWith("blob:") && previewUrl !== finalUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    }
  };

  const handleDeletePhoto = async () => {
    if (!confirm("Delete profile picture?")) return;
    setSavingPhoto(true);
    try {
      await deleteProfilePic();
      setCurrentUser((prev) => ({ ...prev, profilePicUrl: null }));
      if (currentUser?.id) {
        updateAuthorProfile(currentUser.id, { profilePicUrl: null });
      }
      alert("Profile picture removed");
    } catch (error) {
      alert(error.message || "Delete failed");
    } finally {
      setSavingPhoto(false);
    }
  };

  const handleDeletePost = async (postId) => {
    if (!confirm("Delete this post?")) return;
    const targetId = String(postId || "");
    const currentUserId = currentUser?.id || currentUser?._id;
    if (targetId) {
      removePost(targetId);
      if (currentUserId) {
        forgetAnonymousPost(currentUserId, targetId);
      }
      setUserPosts((prev) =>
        prev.filter(
          (post) => resolvePostIdentity(post) !== targetId
        )
      );
      setProfilePosts((prev) => {
        const next = prev.filter((post) => resolvePostIdentity(post) !== targetId);
        profilePostsRef.current = next;
        if (currentUserId) {
          writeProfilePostsCache(currentUserId, next);
        }
        return next;
      });
    }
    setToast({ title: "Post Deleted", message: "Your post was removed." });
    try {
      await deletePost(postId);
    } catch (error) {
      if (targetId) {
        await loadPosts();
      }
      alert(error.message || "Failed to delete post");
    }
  };

  const loadFriends = useCallback(async () => {
    const requestId = ++friendsLoadRequestRef.current;
    const friendIds = Array.isArray(resolvedFriendIds) ? resolvedFriendIds : [];
    const idsKey = friendIds.map((id) => String(id)).join("|");
    const shouldFetchCounts = activeTab === "friends";
    if (idsKey && idsKey !== friendsIdsKeyRef.current) {
      friendsCountsLoadedRef.current = false;
    }
    if (
      friendsLoadedRef.current &&
      idsKey &&
      idsKey === friendsIdsKeyRef.current &&
      (!shouldFetchCounts || friendsCountsLoadedRef.current)
    ) {
      return;
    }
    friendsIdsKeyRef.current = idsKey;

    if (!friendIds.length) {
      if (friendMapLoaded || (currentUser?.friends?.length || 0) === 0) {
        if (requestId !== friendsLoadRequestRef.current) return;
        setFriendsList([]);
        friendsLoadedRef.current = true;
      }
      setFriendsLoading(false);
      return;
    }

    const resolveCandidateId = (value) => {
      if (!value) return "";
      if (typeof value === "string" || typeof value === "number") return String(value);
      return String(
        value._id ||
          value.id ||
          value.userId ||
          value.user_id ||
          value.friendId ||
          value.friend_id ||
          value.ownerId ||
          value.authorId ||
          value.otherUserId ||
          value.targetUserId ||
          ""
      );
    };

    const resolveFriendEntity = (raw, fallbackId) => {
      if (!raw || typeof raw !== "object") return null;
      const friendId = fallbackId ? String(fallbackId) : "";
      const currentId = currentUser?.id ? String(currentUser.id) : "";
      const candidates = [
        raw.friend,
        raw.friendUser,
        raw.friendProfile,
        raw.user,
        raw.owner,
        raw.createdBy,
        raw.otherUser,
        raw.targetUser,
        raw.userA,
        raw.userB,
        raw.user1,
        raw.user2,
        raw.sender,
        raw.receiver,
      ];

      if (friendId) {
        for (const candidate of candidates) {
          const candidateId = resolveCandidateId(candidate);
          if (candidateId && candidateId === friendId) {
            return candidate;
          }
        }
        const rawId = resolveCandidateId(raw);
        if (rawId && rawId === friendId) return raw;
      }

      if (currentId) {
        for (const candidate of candidates) {
          const candidateId = resolveCandidateId(candidate);
          if (candidateId && candidateId !== currentId) {
            return candidate;
          }
        }
      }

      return raw.user || raw.friend || raw.owner || raw.createdBy || raw;
    };

    const normalizeFriend = (raw, fallbackId) => {
      if (!raw) {
        return {
          id: fallbackId,
          displayName: "User",
          profilePicUrl: ANONYMOUS_AVATAR,
          isVerified: false,
          friendCount: undefined,
          friendsCount: undefined,
        };
      }
      if (typeof raw === "string" || typeof raw === "number") {
        return {
          id: String(raw),
          displayName: "User",
          profilePicUrl: ANONYMOUS_AVATAR,
          isVerified: false,
          friendCount: undefined,
          friendsCount: undefined,
        };
      }
      const entity = resolveFriendEntity(raw, fallbackId);
      const baseId = resolveCandidateId(entity) || fallbackId;
      const baseName =
        entity?.displayName ||
        entity?.fullName ||
        entity?.name ||
        entity?.username ||
        raw.displayName ||
        raw.fullName ||
        raw.name ||
        raw.username ||
        "User";
      const baseAvatar =
        entity?.profilePicUrl ||
        entity?.profilePic ||
        entity?.avatarUrl ||
        entity?.avatar ||
        raw.profilePicUrl ||
        raw.profilePic ||
        raw.avatarUrl ||
        raw.avatar ||
        ANONYMOUS_AVATAR;
      const baseVerified = Boolean(
        entity?.isVerified ||
          entity?.isVerifiedCommunity ||
          entity?.verifiedCommunity ||
          entity?.communityVerified ||
          entity?.verified ||
          entity?.is_verified ||
          raw.isVerified ||
          raw.isVerifiedCommunity ||
          raw.verifiedCommunity ||
          raw.communityVerified ||
          raw.verified ||
          raw.is_verified
      );
      const count =
        entity?.friendCount ??
        entity?.friendsCount ??
        entity?.friends_count ??
        raw.friendCount ??
        raw.friendsCount ??
        raw.friends_count ??
        (Array.isArray(entity?.friends) ? entity.friends.length : undefined) ??
        (Array.isArray(raw.friends) ? raw.friends.length : undefined);
      return {
        id: baseId,
        fullName: entity?.fullName || raw.fullName,
        displayName: baseName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
        profilePicUrl: baseAvatar,
        isVerified: baseVerified,
        bio: entity?.bio || raw.bio || "",
        university:
          entity?.university ||
          entity?.college ||
          raw.university ||
          raw.college ||
          "",
        friends: Array.isArray(entity?.friends)
          ? entity.friends
          : Array.isArray(raw.friends)
            ? raw.friends
            : undefined,
        friendCount: count,
        friendsCount: count,
        username: entity?.username || raw.username,
      };
    };

    const cachedById = new Map();
    const seedList = friendIds.map((friendId) => {
      const cached = getUserFromCache(friendId);
      if (cached) {
        cachedById.set(String(friendId), cached);
        return normalizeFriend(cached, friendId);
      }
      return normalizeFriend(null, friendId);
    });

    if (friendsList.length === 0) {
      setFriendsList(seedList);
    }

    const shouldShowLoading = false;
    setFriendsLoading(false);

    try {
      let listData = null;
      try {
        listData = await getFriendsList({
          userId: currentUser?.id,
          targetUserId: currentUser?.id,
        });
      } catch {
        listData = null;
      }

      if (requestId !== friendsLoadRequestRef.current) return;

      if (Array.isArray(listData) && listData.length > 0) {
        const listIndex = new Map();
        listData.forEach((item) => {
          const ids = new Set();
          [
            item?._id,
            item?.id,
            item?.userId,
            item?.user_id,
            item?.friendId,
            item?.friend_id,
            item?.user?._id,
            item?.user?.id,
            item?.friend?._id,
            item?.friend?.id,
            item?.otherUser?._id,
            item?.otherUser?.id,
            item?.targetUser?._id,
            item?.targetUser?.id,
            item?.userA?._id,
            item?.userA?.id,
            item?.userB?._id,
            item?.userB?.id,
          ].forEach((value) => {
            const id = resolveCandidateId(value);
            if (id) ids.add(id);
          });
          ids.forEach((id) => listIndex.set(id, item));
        });

        const mergedFromList = friendIds
          .map((friendId) => {
            const key = String(friendId);
            const item = listIndex.get(key);
            return normalizeFriend(item, friendId);
          })
          .filter(Boolean);
        if (mergedFromList.length > 0) {
          setFriendsList(mergedFromList);
        }
      }

      const missingIds = friendIds.filter(
        (friendId) => !cachedById.has(String(friendId))
      );
      missingIds.forEach(async (friendId) => {
        const userData = await getUserById(friendId);
        if (!userData) return;
        if (requestId !== friendsLoadRequestRef.current) return;
        cacheUser(userData);
        const normalized = normalizeFriend(userData, friendId);
        setFriendsList((prev) =>
          prev.map((item) =>
            String(item.id) === String(friendId) ? { ...item, ...normalized } : item
          )
        );
      });

      friendsLoadedRef.current = true;
      if (shouldFetchCounts) friendsCountsLoadedRef.current = true;

      // Fetch missing friend counts in the background.
      if (shouldFetchCounts) {
        friendIds.forEach((friendId) => {
          const existing = seedList.find((item) => String(item.id) === String(friendId));
          const existingCount =
            existing?.friendCount ??
            existing?.friendsCount ??
            (Array.isArray(existing?.friends) ? existing.friends.length : undefined);
          if (existingCount !== undefined && existingCount !== null) return;
          getFriendCount(friendId).then((fetchedCount) => {
            if (!Number.isFinite(fetchedCount)) return;
            if (requestId !== friendsLoadRequestRef.current) return;
            setFriendsList((prev) =>
              prev.map((item) =>
                String(item.id) === String(friendId)
                  ? {
                      ...item,
                      friendCount: fetchedCount,
                      friendsCount: fetchedCount,
                    }
                  : item
              )
            );
          });
        });
        friendsCountsLoadedRef.current = true;
      }
    } catch (_error) {
      void _error;
    } finally {
      if (requestId === friendsLoadRequestRef.current) {
        friendsLoadedRef.current = true;
        if (shouldShowLoading) setFriendsLoading(false);
      }
    }
  }, [
    resolvedFriendIds,
    friendMapLoaded,
    currentUser?.friends?.length,
    currentUser?.id,
    activeTab,
    friendsList.length,
    cacheUser,
    getUserFromCache,
  ]);

  useEffect(() => {
    if (activeTab === "friends" && !isCommunity) {
      loadFriends();
    }
  }, [activeTab, loadFriends, isCommunity]);

  useEffect(() => {
    if (!isCommunity && resolvedFriendIds?.length) {
      loadFriends();
    }
  }, [isCommunity, resolvedFriendIds, loadFriends]);

  useEffect(() => {
    if (isCommunity && activeTab === "friends") {
      setActiveTab("overview");
    }
  }, [isCommunity, activeTab]);


  if (isViewingOtherUser) {
    return (
      <div className="min-h-[100dvh] bg-[#1a120b]">
        <Header />
        <main className="pt-4 pb-24 sm:pb-6">
          <UserProfileModal
            isOpen
            variant="page"
            user={initialProfileUser || { _id: userId }}
            onClose={() => navigate(-1)}
            currentUser={currentUser}
          />
        </main>
        <BottomNav hidden={false} />
      </div>
    );
  }

  const showSettingsOnly = isMobileView && showMobileSettings;
  const resolvedActiveTab = showSettingsOnly ? "settings" : activeTab;

  return (
    <div className="min-h-screen pb-24 sm:pb-0">
      <Header />
      <main className="max-w-5xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Profile Header */}
        {!showSettingsOnly && (
          <>
            <Motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card glass-hover rounded-3xl p-6 mb-6 transition-all duration-300 ease-out relative"
            >
              <button
                type="button"
                onClick={handleOpenSettings}
                className="sm:hidden absolute top-4 right-4 h-9 w-9 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] flex items-center justify-center hover:bg-white/10 transition-colors"
                aria-label="Open settings"
              >
                <i className="fa-solid fa-gear text-sm"></i>
              </button>
              <div className="flex flex-col items-center text-center">
                <div className="relative mb-4">
                  <img
                    src={
                      currentUser?.profilePicUrl ||
                      currentUser?.profilePic ||
                      currentUser?.avatarUrl ||
                      currentUser?.avatar ||
                      currentUser?.photoUrl ||
                      currentUser?.photo ||
                      currentUser?.imageUrl ||
                      currentUser?.image ||
                      ANONYMOUS_AVATAR
                    }
                    alt={currentUser?.displayName || "Profile"}
                    className="w-24 h-24 rounded-full object-cover mx-auto border border-[#b9b4c7]"
                  />
                </div>
                <h2 className="text-2xl font-semibold text-[#faf0e6] mb-1 flex items-center justify-center">
                  {profileDisplayName}
                  {showVerifiedTick && <BlueTick />}
                </h2>
                <p className="text-sm text-[#b9b4c7] mb-2">
                  @{currentUser?.username || "unknown"}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
                  <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] text-[#faf0e6]">
                    {userTypeBadge}
                  </span>
                  {!isCommunity && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-[#faf0e6]">
                      {studentTypeLabel}
                    </span>
                  )}
                  {isCommunity && communityTypeLabel && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-[#faf0e6]">
                      {communityTypeLabel}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#b9b4c7]">
                  {collegeLabel || (isCommunity ? "Community" : "Verified Campus")}
                </p>

                <div className="mt-5 flex justify-center space-x-6 text-sm text-[#b9b4c7]">
                  <div className="flex flex-col items-center">
                    <p className="font-semibold text-[#faf0e6] text-lg">{userPosts.length}</p>
                    <p>Posts</p>
                  </div>
                  {isCommunity ? (
                    <div className="flex flex-col items-center">
                      <p className="font-semibold text-[#faf0e6] text-lg">{memberCount}</p>
                      <p>Members</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <p className="font-semibold text-[#faf0e6] text-lg">
                        {friendCount}
                      </p>
                      <p>Friends</p>
                    </div>
                  )}
                </div>
              </div>
            </Motion.div>

            <div className="flex gap-2 mb-6">
              {[
                { key: "overview", label: "Overview" },
                ...(isCommunity ? [] : [{ key: "friends", label: "Friends" }]),
                { key: "settings", label: "Settings" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() =>
                    tab.key === "settings"
                      ? handleOpenSettings()
                      : setActiveTab(tab.key)
                  }
                  className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                    tab.key === "settings" ? "hidden sm:flex" : ""
                  } ${
                    resolvedActiveTab === tab.key
                      ? "liquid-button text-[#faf0e6]"
                      : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </>
        )}

        {showSettingsOnly && (
          <div className="flex items-center gap-3 mb-4 sm:hidden">
            <button
              type="button"
              onClick={handleCloseMobileSettings}
              className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] flex items-center justify-center hover:bg-white/10 transition-colors"
              aria-label="Back to profile"
            >
              <i className="fa-solid fa-arrow-left"></i>
            </button>
            <h2 className="text-lg font-semibold text-[#faf0e6]">Settings</h2>
          </div>
        )}

        {resolvedActiveTab === "overview" && (
          <div className="space-y-6">
            <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[#faf0e6]">
                  {isCommunity ? "Description" : "Bio"}
                </h3>
                {!isCommunity && (
                  <span className="text-xs text-[#b9b4c7]">Visible to friends</span>
                )}
              </div>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder={
                  isCommunity
                    ? "Describe what your community is about..."
                    : "Share a short bio about yourself..."
                }
                rows="3"
                className="w-full rounded-2xl glass-input p-3 text-sm resize-none"
              />
              <div className="mt-3 flex items-center justify-between">
                {bioSuccess ? (
                  <p className="text-xs text-emerald-200">{bioSuccess}</p>
                ) : (
                  <span />
                )}
                <Motion.button
                  onClick={handleSaveBio}
                  disabled={savingBio}
                  className="liquid-button text-white text-xs font-semibold px-4 py-2 rounded-full disabled:opacity-50"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {isCommunity ? "Save Description" : "Save Bio"}
                </Motion.button>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-xl font-semibold text-[#faf0e6] mb-4 border-b pb-2 border-white/10">
                Your Posts
              </h3>

              {!profilePostsLoaded && userPosts.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
                    <div
                      key={`profile-initial-loading-${item}`}
                      className="aspect-square rounded-lg border border-white/10 bg-white/5 animate-pulse"
                    >
                      <div className="h-full w-full rounded-lg bg-white/10" />
                    </div>
                  ))}
                </div>
              ) : userPosts.length === 0 ? (
                <div className="text-center p-12 glass-card rounded-3xl mt-6">
                  <i className="fa-solid fa-ghost text-3xl text-[#b9b4c7] mb-3"></i>
                  <p className="text-[#b9b4c7]">
                    You haven't posted anything yet. Be the first!
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {visibleUserPosts.map((post, index) => (
                    <Motion.div
                      key={
                        resolvePostIdentity(post) || `post-${index}`
                      }
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05 }}
                      className="aspect-square relative group cursor-pointer"
                      onClick={() => {
                        const ownerId = resolvedCurrentUserId;
                        if (ownerId) {
                          setSelectedPost({
                            ...post,
                            __isLocalOwner: true,
                            __localAuthorId: ownerId,
                          });
                        } else {
                          setSelectedPost(post);
                        }
                      }}
                    >
                      {post.mediaUrl ? (
                        <img
                          src={post.mediaUrl}
                          alt="Post"
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-full h-full bg-white/5 rounded-lg flex items-center justify-center">
                          <i className="fa-solid fa-file-text text-2xl text-[#b9b4c7]"></i>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 rounded-lg transition-all flex items-center justify-center">
                        <div className="opacity-0 group-hover:opacity-100 flex space-x-4 text-[#faf0e6]">
                          <span>
                            <i className="fa-solid fa-heart mr-1"></i>
                            {post.likesCount ??
                              post.likeCount ??
                              (Array.isArray(post.likes) ? post.likes.length : 0)}
                          </span>
                          <span>
                            <i className="fa-regular fa-comment mr-1"></i>
                            {post.commentsCount ??
                              post.commentCount ??
                              (Array.isArray(post.comments) ? post.comments.length : 0)}
                          </span>
                        </div>
                      </div>
                    </Motion.div>
                  ))}
                  {canLoadMorePosts && (
                    <div
                      ref={profileLoadMoreRef}
                      className="col-span-full h-10 flex items-center justify-center text-xs text-[#b9b4c7]"
                    >
                      Loading more...
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {resolvedActiveTab === "friends" && (
          <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#faf0e6]">Friends</h3>
              <span className="text-xs text-[#b9b4c7]">
                {friendCount} total
              </span>
            </div>
            {friendsLoading ? (
              <p className="text-center text-[#b9b4c7] py-8">Loading friends...</p>
            ) : friendsList.length === 0 ? (
              <p className="text-center text-[#b9b4c7] py-8">No friends yet.</p>
            ) : (
              <div className="space-y-3">
                {friendsList.map((friend, index) => (
                  <button
                    key={friend.id || `friend-${index}`}
                    type="button"
                    onClick={() => {
                      const friendId = normalizeUserId(friend);
                      if (friendId) {
                        const cachedFriend = getUserFromCache?.(friendId);
                        prefetchUserProfile?.(friendId, cachedFriend || friend);
                        const preview = buildUserPreview({ ...(cachedFriend || {}), ...(friend || {}) }, {
                          _id: friendId,
                          fullName: friend.fullName || friend.name,
                          displayName: friend.displayName || friend.fullName || friend.name,
                          username: friend.username,
                          profilePicUrl:
                            friend.profilePicUrl ||
                            friend.profilePic ||
                            friend.avatarUrl ||
                            friend.avatar ||
                            friend.photoUrl ||
                            friend.photo ||
                            friend.imageUrl ||
                            friend.image,
                          isVerified: friend.isVerified,
                          isVerifiedCommunity: friend.isVerifiedCommunity,
                          communityName: friend.communityName,
                          university: friend.university,
                          college: friend.college,
                        });
                        navigate(`/profile/${friendId}`, {
                          state: { userPreview: preview, modal: true },
                        });
                      }
                    }}
                    className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition-all hover:bg-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={friend.profilePicUrl || ANONYMOUS_AVATAR}
                        alt={friend.displayName}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      <div>
                        <p className="text-sm font-semibold text-[#faf0e6] flex items-center gap-1">
                          {friend.displayName || "User"}
                          {friend.isVerified && <BlueTick className="text-[11px]" />}
                        </p>
                        <p className="text-xs text-[#b9b4c7]">
                          {friend.university || "Verified Campus"}
                          {Number.isFinite(
                            Number(
                              friend.friendCount ??
                                friend.friendsCount ??
                                (Array.isArray(friend.friends)
                                  ? friend.friends.length
                                  : undefined)
                            )
                          ) && (
                            <span className="ml-2">
                              •{" "}
                              {Number(
                                friend.friendCount ??
                                  friend.friendsCount ??
                                  (Array.isArray(friend.friends)
                                    ? friend.friends.length
                                    : 0)
                              )}{" "}
                              friends
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-[#b9b4c7]">View</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {resolvedActiveTab === "settings" && (
          <div className="space-y-6">
            <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[#faf0e6]">Appearance</h3>
                <span className="text-xs text-[#b9b4c7]">Theme Mode</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {themeOptions.map((theme) => {
                  const isActive = activeThemeId === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => handleSelectTheme(theme.id)}
                      className={`theme-card ${isActive ? "active" : ""}`}
                    >
                      {isActive && (
                        <span className="theme-card-check">
                          <i className="fa-solid fa-check"></i>
                        </span>
                      )}
                      <div
                        className="theme-card-preview"
                        data-theme={theme.id}
                      ></div>
                      <div>
                        <p className="text-sm font-semibold text-[#faf0e6]">
                          {theme.label}
                        </p>
                        <p className="text-[11px] text-[#b9b4c7]">
                          {theme.caption}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#faf0e6]">Quick Toggle</p>
                  <p className="text-xs text-[#b9b4c7]">Dark / Light</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDarkTheme}
                  aria-label="Toggle dark mode"
                  onClick={handleToggleTheme}
                  className={`theme-toggle ${isDarkTheme ? "active" : ""}`}
                >
                  <span className="theme-toggle-knob" />
                </button>
              </div>
            </div>

            <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
              <h3 className="text-lg font-semibold text-[#faf0e6] mb-4">
                Account Details
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                    {isCommunity ? "Community Name" : "Full Name"}
                  </label>
                  <input
                    type="text"
                    value={settingsName}
                    onChange={(e) => {
                      setSettingsName(e.target.value);
                      if (settingsSuccess) setSettingsSuccess("");
                    }}
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                    Username
                  </label>
                  <input
                    type="text"
                    value={settingsUsername}
                    onChange={(e) => {
                      const value = e.target.value.toLowerCase().replace(/\s+/g, "");
                      setSettingsUsername(value);
                      if (settingsSuccess) setSettingsSuccess("");
                      if (usernameError) setUsernameError("");
                    }}
                    placeholder="e.g. incampus_user"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                  />
                  {usernameChanged && !isUsernameValid && !usernameError && (
                    <p className="text-[11px] text-amber-200">
                      Use 3-30 lowercase letters, numbers, or underscore.
                    </p>
                  )}
                  {usernameError && (
                    <p className="text-[11px] text-amber-200">{usernameError}</p>
                  )}
                </div>
              </div>
              <div className="mt-4 space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                  {isCommunity ? "Description" : "Bio"}
                </label>
                <textarea
                  value={settingsBio}
                  onChange={(e) => {
                    setSettingsBio(e.target.value);
                    if (settingsSuccess) setSettingsSuccess("");
                  }}
                  rows="3"
                  className="w-full rounded-2xl glass-input p-3 text-sm resize-none"
                />
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#faf0e6]">Privacy Controls</p>
                  <p className="text-xs text-[#b9b4c7]">Allow profile discovery</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacyPublic}
                    onChange={(e) => {
                      setPrivacyPublic(e.target.checked);
                      if (settingsSuccess) setSettingsSuccess("");
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-6 bg-white/10 rounded-full peer peer-checked:bg-[#5c5470] transition-colors"></div>
                  <div className="dot absolute left-1 top-1 bg-[#faf0e6] w-4 h-4 rounded-full transition-transform peer-checked:translate-x-full"></div>
                </label>
              </div>
              <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3 sticky bottom-4 bg-[#1a120b]/80 backdrop-blur-xl rounded-2xl px-3 py-3 sm:bg-transparent sm:backdrop-blur-none sm:px-0 sm:py-0">
                {settingsSuccess && (
                  <p className="text-xs text-emerald-200">{settingsSuccess}</p>
                )}
                <Motion.button
                  onClick={handleSaveSettings}
                  disabled={!canSaveSettings}
                  className="liquid-button text-white text-xs font-semibold px-4 py-2 rounded-full disabled:opacity-50"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Save Changes
                </Motion.button>
              </div>
            </div>

            {!isCommunity && (
              <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
                <h3 className="text-lg font-semibold text-[#faf0e6] mb-4">
                  Education
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 relative" ref={collegeRef}>
                    <label className="text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                      College / University
                    </label>
                    <input
                      type="text"
                      value={collegeInput}
                      onChange={(e) => {
                        setCollegeInput(e.target.value);
                        setEducationCollege(e.target.value);
                        setShowCollegeDropdown(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setShowCollegeDropdown(false);
                        }
                      }}
                      onFocus={() => setShowCollegeDropdown(true)}
                      placeholder="Search your college..."
                      className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                    />
                    <p className="text-[11px] text-[#b9b4c7]">
                      Can't find your college? Type to create your campus network.
                    </p>
                    {showCollegeDropdown && (
                      <div className="absolute left-0 right-0 mt-2 rounded-2xl glass-card max-h-64 overflow-y-auto z-20">
                        {collegeInput.trim().length < 2 ? (
                          <div className="p-3 text-sm text-[#b9b4c7]">
                            Type at least 2 characters to search.
                          </div>
                        ) : collegeLoading ? (
                          <div className="p-3 space-y-2">
                            {[1, 2, 3, 4, 5].map((i) => (
                              <div
                                key={i}
                                className="h-8 rounded-xl bg-white/10 animate-pulse"
                              ></div>
                            ))}
                          </div>
                        ) : collegeError ? (
                          <div className="p-3 text-sm text-[#b9b4c7]">{collegeError}</div>
                        ) : topMatches.length > 0 ? (
                          <div className="p-2">
                            {topMatches.map((college) => (
                              <button
                                key={college}
                                type="button"
                                onClick={() => {
                                  setCollegeInput(college);
                                  setEducationCollege(college);
                                  setShowCollegeDropdown(false);
                                }}
                                className="w-full text-left px-3 py-2 rounded-xl text-sm text-[#faf0e6] hover:bg-white/10 transition-colors"
                              >
                                {college}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="p-3 text-sm text-[#b9b4c7]">
                            No matches. Press Enter to use "{collegeInput}".
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                      Graduation Year
                    </label>
                    <select
                      value={educationYear}
                      onChange={(e) => setEducationYear(e.target.value)}
                      className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                    >
                      <option value="">Select year</option>
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                    Student Level
                  </label>
                  <select
                    value={educationType}
                    onChange={(e) => setEducationType(e.target.value)}
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                  >
                    <option value="undergraduate">Undergraduate</option>
                    <option value="postgraduate">Postgraduate</option>
                    <option value="graduate">Graduate</option>
                    <option value="alumni">Alumni</option>
                  </select>
                </div>
                </div>

                <div className="mt-5 flex justify-end">
                  <Motion.button
                    onClick={handleSaveEducation}
                    disabled={savingEducation}
                    className="liquid-button text-white text-xs font-semibold px-4 py-2 rounded-full disabled:opacity-50"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    Update Education
                  </Motion.button>
                </div>
              </div>
            )}

            <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
              <h3 className="text-lg font-semibold text-[#faf0e6] mb-4">
                Profile Photo
              </h3>
              <div className="flex flex-wrap gap-3">
                <Motion.button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={savingPhoto}
                  className="liquid-button text-white text-xs font-semibold px-4 py-2 rounded-full disabled:opacity-50"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <i className="fa-solid fa-camera mr-1"></i> Upload Photo
                </Motion.button>
                {currentUser?.profilePicUrl && (
                  <Motion.button
                    onClick={handleDeletePhoto}
                    disabled={savingPhoto}
                    className="text-xs font-semibold px-4 py-2 rounded-full bg-red-500/80 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <i className="fa-solid fa-trash-can mr-1"></i> Delete Photo
                  </Motion.button>
                )}
              </div>
            </div>

            <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
              <h3 className="text-lg font-semibold text-[#faf0e6] mb-4">
                Change Password
              </h3>
              <form onSubmit={handlePasswordChange}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input
                    type="password"
                    id="new-password"
                    name="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    autoComplete="new-password"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                  />
                  <input
                    type="password"
                    id="confirm-password"
                    name="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                  />
                </div>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-[#b9b4c7]">
                    <span>Password strength</span>
                    <span className="text-[#faf0e6]">{passwordStrength.label}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full ${passwordStrength.color}`}
                      style={{ width: `${(passwordStrength.score / 4) * 100}%` }}
                    ></div>
                  </div>
                  <p className="text-[11px] text-[#b9b4c7]">
                    Minimum 8 characters with letters and numbers.
                  </p>
                  {!passwordsMatch && confirmPassword.length > 0 && (
                    <p className="text-[11px] text-amber-200">Passwords do not match.</p>
                  )}
                  {passwordError && (
                    <p className="text-[11px] text-red-300">{passwordError}</p>
                  )}
                  {passwordSuccess && (
                    <p className="text-[11px] text-emerald-200">{passwordSuccess}</p>
                  )}
                </div>
                <div className="mt-4 flex justify-end">
                  <Motion.button
                    type="submit"
                    disabled={!canUpdatePassword}
                    className="liquid-button text-white text-xs font-semibold px-4 py-2 rounded-full disabled:opacity-50"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    Update Password
                  </Motion.button>
                </div>
              </form>
            </div>

            <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[#faf0e6]">Account Overview</h3>
                <span className="text-[10px] uppercase tracking-[0.25em] text-[#b9b4c7]">
                  Read only
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-[#b9b4c7]">
                    Trust Score
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-[#faf0e6] drop-shadow-[0_0_12px_rgba(92,84,112,0.45)]">
                    {trustScoreValue}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-[#b9b4c7]">
                    Warnings
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[#faf0e6]">
                    {warningsValue}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-[#b9b4c7]">
                    Account Created
                  </p>
                  <p className="mt-2 text-base font-semibold text-[#faf0e6]">
                    {accountCreatedLabel}
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-circle-question text-[#b9b4c7]"></i>
                    <h3 className="text-lg font-semibold text-[#faf0e6]">Help</h3>
                  </div>
                  <p className="text-xs text-[#b9b4c7]">
                    Visit the InCampus Help Center.
                  </p>
                </div>
                <Motion.button
                  type="button"
                  onClick={handleOpenHelp}
                  className="liquid-button text-white text-xs font-semibold px-4 py-2 rounded-full"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Open Help
                </Motion.button>
              </div>
            </div>

            <div className="glass-card glass-hover rounded-3xl p-6 transition-all duration-300 ease-out">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-[#faf0e6]">Logout</h3>
                  <p className="text-xs text-[#b9b4c7]">
                    End your session across this device.
                  </p>
                </div>
                <Motion.button
                  onClick={logout}
                  className="text-xs font-semibold px-4 py-2 rounded-full bg-red-500/80 text-white hover:bg-red-500 transition-colors"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Logout
                </Motion.button>
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*"
          onChange={handlePhotoUpload}
        />

        {showAvatarModal && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md"
            onClick={() => {
              if (savingPhoto) return;
              resetAvatarModal();
            }}
          >
            <Motion.div
              initial={{ opacity: 0, scale: 0.96, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 240 }}
              className="w-full sm:max-w-[480px] rounded-t-3xl sm:rounded-3xl bg-[#15111c] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-6 sm:p-6 max-h-[92vh] overflow-y-auto"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-[#faf0e6]">Update Profile Photo</p>
                  <p className="text-[11px] text-[#b9b4c7]">Crop and adjust your avatar.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (savingPhoto) return;
                    resetAvatarModal();
                  }}
                  className="h-9 w-9 rounded-full text-[#b9b4c7] hover:text-[#faf0e6] hover:bg-white/5 flex items-center justify-center"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              <div className="space-y-4">
                <div
                  ref={avatarCropRef}
                  className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black/30 border border-white/10"
                  onPointerDown={handleAvatarPointerDown}
                  onPointerMove={handleAvatarPointerMove}
                  onPointerUp={handleAvatarPointerUp}
                  onPointerLeave={handleAvatarPointerUp}
                  style={{ touchAction: "none" }}
                >
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                      transform: `translate(${avatarOffset.x}px, ${avatarOffset.y}px)`,
                    }}
                  >
                    {avatarPreviewUrl && (
                      <img
                        src={avatarPreviewUrl}
                        alt="Crop preview"
                        className="max-w-none select-none pointer-events-none"
                        style={{
                          transform: `scale(${avatarZoom * avatarBaseScale}) rotate(${avatarRotate}deg)`,
                        }}
                      />
                    )}
                  </div>
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-0 rounded-full border border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"></div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                    Zoom
                  </label>
                  <input
                    type="range"
                    min={AVATAR_ZOOM_MIN}
                    max={AVATAR_ZOOM_MAX}
                    step={0.01}
                    value={avatarZoom}
                    onChange={(event) => setAvatarZoom(Number(event.target.value))}
                    className="w-full accent-[#6d5b8f]"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setAvatarRotate((prev) => prev - 90)}
                      className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] hover:bg-white/10"
                    >
                      <i className="fa-solid fa-rotate-left"></i>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAvatarRotate((prev) => prev + 90)}
                      className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] hover:bg-white/10"
                    >
                      <i className="fa-solid fa-rotate-right"></i>
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-16 w-16 rounded-full border border-white/10 overflow-hidden bg-white/5">
                      {avatarPreviewSmall || avatarPreviewUrl ? (
                        <img
                          src={avatarPreviewSmall || avatarPreviewUrl}
                          alt="Avatar preview"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#faf0e6]">Preview</p>
                      <p className="text-[11px] text-[#b9b4c7]">How it will look.</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Motion.button
                    type="button"
                    onClick={resetAvatarModal}
                    disabled={savingPhoto}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-[#faf0e6] disabled:opacity-50"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    Cancel
                  </Motion.button>
                  <Motion.button
                    type="button"
                    onClick={handleSaveAvatar}
                    disabled={savingPhoto || !avatarFile}
                    className="liquid-button text-white text-xs font-semibold px-5 py-2 rounded-full disabled:opacity-50"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    {savingPhoto ? "Saving..." : "Save"}
                  </Motion.button>
                </div>
              </div>
            </Motion.div>
          </Motion.div>
        )}

        {selectedPost && (
          <PostModal
            post={selectedPost}
            isOpen={!!selectedPost}
            onClose={() => setSelectedPost(null)}
            onDelete={handleDeletePost}
          />
        )}
      </main>
      {toast && (
        <Motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-6 right-4 z-[70] toast-card rounded-2xl px-4 py-3 text-sm text-[#faf0e6]"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">
            {toast.title}
          </p>
          <p className="mt-1">{toast.message}</p>
        </Motion.div>
      )}
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
      <BottomNav onCreate={() => setShowCreateModal(true)} overlay={showCreateModal} />
    </div>
  );
}
