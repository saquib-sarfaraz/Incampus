import { useEffect, useState, useCallback } from "react";
import { login as loginAPI, getCurrentUser } from "../services/api";
import { initSocket, disconnectSocket, getSocket } from "../services/socket";
import { resolveStudentType, resolveUserType } from "../utils/userProfile";
import { AuthContext } from "./authContext";

export const AuthProvider = ({ children }) => {
  const [authToken, setAuthToken] = useState(localStorage.getItem("authToken"));
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const buildGroupRooms = useCallback((user) => {
    const universityLabel = user?.university || user?.college || user?.school || "";
    const universitySlug = encodeURIComponent(String(universityLabel).toLowerCase());
    return [
      "group:global",
      universityLabel ? `group:college:${universitySlug}` : null,
    ].filter(Boolean);
  }, []);

  const normalizeUser = useCallback((user) => {
    const rawStudentType = resolveStudentType(user) || "student";
    const rawUserType = resolveUserType(user) || "student";
    const isCommunity = String(rawUserType).toLowerCase() === "community";
    const displayNameBase = isCommunity
      ? user?.communityName || user?.community_name || user?.fullName
      : user?.fullName;

    return {
      id: user?._id || user?.id,
      username: user?.username,
      fullName: user?.fullName,
      displayName:
        displayNameBase?.replace?.(/ \[DEV\]| \[ANON TEST\]/g, "") ||
        displayNameBase ||
        "User",
      profilePicUrl: user?.profilePicUrl,
      isVerified: Boolean(user?.isVerified),
      friends: user?.friends || [],
      bio: user?.bio || "",
      university: user?.university || user?.college || user?.school || "",
      privacyPublic: user?.privacyPublic ?? true,
      graduationYear: user?.graduationYear || user?.year || "",
      studentType: rawStudentType,
      student_type: user?.student_type || rawStudentType,
      userType: rawUserType,
      user_type: user?.user_type || rawUserType,
      course: user?.course,
      year: user?.year,
      passoutYear: user?.passoutYear || user?.passout_year || "",
      industry: user?.industry || "",
      communityName: user?.communityName || user?.community_name || "",
      communityType: user?.communityType || user?.community_type || "",
      communityDescription: user?.communityDescription || user?.community_description || "",
      communityEmail: user?.communityEmail || user?.community_email || "",
      memberCount:
        user?.memberCount ||
        user?.membersCount ||
        user?.member_count ||
        user?.followersCount ||
        0,
      collegeGroupId:
        user?.collegeGroupId ||
        user?.college_group_id ||
        user?.groupId ||
        user?.collegeGroup ||
        null,
      groups: user?.groups,
      groupIds: user?.groupIds,
      groupMemberships: user?.groupMemberships,
    };
  }, []);

  const applyUser = useCallback((user) => {
    if (!user) return null;
    const normalized = normalizeUser(user);
    if (normalized.id) {
      localStorage.setItem("currentUserId", normalized.id);
    }
    setCurrentUser(normalized);
    initSocket(normalized.id, buildGroupRooms(user));
    return normalized;
  }, [buildGroupRooms, normalizeUser]);

  const logout = useCallback(() => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("currentUserId");
    setAuthToken(null);
    setCurrentUser(null);
    disconnectSocket();
    if (typeof window !== "undefined") {
      window.__activeChatRoom = null;
    }
  }, []);

  useEffect(() => {
    if (!currentUser?.id || typeof window === "undefined") return;
    const socket = getSocket();
    if (!socket) return;

    const handleSocketMessage = (payload) => {
      window.dispatchEvent(new CustomEvent("chat:newMessage", { detail: payload }));
    };

    socket.off("chat:newMessage", handleSocketMessage);
    socket.on("chat:newMessage", handleSocketMessage);

    return () => {
      socket.off("chat:newMessage", handleSocketMessage);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    const handleInvalidToken = () => {
      logout();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("auth:invalid-token", handleInvalidToken);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("auth:invalid-token", handleInvalidToken);
      }
    };
  }, [logout]);

  const refreshCurrentUser = useCallback(async () => {
    const user = await getCurrentUser();
    return applyUser(user);
  }, [applyUser]);

  useEffect(() => {
    const initializeAuth = async () => {
      const token = localStorage.getItem("authToken");
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        setAuthToken(token);
        await refreshCurrentUser();
      } catch (error) {
        const status = error?.status;
        if (status === 401 || status === 403) {
          logout();
        } else {
          // Keep token on transient/network errors to avoid forced logout.
          setAuthToken(token);
        }
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, [refreshCurrentUser, logout]);

  const login = async (username, password) => {
    try {
      const data = await loginAPI(username, password);
      const token = data.token || data.accessToken || data.authToken;
      if (!token) {
        throw new Error("Login failed: missing auth token.");
      }

      const userId =
        data.userId ||
        data.user?._id ||
        data.user?.id ||
        data.id ||
        data._id ||
        username;

      localStorage.setItem("authToken", token);
      localStorage.setItem("currentUserId", userId);
      setAuthToken(token);

      const user = data.user || (await getCurrentUser());
      applyUser(user);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const loginWithToken = async (token) => {
    if (!token) {
      throw new Error("Missing auth token.");
    }
    localStorage.setItem("authToken", token);
    setAuthToken(token);
    const user = await getCurrentUser();
    return applyUser(user);
  };

  const value = {
    authToken,
    currentUser,
    login,
    loginWithToken,
    logout,
    loading,
    setCurrentUser,
    refreshCurrentUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
