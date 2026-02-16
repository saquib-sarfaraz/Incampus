import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import {
  createStoryWithProgress,
  getUserById,
  recordPostStoryReshare,
} from "../../services/api";
import StoryViewer from "./StoryViewer";
import {
  resolveStoryId,
  isStoryRecent,
  resolveStoryPrivacyType,
} from "../../utils/storyMedia";
import { getOptimizedMediaUrl } from "../../utils/media";
import BlueTick from "../common/BlueTick";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

const StoryListItem = memo(function StoryListItem({ group, index, onOpen }) {
  const handleOpen = useCallback(() => onOpen(index), [onOpen, index]);
  const isVerified = Boolean(
    group.authorIsVerified ||
      group.author?.isVerified ||
      group.author?.verified ||
      group.author?.is_verified ||
      group.isVerified ||
      group.verified
  );
  const avatarUrl =
    getOptimizedMediaUrl(group.authorProfilePic, { width: 96, height: 96 }) ||
    ANONYMOUS_AVATAR;
  const displayName = group.authorDisplayName || "User";

  return (
    <Motion.div
      className="w-16 flex flex-col items-center cursor-pointer flex-shrink-0"
      onClick={handleOpen}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <div className="w-12 h-12 rounded-full border border-[#b9b4c7] overflow-hidden flex items-center justify-center bg-white/10">
        <img
          src={avatarUrl}
          alt={displayName}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="mt-1 w-12 min-w-0 flex items-center gap-1 text-[11px] font-medium text-[#faf0e6]">
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left">
          {displayName}
        </span>
        {isVerified && <BlueTick className="text-[10px]" />}
      </div>
    </Motion.div>
  );
});

export default function StoryBar() {
  const { currentUser } = useAuth();
  const {
    stories,
    loadStories,
    cacheUser,
    getUserFromCache,
    feedScope,
    isUserBlocked,
    isFriend,
  } = useApp();
  const [selectedStoryIndex, setSelectedStoryIndex] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDuration, setPreviewDuration] = useState("");
  const [uploadStage, setUploadStage] = useState("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [privacyType, setPrivacyType] = useState("universal");
  const [collegeTagMode, setCollegeTagMode] = useState("none");
  const [customCollegeTag, setCustomCollegeTag] = useState("");
  const fileInputRef = useRef(null);
  const uploadAbortRef = useRef(null);
  const uploadStartRef = useRef(0);
  const lastProgressRef = useRef({ loaded: 0, time: 0 });
  const getAuthorId = useCallback((story) => {
    return (
      story.authorId ||
      story.author_id ||
      story.userId ||
      story.user_id ||
      story.ownerId ||
      story.owner_id ||
      story.createdById ||
      story.created_by ||
      story.author?._id ||
      story.author?.id ||
      story.user?._id ||
      story.user?.id ||
      story.owner?._id ||
      story.owner?.id ||
      story.createdBy?._id ||
      story.createdBy?.id ||
      story.author ||
      story.user ||
      story.owner ||
      story.createdBy ||
      ""
    );
  }, []);

  useEffect(() => {
    const fetchMissingAuthors = async () => {
      const missing = new Set();
      stories.forEach((story) => {
        const authorId = getAuthorId(story);
        if (!authorId) return;
        const cached = getUserFromCache(authorId);
        const entity = story.author || story.user || story.owner || story.createdBy;
        const hasName =
          story.authorDisplayName ||
          story.authorName ||
          story.userName ||
          entity?.displayName ||
          entity?.fullName ||
          entity?.username;
        if (!cached && !hasName) missing.add(authorId);
      });

      await Promise.all(
        Array.from(missing).map(async (authorId) => {
          const userData = await getUserById(authorId);
          if (userData) cacheUser(userData);
        })
      );
    };

    fetchMissingAuthors();
  }, [stories, getAuthorId, getUserFromCache, cacheUser]);

  useEffect(() => {
    return () => {
      if (uploadPreview?.url?.startsWith("blob:")) {
        URL.revokeObjectURL(uploadPreview.url);
      }
    };
  }, [uploadPreview]);

  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return "";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const formatSpeed = (bps) => {
    if (!Number.isFinite(bps) || bps <= 0) return "";
    const kb = bps / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB/s`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB/s`;
  };

  const resetUploadState = () => {
    if (uploadPreview?.url?.startsWith("blob:")) {
      URL.revokeObjectURL(uploadPreview.url);
    }
    uploadAbortRef.current = null;
    setUploadPreview(null);
    setPendingFile(null);
    setPreviewOpen(false);
    setPreviewDuration("");
    setUploadStage("idle");
    setUploadProgress(0);
    setUploadSpeed("");
    setUploadError("");
    setPrivacyType(feedScope === "college" ? "friends" : "universal");
    setCollegeTagMode(campusLabel && feedScope === "college" ? "mine" : "none");
    setCustomCollegeTag("");
  };

  const resolveStoryName = useCallback((story, cachedUser) => {
    const entity = story.author || story.user || story.owner || story.createdBy;
    return (
      story.authorDisplayName ||
      story.authorName ||
      story.userDisplayName ||
      story.userName ||
      entity?.displayName ||
      entity?.fullName ||
      entity?.name ||
      entity?.username ||
      cachedUser?.displayName ||
      cachedUser?.name ||
      cachedUser?.username ||
      "User"
    );
  }, []);

  const resolveStoryAvatar = useCallback((story, cachedUser) => {
    const entity = story.author || story.user || story.owner || story.createdBy;
    return (
      story.authorProfilePic ||
      story.authorAvatar ||
      story.userProfilePic ||
      story.userAvatar ||
      entity?.profilePicUrl ||
      entity?.profilePic ||
      entity?.avatarUrl ||
      entity?.avatar ||
      cachedUser?.profilePicUrl ||
      ANONYMOUS_AVATAR
    );
  }, []);

  const resolveStoryVerified = useCallback((story, cachedUser) => {
    const entity = story?.author || story?.user || story?.owner || story?.createdBy;
    if (story?.authorIsVerified !== undefined || story?.authorVerified !== undefined) {
      return Boolean(story.authorIsVerified || story.authorVerified);
    }
    if (story?.author?.isVerified !== undefined) {
      return Boolean(story.author.isVerified);
    }
    if (story?.userIsVerified !== undefined || story?.userVerified !== undefined) {
      return Boolean(story.userIsVerified || story.userVerified);
    }
    if (entity?.isVerified !== undefined) {
      return Boolean(entity.isVerified);
    }
    if (cachedUser?.isVerified !== undefined) {
      return Boolean(cachedUser.isVerified);
    }
    if (story?.verification?.status) {
      return story.verification.status === "verified";
    }
    if (entity?.verification?.status) {
      return entity.verification.status === "verified";
    }
    return Boolean(story?.isVerified || story?.verified || story?.is_verified);
  }, []);

  const resolveStoryCampus = useCallback((story, cachedUser) => {
    return (
      story.collegeTagName ||
      story.collegeTag ||
      story.userCollege ||
      story.user_college ||
      story.college ||
      story.university ||
      story.school ||
      cachedUser?.university ||
      cachedUser?.college ||
      cachedUser?.school ||
      story.author?.college ||
      story.author?.university ||
      ""
    );
  }, []);

  const campusLabel = currentUser?.university || currentUser?.college || "";
  const currentCollegeGroupId =
    currentUser?.collegeGroupId ||
    currentUser?.college_group_id ||
    currentUser?.groupId ||
    currentUser?.collegeGroup ||
    "";

  const resolveStoryGroupId = useCallback((story) => {
    return (
      story.collegeTagId ||
      story.college_tag_id ||
      story.collegeGroupId ||
      story.college_group_id ||
      story.collegeId ||
      story.college_id ||
      story.groupId ||
      story.group_id ||
      story.group?._id ||
      story.collegeGroup ||
      ""
    );
  }, []);

  const currentUserId = currentUser?.id;

  const isOwner = useCallback(
    (authorId) => {
      if (!authorId || !currentUserId) return false;
      return String(authorId) === String(currentUserId);
    },
    [currentUserId]
  );

  const matchesCollege = useCallback((story, cachedUser) => {
    if (!campusLabel && !currentCollegeGroupId) return false;
    const storyGroupId = resolveStoryGroupId(story);
    if (currentCollegeGroupId && storyGroupId) {
      return String(storyGroupId) === String(currentCollegeGroupId);
    }
    const localCampus = campusLabel ? campusLabel.toLowerCase() : "";
    if (!localCampus) return false;
    const storyCampus = resolveStoryCampus(story, cachedUser);
    if (!storyCampus) return false;
    return String(storyCampus).toLowerCase() === localCampus;
  }, [campusLabel, currentCollegeGroupId, resolveStoryGroupId, resolveStoryCampus]);

  const filteredStories = useMemo(() => {
    if (!stories || stories.length === 0) return [];
    return stories.filter((story) => {
      if (!isStoryRecent(story)) return false;
      const authorId = getAuthorId(story);
      if (isUserBlocked(authorId)) return false;
      const privacy = resolveStoryPrivacyType(story);
      if (isOwner(authorId)) return true;
      if (privacy === "friends" && !isFriend(authorId)) return false;
      if (feedScope !== "college") return true;
      if (!campusLabel && !currentCollegeGroupId) return true;
      const cachedUser = authorId ? getUserFromCache(authorId) : null;
      return matchesCollege(story, cachedUser);
    });
  }, [
    stories,
    feedScope,
    campusLabel,
    getUserFromCache,
    currentCollegeGroupId,
    isUserBlocked,
    isFriend,
    getAuthorId,
    isOwner,
    matchesCollege,
  ]);

  const getStoryTimestamp = useCallback((story) => {
    const raw =
      story.createdAt ||
      story.created_at ||
      story.timestamp ||
      story.time ||
      story.date ||
      0;
    const ts = new Date(raw).getTime();
    return Number.isNaN(ts) ? 0 : ts;
  }, []);

  const groupedStories = useMemo(() => {
    const grouped = {};
    filteredStories.forEach((story) => {
      const rawAuthorId = getAuthorId(story);
      const authorId = rawAuthorId || `unknown-${story._id || "story"}`;
      const cachedUser = rawAuthorId ? getUserFromCache(rawAuthorId) : null;
      const displayName = resolveStoryName(story, cachedUser);
      const profilePicUrl = resolveStoryAvatar(story, cachedUser);
      const isVerified = resolveStoryVerified(story, cachedUser);
      if (!grouped[authorId]) {
        grouped[authorId] = {
          authorId,
          authorDisplayName: displayName,
          authorProfilePic: profilePicUrl,
          authorIsVerified: isVerified,
          stories: [],
        };
      }
      grouped[authorId].authorDisplayName = displayName;
      grouped[authorId].authorProfilePic = profilePicUrl;
      grouped[authorId].authorIsVerified =
        grouped[authorId].authorIsVerified || isVerified;
      grouped[authorId].stories.push({
        ...story,
        authorId,
        authorDisplayName: displayName,
        authorProfilePic: profilePicUrl,
        authorIsVerified: isVerified,
        storyId: resolveStoryId(story),
      });
    });
    const groups = Object.values(grouped);
    groups.forEach((group) => {
      group.stories.sort((a, b) => getStoryTimestamp(a) - getStoryTimestamp(b));
    });
    return groups;
  }, [
    filteredStories,
    getUserFromCache,
    resolveStoryName,
    resolveStoryAvatar,
    resolveStoryVerified,
    getStoryTimestamp,
  ]);

  const orderedGroups = useMemo(() => {
    const groups = [...groupedStories];
    const getGroupLatest = (group) =>
      Math.max(...group.stories.map((story) => getStoryTimestamp(story)), 0);
    const getGroupRank = (group) => {
      const authorId = group.authorId;
      if (isOwner(authorId)) return 0;
      if (isFriend(authorId)) return 1;
      const cachedUser = authorId ? getUserFromCache(authorId) : null;
      const hasCollegeMatch = group.stories.some((story) =>
        matchesCollege(story, cachedUser)
      );
      if (hasCollegeMatch) return 2;
      return 3;
    };
    groups.sort((a, b) => {
      const rankA = getGroupRank(a);
      const rankB = getGroupRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return getGroupLatest(b) - getGroupLatest(a);
    });
    return groups;
  }, [
    groupedStories,
    getUserFromCache,
    isFriend,
    isOwner,
    matchesCollege,
    getStoryTimestamp,
  ]);

  const currentUserGroupIndex = useMemo(() => {
    if (!currentUser?.id) return -1;
    return orderedGroups.findIndex((group) => isOwner(group.authorId));
  }, [orderedGroups, isOwner]);

  const storyGroupsForBar = useMemo(() => {
    return orderedGroups
      .map((group, index) => ({ group, index }))
      .filter(({ index }) => index !== currentUserGroupIndex);
  }, [orderedGroups, currentUserGroupIndex]);

  const handleStoryUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";

    if (uploadPreview?.url?.startsWith("blob:")) {
      URL.revokeObjectURL(uploadPreview.url);
    }

    const previewUrl = URL.createObjectURL(file);
    const isVideo = file.type?.startsWith("video");
    setUploadPreview({ url: previewUrl, type: isVideo ? "video" : "image" });
    setPendingFile(file);
    setPreviewOpen(true);
    setUploadProgress(0);
    setUploadStage("idle");
    setUploadError("");
    setUploadSpeed("");
    setPreviewDuration("");
    setPrivacyType(feedScope === "college" ? "friends" : "universal");
    setCollegeTagMode(campusLabel && feedScope === "college" ? "mine" : "none");
    setCustomCollegeTag("");
  };

  const resolveCollegeTag = () => {
    if (collegeTagMode === "mine") return campusLabel || "";
    if (collegeTagMode === "custom") return customCollegeTag.trim();
    return "";
  };

  const buildStoryMeta = () => {
    const meta = {};
    const resolvedPrivacy = privacyType === "friends" ? "friends" : "universal";
    meta.privacyType = resolvedPrivacy;
    meta.privacy = resolvedPrivacy;
    meta.visibility = resolvedPrivacy;
    if (resolvedPrivacy === "universal") {
      meta.isUniversal = true;
    } else {
      meta.isUniversal = false;
      meta.isPrivate = true;
      meta.friendsOnly = true;
    }

    const resolvedTag = resolveCollegeTag();
    if (resolvedTag) {
      meta.collegeTagName = resolvedTag;
      meta.collegeTag = resolvedTag;
    }

    if (collegeTagMode === "mine") {
      const collegeTagId =
        currentUser?.collegeTagId ||
        currentUser?.college_tag_id ||
        currentUser?.collegeTag?._id ||
        "";
      if (collegeTagId) meta.collegeTagId = collegeTagId;
    }

    if (campusLabel) meta.userCollege = campusLabel;
    return meta;
  };

  const isUploading = uploadStage === "uploading" || uploadStage === "processing";

  const handleCancelUpload = () => {
    if (uploadAbortRef.current) {
      uploadAbortRef.current();
      return;
    }
    resetUploadState();
  };

  const handleStartUpload = async () => {
    if (!pendingFile || isUploading) return;
    setUploadStage("uploading");
    setUploadProgress(0);
    setUploadSpeed("");
    setUploadError("");
    uploadStartRef.current = Date.now();
    lastProgressRef.current = { loaded: 0, time: uploadStartRef.current };

    try {
      const meta = buildStoryMeta();
      const createdStory = await createStoryWithProgress(
        pendingFile,
        meta,
        (percent, info) => {
          setUploadProgress(percent);
          if (percent >= 100) {
            setUploadStage((prev) => (prev === "uploading" ? "processing" : prev));
          }
          if (info?.loaded && info?.total) {
            const now = Date.now();
            const last = lastProgressRef.current;
            const deltaBytes = info.loaded - last.loaded;
            const deltaTime = (now - last.time) / 1000;
            lastProgressRef.current = { loaded: info.loaded, time: now };
            if (deltaTime > 0) {
              setUploadSpeed(formatSpeed(deltaBytes / deltaTime));
            }
          }
        },
        (controller) => {
          uploadAbortRef.current = controller?.abort || null;
        }
      );

      const resharePostId =
        meta?.resharedPostId ||
        meta?.resharePostId ||
        meta?.sourcePostId ||
        meta?.postId ||
        meta?.post_id ||
        createdStory?.resharedPostId ||
        createdStory?.postId ||
        createdStory?.post?._id ||
        createdStory?.post?.id ||
        "";

      if (resharePostId) {
        try {
          await recordPostStoryReshare(resharePostId);
        } catch {
          // Ignore reshare tracking errors.
        }
      }

      setUploadProgress(100);
      setUploadStage("success");
      await loadStories();
      resetUploadState();
    } catch (error) {
      if (error?.name === "AbortError") {
        setUploadError("Upload cancelled.");
      } else {
        setUploadError(error.message || "Failed to upload story");
      }
      setUploadStage("error");
    }
  };

  const handleClosePreview = () => {
    if (isUploading) return;
    resetUploadState();
  };

  const handleRetry = () => {
    if (!pendingFile) return;
    setUploadError("");
    setUploadStage("idle");
  };

  const showProcessing = uploadStage === "processing";

  const handleVideoMetadata = (event) => {
    const duration = event.currentTarget?.duration;
    if (Number.isFinite(duration)) {
      setPreviewDuration(formatDuration(duration));
    }
  };

  const handlePreviewLoaded = () => {
    if (!previewDuration) {
      setPreviewDuration("");
    }
  };

  const openStory = useCallback((index) => {
    setSelectedStoryIndex(index);
  }, []);

  const storyListItems = useMemo(
    () =>
      storyGroupsForBar.map(({ group, index }) => (
        <StoryListItem
          key={`${group.authorId || "story"}-${index}`}
          group={group}
          index={index}
          onOpen={openStory}
        />
      )),
    [storyGroupsForBar, openStory]
  );

  const previewCollegeTag = resolveCollegeTag();

  return (
    <>
      <Motion.div
        id="stories-section"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-6"
      >
        <div className="glass-card glass-hover rounded-3xl p-4 transition-all duration-300 ease-out">
          <div className="flex justify-between items-center mb-3 px-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b9b4c7]">
              Stories
            </h2>
            <Motion.button
              onClick={() => fileInputRef.current?.click()}
              className="liquid-button text-xs font-semibold px-3 py-1 rounded-full text-[#faf0e6]"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <i className="fa-solid fa-plus mr-1"></i> Add Story
            </Motion.button>
          </div>

          <div className="flex space-x-4 overflow-x-auto pb-2 scroll-container">
            {/* Your Story */}
            <div className="w-16 flex flex-col items-center flex-shrink-0">
              {currentUserGroupIndex >= 0 ? (
                <Motion.button
                  onClick={() => openStory(currentUserGroupIndex)}
                  className="w-12 h-12 rounded-full border border-[#b9b4c7] overflow-hidden flex items-center justify-center bg-white/10"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <img
                    src={
                      getOptimizedMediaUrl(
                        orderedGroups[currentUserGroupIndex]?.authorProfilePic ||
                          currentUser?.profilePicUrl,
                        { width: 96, height: 96 }
                      ) || ANONYMOUS_AVATAR
                    }
                    alt={currentUser?.fullName || currentUser?.username || "Your Story"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </Motion.button>
              ) : (
                <Motion.button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-12 h-12 rounded-full border border-dashed border-[#b9b4c7] flex items-center justify-center text-[#b9b4c7] hover:bg-white/5 transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <i className="fa-solid fa-plus"></i>
                </Motion.button>
              )}
              <p className="text-[11px] mt-1 w-12 text-left text-[#b9b4c7] truncate whitespace-nowrap">
                Your Story
              </p>
            </div>

            {/* Other Stories */}
            {storyListItems}
          </div>
        </div>
      </Motion.div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*,video/*"
        onChange={handleStoryUpload}
      />

      {selectedStoryIndex !== null && (
        <StoryViewer
          stories={orderedGroups}
          initialIndex={selectedStoryIndex}
          onClose={() => setSelectedStoryIndex(null)}
        />
      )}

      <AnimatePresence>
        {previewOpen && uploadPreview && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={handleClosePreview}
          >
            <Motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ type: "spring", damping: 24, stiffness: 200 }}
              className="w-full max-w-md glass-card rounded-3xl p-5 space-y-4"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#faf0e6]">Story Preview</h3>
                  <p className="text-[11px] text-[#b9b4c7]">
                    {privacyType === "friends" ? "Friends Only" : "Universal"}
                    {previewCollegeTag ? ` • ${previewCollegeTag}` : ""}
                  </p>
                </div>
                <button
                  onClick={handleClosePreview}
                  className="text-[#b9b4c7] hover:text-[#faf0e6] text-xl"
                  disabled={isUploading}
                >
                  &times;
                </button>
              </div>

              <div className="flex items-center gap-3">
                <img
                  src={currentUser?.profilePicUrl || ANONYMOUS_AVATAR}
                  alt={currentUser?.fullName || currentUser?.username || "User"}
                  className="h-10 w-10 rounded-full object-cover"
                />
                <div>
                  <p className="text-sm font-semibold text-[#faf0e6]">
                    {currentUser?.fullName ||
                      currentUser?.displayName ||
                      currentUser?.username ||
                      "You"}
                  </p>
                  <p className="text-[11px] text-[#b9b4c7]">
                    {uploadPreview.type === "video" ? "Video Story" : "Image Story"}
                    {previewDuration ? ` • ${previewDuration}` : ""}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                    Privacy
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPrivacyType("friends")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        privacyType === "friends"
                          ? "bg-white/15 text-[#faf0e6]"
                          : "text-[#b9b4c7] hover:text-[#faf0e6]"
                      }`}
                    >
                      Private Friends
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrivacyType("universal")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        privacyType === "universal"
                          ? "bg-white/15 text-[#faf0e6]"
                          : "text-[#b9b4c7] hover:text-[#faf0e6]"
                      }`}
                    >
                      Universal
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                    College Tag
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCollegeTagMode("none")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        collegeTagMode === "none"
                          ? "bg-white/15 text-[#faf0e6]"
                          : "text-[#b9b4c7] hover:text-[#faf0e6]"
                      }`}
                    >
                      No Tag
                    </button>
                    {campusLabel && (
                      <button
                        type="button"
                        onClick={() => setCollegeTagMode("mine")}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                          collegeTagMode === "mine"
                            ? "bg-white/15 text-[#faf0e6]"
                            : "text-[#b9b4c7] hover:text-[#faf0e6]"
                        }`}
                      >
                        {campusLabel}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setCollegeTagMode("custom")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        collegeTagMode === "custom"
                          ? "bg-white/15 text-[#faf0e6]"
                          : "text-[#b9b4c7] hover:text-[#faf0e6]"
                      }`}
                    >
                      Other College
                    </button>
                  </div>
                  {collegeTagMode === "custom" && (
                    <input
                      type="text"
                      value={customCollegeTag}
                      onChange={(e) => setCustomCollegeTag(e.target.value)}
                      placeholder="Enter college name"
                      className="w-full rounded-2xl glass-input px-4 py-2 text-xs"
                    />
                  )}
                </div>
              </div>

              <div className="relative w-full h-72 rounded-2xl overflow-hidden bg-black/40">
                {uploadPreview.type === "video" ? (
                  <video
                    src={uploadPreview.url}
                    className="w-full h-full object-contain"
                    autoPlay
                    muted
                    loop
                    playsInline
                    onLoadedMetadata={handleVideoMetadata}
                  />
                ) : (
                  <img
                    src={uploadPreview.url}
                    alt="Story preview"
                    className="w-full h-full object-contain"
                    onLoad={handlePreviewLoaded}
                  />
                )}

                {(isUploading || uploadStage === "error" || uploadStage === "success") && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                    <div className="text-center text-[#faf0e6] space-y-2">
                      {isUploading && (
                        <div className="flex items-center justify-center gap-2 text-sm">
                          <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                          <span>
                            {showProcessing ? "Processing media..." : "Uploading..."}
                          </span>
                        </div>
                      )}
                      {!showProcessing && isUploading && (
                        <p className="text-xs">{uploadProgress}%</p>
                      )}
                      {uploadSpeed && isUploading && (
                        <p className="text-[11px] text-white/80">{uploadSpeed}</p>
                      )}
                      {uploadStage === "success" && (
                        <p className="text-sm">Upload complete</p>
                      )}
                      {uploadStage === "error" && (
                        <p className="text-sm text-red-200">{uploadError}</p>
                      )}
                    </div>
                  </div>
                )}

                {isUploading && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                    <div
                      className="h-full bg-emerald-400 transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="flex-1 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-[#b9b4c7] hover:text-[#faf0e6]"
                >
                  {isUploading ? "Cancel Upload" : "Close"}
                </button>
                {uploadStage === "error" && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="flex-1 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-[#faf0e6]"
                  >
                    Retry
                  </button>
                )}
                <Motion.button
                  type="button"
                  onClick={handleStartUpload}
                  disabled={isUploading || uploadStage === "success"}
                  className="flex-1 liquid-button px-4 py-2 text-xs font-semibold text-[#faf0e6] disabled:opacity-60"
                  whileHover={{ scale: isUploading ? 1 : 1.02 }}
                  whileTap={{ scale: isUploading ? 1 : 0.98 }}
                >
                  {uploadStage === "error" ? "Upload Again" : "Upload Story"}
                </Motion.button>
              </div>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
