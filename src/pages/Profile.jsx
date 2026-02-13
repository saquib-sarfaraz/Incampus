import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../context/authContext";
import { useApp } from "../context/useApp";
import {
  updateUser,
  updateProfileInfo,
  changePassword,
  uploadProfilePic,
  deleteProfilePic,
  deletePost,
  getUserById,
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
} from "../utils/userProfile";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const HELP_CENTER_URL = "https://incampus-help.netlify.app";
const COLLEGE_SEARCH_DEBOUNCE_MS = 150;

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

export default function Profile() {
  const { currentUser, setCurrentUser, logout } = useAuth();
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
  } = useApp();
  const [userPosts, setUserPosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [bio, setBio] = useState("");
  const [settingsName, setSettingsName] = useState("");
  const [settingsBio, setSettingsBio] = useState("");
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [settingsSuccess, setSettingsSuccess] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [privacyPublic, setPrivacyPublic] = useState(true);
  const [friendsList, setFriendsList] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const fileInputRef = useRef(null);
  const collegeRef = useRef(null);
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
  const showVerifiedTick = Boolean(currentUser?.isVerified);
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
  const settingsBaseBio = isCommunity
    ? resolveCommunityDescription(currentUser) || ""
    : currentUser?.bio || "";
  const settingsChanged =
    settingsName.trim() !== String(settingsBaseName || "").trim() ||
    settingsBio.trim() !== String(settingsBaseBio || "").trim() ||
    privacyPublic !== (currentUser?.privacyPublic ?? true);
  const canSaveSettings =
    settingsChanged &&
    settingsName.trim().length > 1 &&
    !loading;
  const canUpdatePassword =
    !loading &&
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    passwordStrength.hasLetter &&
    passwordStrength.hasNumber &&
    confirmPassword.length > 0 &&
    passwordsMatch;

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
    if (currentUser && posts) {
      const filtered = posts.filter(
        (p) =>
          String(p.author?._id || p.authorId || p.author) === String(currentUser.id)
      );
      setUserPosts(filtered);
    }
  }, [posts, currentUser]);

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
  }, [currentPassword, newPassword, confirmPassword]);

  useEffect(() => {
    if (bioSuccess) {
      setBioSuccess("");
    }
  }, [bio]);

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
    setLoading(true);
    setSettingsSuccess("");
    setBioSuccess("");
    try {
      const resolvedBio = bio.trim();
      if (isCommunity) {
        await updateUser({ communityDescription: resolvedBio });
        setCurrentUser({ ...currentUser, communityDescription: resolvedBio });
        setSettingsBio(resolvedBio);
        updateAuthorProfile(currentUser.id, {
          communityDescription: resolvedBio,
          displayName: resolveCommunityName(currentUser) || currentUser.displayName,
        });
      } else {
        await updateProfileInfo({ bio: resolvedBio });
        setCurrentUser({ ...currentUser, bio: resolvedBio });
        setSettingsBio(resolvedBio);
        updateAuthorProfile(currentUser.id, {
          fullName: currentUser.fullName,
          displayName: currentUser.displayName || currentUser.fullName,
          bio: resolvedBio,
        });
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
      alert(error.message || "Failed to update bio");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!currentUser) return;
    if (!settingsChanged) return;
    setLoading(true);
    setSettingsSuccess("");
    try {
      const resolvedName = settingsName.trim();
      const resolvedBio = settingsBio.trim();
      if (isCommunity) {
        await updateUser({
          communityName: resolvedName,
          communityDescription: resolvedBio,
          privacyPublic,
        });
        setCurrentUser({
          ...currentUser,
          communityName: resolvedName,
          displayName: resolvedName,
          communityDescription: resolvedBio,
          privacyPublic,
        });
        setSettingsName(resolvedName);
        setSettingsBio(resolvedBio);
        updateAuthorProfile(currentUser.id, {
          communityName: resolvedName,
          displayName: resolvedName,
          communityDescription: resolvedBio,
        });
      } else {
        await updateProfileInfo({
          fullName: resolvedName,
          bio: resolvedBio,
          privacyPublic,
        });
        setCurrentUser({
          ...currentUser,
          fullName: resolvedName,
          displayName: resolvedName,
          bio: resolvedBio,
          privacyPublic,
        });
        setSettingsName(resolvedName);
        setSettingsBio(resolvedBio);
        updateAuthorProfile(currentUser.id, {
          fullName: resolvedName,
          displayName: resolvedName,
          bio: resolvedBio,
        });
      }
      const socket = getSocket();
      socket?.emit("user-profile-updated", {
        userId: currentUser.id,
        fullName: isCommunity ? undefined : resolvedName,
        displayName: resolvedName,
        bio: isCommunity ? undefined : resolvedBio,
        communityName: isCommunity ? resolvedName : undefined,
        communityDescription: isCommunity ? resolvedBio : undefined,
      });
      setSettingsSuccess("Settings updated!");
      setTimeout(() => setSettingsSuccess(""), 2500);
    } catch (error) {
      alert(error.message || "Failed to update settings");
    } finally {
      setLoading(false);
    }
  };

  const buildCollegeRoom = (collegeName) => {
    if (!collegeName) return null;
    const slug = encodeURIComponent(String(collegeName).toLowerCase());
    return `group:college:${slug}`;
  };

  const handleSaveEducation = async () => {
    if (isCommunity) return;
    if (!educationCollege.trim() || !educationYear || !educationType) {
      alert("Please complete your education details.");
      return;
    }
    setLoading(true);
    try {
      const oldCollege = currentUser?.university || currentUser?.college || "";
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
      const result = await updateUser(payload);
      const updated = result.user || result || {};
      const newCollege = updated.university || updated.college || educationCollege.trim();

      setCurrentUser({
        ...currentUser,
        university: newCollege,
        graduationYear: updated.graduationYear || educationYear,
        year: updated.year || educationYear,
        studentType: updated.studentType || updated.student_type || educationType,
        student_type: updated.student_type || educationType,
        passoutYear: updated.passoutYear || updated.passout_year || currentUser?.passoutYear || "",
        collegeGroupId:
          updated.collegeGroupId ||
          updated.college_group_id ||
          updated.groupId ||
          currentUser?.collegeGroupId ||
          null,
      });

      if (oldCollege && newCollege && oldCollege.toLowerCase() !== newCollege.toLowerCase()) {
        const oldRoom = buildCollegeRoom(oldCollege);
        const newRoom = buildCollegeRoom(newCollege);
        if (oldRoom) leaveSocket(oldRoom);
        if (newRoom) joinSocket(newRoom);
        setFeedScope("college");
      }
      alert("Education updated!");
    } catch (error) {
      alert(error.message || "Failed to update education");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError("");
    setPasswordSuccess("");
    if (!currentPassword) {
      setPasswordError("Please enter your current password.");
      return;
    }
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
    setLoading(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess("Password updated. Please log in again.");
      setTimeout(() => setPasswordSuccess(""), 2500);
      setTimeout(() => {
        logout();
      }, 1200);
    } catch (error) {
      setPasswordError(error.message || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    try {
      const result = await uploadProfilePic(file);
      setCurrentUser({ ...currentUser, profilePicUrl: result.profilePicUrl });
      alert("Profile picture updated!");
    } catch (error) {
      alert(error.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePhoto = async () => {
    if (!confirm("Delete profile picture?")) return;
    setLoading(true);
    try {
      await deleteProfilePic();
      setCurrentUser({ ...currentUser, profilePicUrl: null });
      alert("Profile picture removed");
    } catch (error) {
      alert(error.message || "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePost = async (postId) => {
    if (!confirm("Delete this post?")) return;
    try {
      await deletePost(postId);
      await loadPosts();
    } catch (error) {
      alert(error.message || "Failed to delete post");
    }
  };

  const loadFriends = useCallback(async () => {
    if (!resolvedFriendIds?.length) {
      setFriendsList([]);
      return;
    }
    setFriendsLoading(true);
    try {
      const friendsData = await Promise.all(
        resolvedFriendIds.map(async (friendId) => {
          let user = getUserFromCache(friendId);
          if (!user) {
            const userData = await getUserById(friendId);
            if (userData) {
              cacheUser(userData);
              user = {
                id: userData._id,
                fullName: userData.fullName,
                displayName:
                  userData.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
                profilePicUrl: userData.profilePicUrl || ANONYMOUS_AVATAR,
                bio: userData.bio || "",
                university: userData.university || userData.college || "",
                friends: userData.friends || [],
                username: userData.username,
              };
            }
          }
          return (
            user || {
              id: friendId,
              displayName: "User",
              profilePicUrl: ANONYMOUS_AVATAR,
              friends: [],
            }
          );
        })
      );
      setFriendsList(friendsData);
    } catch (error) {
      console.error("Failed to load friends:", error);
    } finally {
      setFriendsLoading(false);
    }
  }, [resolvedFriendIds, cacheUser, getUserFromCache]);

  useEffect(() => {
    if (activeTab === "friends" && !isCommunity) {
      loadFriends();
    }
  }, [activeTab, loadFriends, isCommunity]);

  useEffect(() => {
    if (isCommunity && activeTab === "friends") {
      setActiveTab("overview");
    }
  }, [isCommunity, activeTab]);

  return (
    <div className="min-h-screen pb-24 sm:pb-0">
      <Header />
      <main className="max-w-5xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Profile Header */}
        <Motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card glass-hover rounded-3xl p-6 mb-6 transition-all duration-300 ease-out"
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-4">
              <img
                src={currentUser?.profilePicUrl || ANONYMOUS_AVATAR}
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
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                activeTab === tab.key
                  ? "liquid-button text-[#faf0e6]"
                  : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
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
                  disabled={loading}
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

              {userPosts.length === 0 ? (
                <div className="text-center p-12 glass-card rounded-3xl mt-6">
                  <i className="fa-solid fa-ghost text-3xl text-[#b9b4c7] mb-3"></i>
                  <p className="text-[#b9b4c7]">
                    You haven't posted anything yet. Be the first!
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {userPosts.map((post, index) => (
                    <Motion.div
                      key={post._id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05 }}
                      className="aspect-square relative group cursor-pointer"
                      onClick={() => setSelectedPost(post)}
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
                            {post.likes?.length || 0}
                          </span>
                          <span>
                            <i className="fa-regular fa-comment mr-1"></i>
                            {post.comments?.length || 0}
                          </span>
                        </div>
                      </div>
                    </Motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "friends" && (
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
                {friendsList.map((friend) => (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => setSelectedUser(friend)}
                    className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition-all hover:bg-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={friend.profilePicUrl || ANONYMOUS_AVATAR}
                        alt={friend.displayName}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      <div>
                        <p className="text-sm font-semibold text-[#faf0e6]">
                          {friend.displayName || "User"}
                        </p>
                        <p className="text-xs text-[#b9b4c7]">
                          {friend.university || "Verified Campus"}
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

        {activeTab === "settings" && (
          <div className="space-y-6">
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
                    disabled={loading}
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
                  className="liquid-button text-white text-xs font-semibold px-4 py-2 rounded-full"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <i className="fa-solid fa-camera mr-1"></i> Upload Photo
                </Motion.button>
                {currentUser?.profilePicUrl && (
                  <Motion.button
                    onClick={handleDeletePhoto}
                    className="text-xs font-semibold px-4 py-2 rounded-full bg-red-500/80 text-white hover:bg-red-500 transition-colors"
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
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    autoComplete="current-password"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                  />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    autoComplete="new-password"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                  />
                  <input
                    type="password"
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

        {selectedPost && (
          <PostModal
            post={selectedPost}
            isOpen={!!selectedPost}
            onClose={() => setSelectedPost(null)}
            onDelete={handleDeletePost}
          />
        )}
      </main>
      <UserProfileModal
        isOpen={!!selectedUser}
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        currentUser={currentUser}
      />
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
