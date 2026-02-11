import { useState, useEffect, useMemo, useRef } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { createStoryWithProgress, fetchStoryViews, getUserById } from "../../services/api";
import { getSocket } from "../../services/socket";
import StoryViewer from "./StoryViewer";
import { resolveStoryId, isStoryRecent, isStoryViewRecent } from "../../utils/storyMedia";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

export default function StoryBar() {
  const { currentUser } = useAuth();
  const { stories, loadStories, cacheUser, getUserFromCache, feedScope, isUserBlocked } =
    useApp();
  const [selectedStoryIndex, setSelectedStoryIndex] = useState(null);
  const [viewCounts, setViewCounts] = useState({});
  const [uploadPreview, setUploadPreview] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDuration, setPreviewDuration] = useState("");
  const [uploadStage, setUploadStage] = useState("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState("");
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);
  const viewCacheRef = useRef({});
  const uploadAbortRef = useRef(null);
  const uploadStartRef = useRef(0);
  const lastProgressRef = useRef({ loaded: 0, time: 0 });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

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

      setViewCounts((prev) => {
        const currentCount = Number(prev[storyId] || 0);
        const resolved =
          nextCount ?? (payload.isNew === false ? currentCount : currentCount + 1);
        viewCacheRef.current[storyId] = resolved;
        return { ...prev, [storyId]: resolved };
      });
    };

    socket.on("story-viewed", handleStoryViewed);
    return () => socket.off("story-viewed", handleStoryViewed);
  }, []);

  useEffect(() => {
    const fetchMissingAuthors = async () => {
      const missing = new Set();
      stories.forEach((story) => {
        const authorId = story.authorId || story.author?._id || story.author;
        if (!authorId) return;
        const cached = getUserFromCache(authorId);
        const hasName =
          story.authorDisplayName ||
          story.author?.displayName ||
          story.author?.fullName ||
          story.author?.username;
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
  }, [stories, getUserFromCache, cacheUser]);

  useEffect(() => {
    if (!currentUser) return;
    const ownStoryIds = stories
      .filter(isStoryRecent)
      .filter((story) => {
        const authorId = story.authorId || story.author?._id || story.author;
        return authorId && String(authorId) === String(currentUser.id);
      })
      .map((story) => resolveStoryId(story))
      .filter(Boolean);

    if (ownStoryIds.length === 0) return;

    const loadCounts = async () => {
      await Promise.all(
        ownStoryIds.map(async (storyId) => {
          if (Object.prototype.hasOwnProperty.call(viewCacheRef.current, storyId)) return;
          try {
            const views = await fetchStoryViews(storyId);
            const recentViews = views.filter(isStoryViewRecent);
            viewCacheRef.current[storyId] = recentViews.length;
            setViewCounts((prev) => ({ ...prev, [storyId]: recentViews.length }));
          } catch {
            viewCacheRef.current[storyId] = 0;
          }
        })
      );
    };

    loadCounts();
  }, [stories, currentUser]);

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
  };

  const resolveStoryName = (story, cachedUser) => {
    return (
      story.authorDisplayName ||
      story.author?.displayName ||
      story.author?.fullName ||
      cachedUser?.displayName ||
      cachedUser?.name ||
      story.author?.username ||
      cachedUser?.username ||
      "User"
    );
  };

  const resolveStoryAvatar = (story, cachedUser) => {
    return (
      story.authorProfilePic ||
      story.author?.profilePicUrl ||
      cachedUser?.profilePicUrl ||
      ANONYMOUS_AVATAR
    );
  };

  const resolveStoryCampus = (story, cachedUser) => {
    return (
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
  };

  const campusLabel = currentUser?.university || currentUser?.college || "";
  const currentCollegeGroupId =
    currentUser?.collegeGroupId ||
    currentUser?.college_group_id ||
    currentUser?.groupId ||
    currentUser?.collegeGroup ||
    "";

  const resolveStoryGroupId = (story) => {
    return (
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
  };

  const filteredStories = useMemo(() => {
    if (!stories || stories.length === 0) return [];
    const safeStories = stories.filter((story) => {
      if (!isStoryRecent(story)) return false;
      const authorId = story.authorId || story.author?._id || story.author;
      return !isUserBlocked(authorId);
    });
    if (feedScope !== "college") return safeStories;
    const campusLower = campusLabel.toLowerCase();
    return safeStories.filter((story) => {
      const storyGroupId = resolveStoryGroupId(story);
      if (currentCollegeGroupId && storyGroupId) {
        return String(storyGroupId) === String(currentCollegeGroupId);
      }
      if (!campusLabel) return false;
      const authorId = story.authorId || story.author?._id || story.author;
      const cachedUser = authorId ? getUserFromCache(authorId) : null;
      const storyCampus = resolveStoryCampus(story, cachedUser);
      if (!storyCampus) return false;
      return String(storyCampus).toLowerCase() === campusLower;
    });
  }, [
    stories,
    feedScope,
    campusLabel,
    getUserFromCache,
    currentCollegeGroupId,
    isUserBlocked,
  ]);

  const orderedStories = useMemo(() => {
    if (feedScope === "college") return filteredStories;
    return [...filteredStories].sort((a, b) => {
      const aViews =
        a.viewsCount ||
        a.viewCount ||
        (Array.isArray(a.views) ? a.views.length : 0) ||
        0;
      const bViews =
        b.viewsCount ||
        b.viewCount ||
        (Array.isArray(b.views) ? b.views.length : 0) ||
        0;
      if (aViews !== bViews) return bViews - aViews;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }, [filteredStories, feedScope]);

  const groupedStories = useMemo(() => {
    const grouped = {};
    orderedStories.forEach((story) => {
      const rawAuthorId = story.authorId || story.author?._id || story.author;
      const authorId = rawAuthorId || `unknown-${story._id || "story"}`;
      const cachedUser = rawAuthorId ? getUserFromCache(rawAuthorId) : null;
      const displayName = resolveStoryName(story, cachedUser);
      const profilePicUrl = resolveStoryAvatar(story, cachedUser);
      if (!grouped[authorId]) {
        grouped[authorId] = {
          authorId,
          authorDisplayName: displayName,
          authorProfilePic: profilePicUrl,
          stories: [],
        };
      }
      grouped[authorId].authorDisplayName = displayName;
      grouped[authorId].authorProfilePic = profilePicUrl;
      grouped[authorId].stories.push({
        ...story,
        authorId,
        authorDisplayName: displayName,
        authorProfilePic: profilePicUrl,
        storyId: resolveStoryId(story),
      });
    });
    return Object.values(grouped);
  }, [orderedStories, getUserFromCache]);

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
  };

  const buildStoryMeta = () => {
    const meta = {};
    if (feedScope === "college") {
      meta.isUniversal = false;
      if (campusLabel) meta.collegeTagName = campusLabel;
      const collegeTagId =
        currentUser?.collegeTagId ||
        currentUser?.college_tag_id ||
        currentUser?.collegeTag?._id ||
        "";
      if (collegeTagId) meta.collegeTagId = collegeTagId;
    } else {
      meta.isUniversal = true;
    }
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
      await createStoryWithProgress(
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

  const openStory = (index) => {
    setSelectedStoryIndex(index);
  };

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
              <Motion.button
                onClick={() => fileInputRef.current?.click()}
                className="w-12 h-12 rounded-full border border-dashed border-[#b9b4c7] flex items-center justify-center text-[#b9b4c7] hover:bg-white/5 transition-colors"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <i className="fa-solid fa-plus"></i>
              </Motion.button>
              <p className="text-[11px] text-center mt-1 truncate w-14 text-[#b9b4c7]">
                Your Story
              </p>
            </div>

            {/* Other Stories */}
            {groupedStories.map((group, index) => {
              const isOwner = String(group.authorId) === String(currentUser?.id);
              const groupViews = group.stories.reduce(
                (sum, story) =>
                  sum +
                  (viewCounts[story.storyId || story._id] ||
                    story.viewsCount ||
                    story.views?.length ||
                    0),
                0
              );

              return (
              <Motion.div
                key={group.authorId}
                className="w-16 flex flex-col items-center cursor-pointer flex-shrink-0"
                onClick={() => openStory(index)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <div className="w-12 h-12 rounded-full border border-[#b9b4c7] overflow-hidden flex items-center justify-center bg-white/10">
                  <img
                    src={group.authorProfilePic || ANONYMOUS_AVATAR}
                    alt={group.authorDisplayName}
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-[11px] font-medium text-center truncate w-14 mt-1 text-[#faf0e6]">
                  {group.authorDisplayName || "User"}
                </p>
                {isOwner && (
                  <span className="mt-0.5 text-[10px] text-[#b9b4c7]">
                    <i className="fa-regular fa-eye mr-1"></i>
                    {groupViews}
                  </span>
                )}
              </Motion.div>
              );
            })}
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
          stories={groupedStories}
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
                    {campusLabel ? `College: ${campusLabel}` : "Universal Story"}
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
