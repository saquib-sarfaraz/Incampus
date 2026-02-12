import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
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
const IMAGE_DURATION_MS = 5000;
const VIDEO_FALLBACK_MS = 15000;
const HOLD_TO_PAUSE_MS = 180;

export default function StoryViewer({ stories, initialIndex, onClose }) {
  const { currentUser } = useAuth();
  const { loadStories, cacheUser, getUserFromCache, addBlockedUser } = useApp();
  const [currentGroupIndex, setCurrentGroupIndex] = useState(initialIndex);
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [views, setViews] = useState([]);
  const [viewsCount, setViewsCount] = useState(0);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const menuRef = useRef(null);
  const touchStartRef = useRef(null);
  const viewedStoriesRef = useRef(new Set());
  const progressRef = useRef(0);
  const durationRef = useRef(IMAGE_DURATION_MS);
  const startTimeRef = useRef(0);
  const pausedAtRef = useRef(null);
  const pausedTotalRef = useRef(0);
  const suppressTapRef = useRef(false);
  const mutedByStoryRef = useRef({});
  const videoRef = useRef(null);
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  const currentGroup = stories[currentGroupIndex];
  const currentStory = currentGroup?.stories[currentStoryIndex];
  const storyId = resolveStoryId(currentStory);
  const mediaUrl = resolveStoryMediaUrl(currentStory);
  const mediaType = resolveStoryMediaType(currentStory, mediaUrl);
  const isVideo = mediaType === "video";

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
    if (!storyId) {
      setIsMuted(true);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(mutedByStoryRef.current, storyId)) {
      setIsMuted(Boolean(mutedByStoryRef.current[storyId]));
    } else {
      setIsMuted(true);
    }
  }, [storyId]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = isMuted;
    videoRef.current.volume = isMuted ? 0 : 1;
  }, [isMuted, storyId]);

  useEffect(() => {
    if (!isVideo || !videoRef.current) return;
    if (isPaused) {
      videoRef.current.pause();
      return;
    }
    videoRef.current.play().catch(() => {});
  }, [isVideo, isPaused, storyId]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    if (!currentStory) return;
    progressRef.current = 0;
    setProgress(0);
    setIsPaused(false);
    pausedAtRef.current = null;
    pausedTotalRef.current = 0;
    startTimeRef.current = performance.now();
    const initialDuration = isVideo ? VIDEO_FALLBACK_MS : IMAGE_DURATION_MS;
    durationRef.current = initialDuration;
  }, [currentStory, isVideo]);

  useEffect(() => {
    if (!currentStory) return;
    let rafId = 0;
    const tick = (now) => {
      if (isPaused) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (isVideo && videoRef.current) {
        const duration = durationRef.current || VIDEO_FALLBACK_MS;
        const current = Math.max(0, videoRef.current.currentTime || 0) * 1000;
        const nextProgress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
        progressRef.current = nextProgress;
        setProgress(nextProgress);
        if (nextProgress >= 100) {
          handleNext();
          return;
        }
      } else {
        const duration = durationRef.current || IMAGE_DURATION_MS;
        const elapsed = now - startTimeRef.current - pausedTotalRef.current;
        const nextProgress = Math.min(100, (elapsed / duration) * 100);
        progressRef.current = nextProgress;
        setProgress(nextProgress);
        if (nextProgress >= 100) {
          handleNext();
          return;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [currentStory, isVideo, isPaused, handleNext]);

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
      const response = await fetchStoryViews(storyId);
      const rawViews = Array.isArray(response) ? response : [];
      const recentViews = rawViews.filter(isStoryViewRecent);
      const resolvedCount =
        typeof response?.count === "number" ? response.count : recentViews.length;
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
      setViewsCount(resolvedCount);
    } catch {
      setViews([]);
      setViewsCount(0);
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
    setViewsCount(0);
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
    const touch = event.touches[0];
    handleHoldStart();
    touchStartRef.current = {
      x: touch?.clientX ?? null,
      y: touch?.clientY ?? null,
    };
  };

  const handleTouchEnd = (event) => {
    const start = touchStartRef.current;
    if (!start || start.x === null || start.y === null) return;
    const touch = event.changedTouches[0];
    const endX = touch?.clientX ?? 0;
    const endY = touch?.clientY ?? 0;
    const deltaX = endX - start.x;
    const deltaY = endY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    touchStartRef.current = null;
    handleHoldEnd();

    if (absX > 50 && absX > absY) {
      if (deltaX < 0) {
        handleNext();
      } else {
        handlePrev();
      }
      return;
    }

    if (absY > 60 && absY > absX) {
      if (deltaY > 0) {
        onClose();
        return;
      }
      if (isOwnStory && deltaY < 0) {
        setViewersOpen(true);
      }
    }
  };

  const handleHoldStart = () => {
    if (pausedAtRef.current) return;
    suppressTapRef.current = false;
    pausedAtRef.current = performance.now();
    setIsPaused(true);
  };

  const handleHoldEnd = () => {
    const start = pausedAtRef.current;
    if (!start) {
      setIsPaused(false);
      return;
    }
    const duration = performance.now() - start;
    if (duration >= HOLD_TO_PAUSE_MS) {
      suppressTapRef.current = true;
      setTimeout(() => {
        suppressTapRef.current = false;
      }, 200);
    }
    pausedTotalRef.current += duration;
    pausedAtRef.current = null;
    setIsPaused(false);
  };

  const handlePrevTap = () => {
    if (suppressTapRef.current) return;
    handlePrev();
  };

  const handleNextTap = () => {
    if (suppressTapRef.current) return;
    handleNext();
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      if (storyId) {
        mutedByStoryRef.current[storyId] = next;
      }
      return next;
    });
  };

  const handleVideoMetadata = () => {
    if (!videoRef.current) return;
    const duration = videoRef.current.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const ms = duration * 1000;
    durationRef.current = ms;
  };

  const overlay = (
    <AnimatePresence>
      <Motion.div
        id="story-viewer-modal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black flex items-stretch justify-stretch"
        onClick={onClose}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleHoldEnd}
      >
        <Motion.div
          initial={{ opacity: 0.9, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0.9, scale: 0.98 }}
          className="relative w-screen h-[100dvh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {showMenu && (
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm z-10 pointer-events-none" />
          )}

          <div className="absolute inset-x-0 top-0 z-30 px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center space-x-2 glass-surface rounded-full px-2 py-1">
                <img
                  src={currentGroup.authorProfilePic || FALLBACK_AVATAR}
                  alt={currentGroup.authorDisplayName}
                  className="w-8 h-8 rounded-full border border-[#b9b4c7] object-cover"
                />
                <span className="text-[#faf0e6] text-sm font-semibold">
                  {currentGroup.authorDisplayName || "User"}
                </span>
              </div>
              <div className="flex items-center gap-2">
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
            </div>

            <div className="mt-3 flex space-x-1">
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
          </div>

          <div
            className="relative flex-1 w-full h-full overflow-hidden"
            onPointerDown={(event) => {
              if (event.pointerType !== "touch") handleHoldStart();
            }}
            onPointerUp={(event) => {
              if (event.pointerType !== "touch") handleHoldEnd();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") handleHoldEnd();
            }}
            onPointerCancel={(event) => {
              if (event.pointerType !== "touch") handleHoldEnd();
            }}
          >
            {mediaUrl ? (
              isVideo ? (
                <video
                  ref={videoRef}
                  key={storyId || mediaUrl}
                  src={mediaUrl}
                  className="w-full h-full object-cover"
                  autoPlay
                  muted={isMuted}
                  playsInline
                  onLoadedMetadata={handleVideoMetadata}
                  onDurationChange={handleVideoMetadata}
                  onEnded={handleNext}
                />
              ) : (
                <img
                  src={mediaUrl}
                  alt="Story"
                  className="w-full h-full object-cover"
                />
              )
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-white/5 text-[#b9b4c7] text-sm">
                Story media unavailable
              </div>
            )}

            <div className="absolute inset-0 z-10 pointer-events-none">
              <button
                type="button"
                onClick={handlePrevTap}
                className="absolute inset-y-0 left-0 w-1/2 cursor-pointer pointer-events-auto"
                aria-label="Previous story"
              />
              <button
                type="button"
                onClick={handleNextTap}
                className="absolute inset-y-0 right-0 w-1/2 cursor-pointer pointer-events-auto"
                aria-label="Next story"
              />
            </div>

            {debugStories && (
              <div className="absolute bottom-2 left-2 right-2 max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/70 p-2 text-[10px] text-white/80">
                <pre className="whitespace-pre-wrap">{debugPayload}</pre>
              </div>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] flex items-center justify-between">
            <div className="flex-1 flex justify-center">
              {isOwnStory && (
                <button
                  type="button"
                  onClick={() => setViewersOpen(true)}
                  className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold text-[#faf0e6] backdrop-blur"
                >
                  <i className="fa-regular fa-eye mr-2"></i>
                  {viewsCount || views.length} Views
                </button>
              )}
            </div>
            {isVideo && (
              <button
                type="button"
                onClick={handleToggleMute}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/60"
                aria-label={isMuted ? "Unmute story" : "Mute story"}
              >
                <i
                  className={`fa-solid ${isMuted ? "fa-volume-xmark" : "fa-volume-high"} text-sm`}
                ></i>
              </button>
            )}
          </div>
        </Motion.div>
      </Motion.div>
    </AnimatePresence>
  );

  return (
    <>
      {portalTarget ? createPortal(overlay, portalTarget) : overlay}

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
