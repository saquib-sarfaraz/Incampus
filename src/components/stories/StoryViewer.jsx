import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import {
  deleteStory,
  fetchStoryViews,
  getUserById,
  recordStoryView,
  reportStory,
  blockUser,
} from "../../services/api";
import { useApp } from "../../context/useApp";
import StoryViewersPanel from "./StoryViewersPanel";
import ReportModal from "../moderation/ReportModal";
import {
  resolveStoryId,
  resolveStoryMediaType,
  resolveStoryMediaUrl,
  isStoryViewRecent,
} from "../../utils/storyMedia";

const FALLBACK_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=U";

export default function StoryViewer({ stories, initialIndex, onClose }) {
  const { currentUser } = useAuth();
  const { loadStories, cacheUser, getUserFromCache, addBlockedUser } = useApp();
  const [currentGroupIndex, setCurrentGroupIndex] = useState(initialIndex);
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [views, setViews] = useState([]);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const touchStartRef = useRef(null);
  const viewedStoriesRef = useRef(new Set());
  const progressRef = useRef(0);

  const currentGroup = stories[currentGroupIndex];
  const currentStory = currentGroup?.stories[currentStoryIndex];
  const storyId = resolveStoryId(currentStory);

  const handleNext = useCallback(() => {
    const group = stories[currentGroupIndex];
    if (!group) return;

    if (currentStoryIndex < group.stories.length - 1) {
      setCurrentStoryIndex((prev) => prev + 1);
    } else if (currentGroupIndex < stories.length - 1) {
      setCurrentGroupIndex((prev) => prev + 1);
      setCurrentStoryIndex(0);
    } else {
      onClose();
    }
  }, [currentGroupIndex, currentStoryIndex, stories, onClose]);

  const handlePrev = useCallback(() => {
    if (currentStoryIndex > 0) {
      setCurrentStoryIndex((prev) => prev - 1);
    } else if (currentGroupIndex > 0) {
      setCurrentGroupIndex((prev) => prev - 1);
      const prevGroup = stories[currentGroupIndex - 1];
      if (prevGroup) {
        setCurrentStoryIndex(prevGroup.stories.length - 1);
      }
    }
  }, [currentGroupIndex, currentStoryIndex, stories]);

  useEffect(() => {
    if (!currentStory) return;

    progressRef.current = 0;
    setProgress(0);
    const interval = setInterval(() => {
      progressRef.current = Math.min(100, progressRef.current + 2);
      setProgress(progressRef.current);
      if (progressRef.current >= 100) {
        clearInterval(interval);
        setTimeout(() => handleNext(), 0);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [currentStory, handleNext]);

  useEffect(() => {
    const recordView = async () => {
      if (!storyId) return;
      const isOwner = String(currentGroup?.authorId) === String(currentUser?.id);
      if (isOwner) return;
      if (viewedStoriesRef.current.has(storyId)) return;
      viewedStoriesRef.current.add(storyId);
      try {
        await recordStoryView(storyId);
      } catch {
        // Ignore view recording errors to avoid blocking UX.
      }
    };

    recordView();
  }, [currentStory, currentGroup, currentUser, storyId]);

  const loadViews = useCallback(async () => {
    if (!storyId) return;
    setViewsLoading(true);
    try {
      const rawViews = await fetchStoryViews(storyId);
      const recentViews = rawViews.filter(isStoryViewRecent);
      const enriched = await Promise.all(
        recentViews.map(async (view) => {
          const viewerId = view.viewerUserId || view.viewer?._id || view.userId || view.user?._id;
          let viewer = viewerId ? getUserFromCache(viewerId) : null;
          if (!viewer && viewerId) {
            const userData = await getUserById(viewerId);
            if (userData) {
              cacheUser(userData);
              viewer = {
                id: userData._id,
                displayName:
                  userData.fullName?.replace(/ \[DEV\]| \[ANON TEST\]/g, "") || "User",
                profilePicUrl: userData.profilePicUrl,
              };
            }
          }

          return {
            id: view._id || `${viewerId}-${view.viewedAt}`,
            viewerName: viewer?.displayName || view.viewerName || "User",
            viewerAvatar: viewer?.profilePicUrl || view.viewerAvatar || FALLBACK_AVATAR,
            viewedAt: view.viewedAt || view.createdAt || new Date().toISOString(),
          };
        })
      );
      enriched.sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt));
      setViews(enriched);
    } catch {
      setViews([]);
    } finally {
      setViewsLoading(false);
    }
  }, [cacheUser, getUserFromCache, storyId]);

  useEffect(() => {
    const isOwner = String(currentGroup?.authorId) === String(currentUser?.id);
    if (!isOwner) return;
    loadViews();
  }, [currentGroup, currentUser, loadViews]);

  useEffect(() => {
    if (!viewersOpen) return;
    const isOwner = String(currentGroup?.authorId) === String(currentUser?.id);
    if (!isOwner) return;
    loadViews();
  }, [viewersOpen, currentGroup, currentUser, loadViews]);

  useEffect(() => {
    setViewersOpen(false);
  }, [currentGroupIndex, currentStoryIndex]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const handleDelete = async () => {
    if (!storyId) {
      alert("Story ID is missing. Please refresh and try again.");
      return;
    }
    if (!confirm("Delete this story?")) return;
    try {
      await deleteStory(storyId);
      await loadStories();
      onClose();
    } catch (error) {
      alert(error.message || "Failed to delete story");
    }
  };

  const handleReport = () => {
    setShowReport(true);
  };

  const submitReport = async ({ reason, details }) => {
    if (!currentStory?._id) return;
    try {
      await reportStory(currentStory._id, {
        reason,
        details,
        context: "story_viewer",
      });
      alert("Thanks for reporting. Our team will review it.");
    } catch (error) {
      alert(error.message || "Failed to report story");
      throw error;
    }
  };

  const handleBlock = async () => {
    const authorId = currentGroup?.authorId;
    if (!authorId) return;
    if (!confirm("Block this user? You will no longer see their content.")) return;
    try {
      await blockUser(authorId, { context: "story_viewer" });
      addBlockedUser(authorId);
      onClose();
      alert("User blocked.");
    } catch (error) {
      alert(error.message || "Failed to block user");
    }
  };

  const isOwnStory = String(currentGroup?.authorId) === String(currentUser?.id);
  const mediaUrl = resolveStoryMediaUrl(currentStory);
  const mediaType = resolveStoryMediaType(currentStory, mediaUrl);
  const isVideo = mediaType === "video";
  const debugStories = useMemo(() => {
    if (typeof window === "undefined") return false;
    if (!import.meta.env?.DEV) return false;
    return new URLSearchParams(window.location.search).has("debugStories");
  }, []);
  const debugPayload = useMemo(() => {
    if (!debugStories) return "";
    const raw = currentStory || {};
    return JSON.stringify(
      {
        storyId,
        mediaUrl,
        mediaType,
        rawMediaUrl: raw.mediaUrl,
        rawMedia: raw.media,
        rawFile: raw.file,
        rawImage: raw.image,
        rawVideo: raw.video,
        createdAt: raw.createdAt,
        authorId: raw.authorId || raw.author?._id || raw.author,
      },
      null,
      2
    );
  }, [debugStories, currentStory, storyId, mediaUrl, mediaType]);

  if (!currentGroup || !currentStory) return null;

  const handleTouchStart = (event) => {
    touchStartRef.current = event.touches[0]?.clientY || null;
  };

  const handleTouchEnd = (event) => {
    if (!touchStartRef.current || !isOwnStory) return;
    const endY = event.changedTouches[0]?.clientY || 0;
    const delta = touchStartRef.current - endY;
    if (delta > 60) setViewersOpen(true);
    touchStartRef.current = null;
  };

  return (
    <>
      <AnimatePresence>
        <Motion.div
          id="story-viewer-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={onClose}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <Motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full h-full max-w-md max-h-[80vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {showMenu && (
              <div className="absolute inset-0 rounded-2xl bg-black/25 backdrop-blur-sm z-10 pointer-events-none" />
            )}
            <div className="absolute top-4 right-2 z-30 flex items-center gap-2">
              <div className="relative" ref={menuRef}>
                <Motion.button
                  type="button"
                  onClick={() => setShowMenu((prev) => !prev)}
                  className="text-white bg-white/10 rounded-full h-8 w-8 flex items-center justify-center hover:bg-white/20 transition-colors"
                  whileTap={{ scale: 0.9 }}
                  aria-label="Story actions"
                >
                  <i className="fa-solid fa-ellipsis-vertical text-xs"></i>
                </Motion.button>
                {showMenu && (
                  <div className="absolute right-0 mt-2 w-40 rounded-2xl glass-card z-30 overflow-hidden">
                    {isOwnStory ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          handleDelete();
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-rose-200 hover:bg-white/10"
                      >
                        <i className="fa-solid fa-trash-can mr-2"></i>
                        Delete
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setShowMenu(false);
                            handleReport();
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-amber-200 hover:bg-white/10"
                        >
                          <i className="fa-solid fa-flag mr-2"></i>
                          Report
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowMenu(false);
                            handleBlock();
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-rose-200 hover:bg-white/10"
                        >
                          <i className="fa-solid fa-ban mr-2"></i>
                          Block
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-white bg-white/10 rounded-full h-8 w-8 flex items-center justify-center hover:bg-red-500 transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Progress bars */}
            <div className="w-full flex space-x-1 mb-2">
              {currentGroup.stories.map((_, index) => (
                <div
                  key={index}
                  className="h-1 flex-1 bg-white/20 rounded-full overflow-hidden"
                >
                  <Motion.div
                    className="h-full bg-[#b9b4c7]"
                    initial={{ width: index < currentStoryIndex ? "100%" : "0%" }}
                    animate={{
                      width:
                        index < currentStoryIndex
                          ? "100%"
                          : index === currentStoryIndex
                          ? `${progress}%`
                          : "0%",
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Story content */}
            <div className="relative w-full h-full rounded-lg overflow-hidden">
              {mediaUrl ? (
                isVideo ? (
                  <video
                    src={mediaUrl}
                    className="w-full h-full object-contain"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  <img
                    src={mediaUrl}
                    alt="Story"
                    className="w-full h-full object-contain"
                  />
                )
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5 text-[#b9b4c7] text-sm">
                  Story media unavailable
                </div>
              )}

              {debugStories && (
                <div className="absolute bottom-2 left-2 right-2 max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/70 p-2 text-[10px] text-white/80">
                  <pre className="whitespace-pre-wrap">{debugPayload}</pre>
                </div>
              )}

              {/* User info */}
              <div className="absolute top-2 left-2 flex items-center space-x-2 glass-surface rounded-full px-2 py-1">
                <img
                  src={currentGroup.authorProfilePic || FALLBACK_AVATAR}
                  alt={currentGroup.authorDisplayName}
                  className="w-8 h-8 rounded-full border border-[#b9b4c7] object-cover"
                />
                <span className="text-[#faf0e6] text-sm font-semibold">
                  {currentGroup.authorDisplayName || "User"}
                </span>
              </div>

            </div>

            {/* Navigation buttons */}
            <button
              onClick={handlePrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-white bg-white/10 rounded-full h-8 w-8 flex items-center justify-center text-lg hover:bg-white/20 transition-colors"
            >
              &lt;
            </button>
            <button
              onClick={handleNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white bg-white/10 rounded-full h-8 w-8 flex items-center justify-center text-lg hover:bg-white/20 transition-colors"
            >
              &gt;
            </button>

            {isOwnStory && (
              <button
                type="button"
                onClick={() => setViewersOpen(true)}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold text-[#faf0e6] backdrop-blur"
              >
                <i className="fa-regular fa-eye mr-2"></i>
                {views.length} Views
              </button>
            )}
          </Motion.div>
        </Motion.div>
      </AnimatePresence>

      <StoryViewersPanel
        isOpen={viewersOpen}
        onClose={() => setViewersOpen(false)}
        views={views}
        loading={viewsLoading}
      />
      <ReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        onSubmit={submitReport}
        title="Report Story"
      />
    </>
  );
}
