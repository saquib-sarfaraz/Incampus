import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReelCard from "./ReelCard";
import ReelCommentsSheet from "./ReelCommentsSheet";
import { InBuzzViewerSkeleton } from "./InBuzzSkeleton";
import { getOptimizedMediaUrl } from "../../utils/media";
import {
  likeInBuzzReel,
  recordInBuzzReelView,
  shareInBuzzReel,
} from "../../services/api";

export default function ReelViewer({
  reels = [],
  initialIndex = 0,
  loading = false,
  onShare,
  onInfo,
  onOpenProfile,
  onActiveIndexChange,
}) {
  const containerRef = useRef(null);
  const videoRefs = useRef({});
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [likedIds, setLikedIds] = useState(() => new Set());
  const [muted, setMuted] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = localStorage.getItem("inbuzz:muted");
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {
      // ignore storage errors
    }
    return true;
  });
  const [commentsFor, setCommentsFor] = useState(null); // { reelId, ownerId }
  const [, setStatsTick] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerHeight
  );
  const statsRef = useRef(new Map());
  const sentViewRef = useRef(new Set());
  const watchTimersRef = useRef({ raf: null, start: 0, last: 0, ms: 0, id: "" });
  const primedRef = useRef(new Set());
  const prefetchedThumbsRef = useRef(new Set());
  const activeIdRef = useRef("");

  const safeReels = useMemo(() => (Array.isArray(reels) ? reels : []), [reels]);

  const networkTier = useMemo(() => {
    if (typeof navigator === "undefined") return "high";
    const connection =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return "high";
    if (connection.saveData) return "low";
    const type = String(connection.effectiveType || "").toLowerCase();
    if (type.includes("slow-2g") || type.includes("2g")) return "low";
    if (type.includes("3g")) return "mid";
    return "high";
  }, []);

  const thumbWidth = useMemo(() => {
    if (networkTier === "low") return 360;
    if (networkTier === "mid") return 480;
    return 720;
  }, [networkTier]);

  const canAggressivelyPreload = networkTier === "high";

  const getThumbUrl = useCallback(
    (reel) => {
      const raw = reel?.thumbnailUrl || reel?.thumbnail || reel?.poster || "";
      if (!raw) return "";
      return getOptimizedMediaUrl(raw, { width: thumbWidth });
    },
    [thumbWidth]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!safeReels.length) return;

    const maxAhead = networkTier === "high" ? 2 : networkTier === "mid" ? 1 : 0;
    const indices = [activeIndex, activeIndex + 1];
    for (let offset = 2; offset <= 1 + maxAhead; offset += 1) {
      indices.push(activeIndex + offset);
    }

    indices.forEach((idx) => {
      if (idx < 0 || idx >= safeReels.length) return;
      const url = getThumbUrl(safeReels[idx]);
      if (!url) return;
      if (prefetchedThumbsRef.current.has(url)) return;
      prefetchedThumbsRef.current.add(url);
      const img = new Image();
      try {
        img.decoding = "async";
      } catch {
        // ignore
      }
      img.src = url;
    });

    // Cap memory growth if the user scrolls endlessly.
    if (prefetchedThumbsRef.current.size > 240) {
      prefetchedThumbsRef.current = new Set(
        Array.from(prefetchedThumbsRef.current).slice(-140)
      );
    }
  }, [activeIndex, safeReels, networkTier, getThumbUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("inbuzz:muted", muted ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [muted]);

  useEffect(() => {
    setActiveIndex((prev) => {
      if (!safeReels.length) return 0;
      if (initialIndex < 0 || initialIndex >= safeReels.length) return prev;
      return initialIndex;
    });
  }, [initialIndex, safeReels.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !safeReels.length || !viewportHeight) return;
    container.scrollTop = initialIndex * viewportHeight;
  }, [initialIndex, safeReels.length, viewportHeight]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || !viewportHeight) return;
    const next = Math.round(container.scrollTop / viewportHeight);
    const clamped = Math.max(0, Math.min(safeReels.length - 1, next));
    setActiveIndex((prev) => (prev === clamped ? prev : clamped));
  }, [safeReels.length, viewportHeight]);

  useEffect(() => {
    onActiveIndexChange?.(activeIndex);
  }, [activeIndex, onActiveIndexChange]);

  useEffect(() => {
    const activeReel = safeReels[activeIndex];
    activeIdRef.current = activeReel?.id ? String(activeReel.id) : "";
    Object.entries(videoRefs.current).forEach(([id, video]) => {
      if (!video) return;
      if (activeReel && String(id) === String(activeReel.id)) {
        try {
          video.muted = muted;
        } catch {
          // ignore
        }
        video
          .play()
          .catch(() => {
            // If autoplay-with-sound gets blocked, fall back to muted autoplay.
            if (!muted) {
              try {
                video.muted = true;
              } catch {
                // ignore
              }
              setMuted(true);
            }
          });
      } else {
        video.pause();
      }
    });

    // Warm up the *next* reel so it starts instantly when the user swipes.
    // We keep it muted while priming to avoid any sound leakage.
    const nextReel = safeReels[activeIndex + 1];
    const nextId = nextReel?.id ? String(nextReel.id) : "";
    const nextVideo = nextId ? videoRefs.current[nextId] : null;
    if (
      nextVideo &&
      nextId &&
      canAggressivelyPreload &&
      !primedRef.current.has(nextId) &&
      (typeof nextVideo.readyState !== "number" || nextVideo.readyState < 3)
    ) {
      primedRef.current.add(nextId);
      const previousMuted = Boolean(nextVideo.muted);
      try {
        nextVideo.preload = "auto";
      } catch {
        // ignore
      }
      try {
        // Avoid restarting a partially buffered element.
        if (typeof nextVideo.readyState === "number" && nextVideo.readyState === 0) {
          nextVideo.load?.();
        }
      } catch {
        // ignore
      }

      try {
        nextVideo.muted = true;
        const playPromise = nextVideo.play?.();
        if (playPromise && typeof playPromise.then === "function") {
          playPromise
            .then(() => {
              // Give the browser a moment to buffer a few frames, then pause.
              setTimeout(() => {
                try {
                  if (activeIdRef.current !== nextId) {
                    nextVideo.pause();
                  }
                  nextVideo.muted = previousMuted;
                } catch {
                  // ignore
                }
              }, 240);
            })
            .catch(() => {
              try {
                nextVideo.muted = previousMuted;
              } catch {
                // ignore
              }
            });
        } else {
          setTimeout(() => {
            try {
              if (activeIdRef.current !== nextId) {
                nextVideo.pause();
              }
              nextVideo.muted = previousMuted;
            } catch {
              // ignore
            }
          }, 240);
        }
      } catch {
        try {
          nextVideo.muted = previousMuted;
        } catch {
          // ignore
        }
      }

      // Cap memory growth if the user scrolls a lot.
      if (primedRef.current.size > 80) {
        primedRef.current = new Set(Array.from(primedRef.current).slice(-40));
      }
    }
  }, [activeIndex, muted, safeReels, canAggressivelyPreload]);

  useEffect(() => {
    if (!safeReels.length) return;
    setLikedIds((prev) => {
      if (prev && prev.size) return prev;
      const next = new Set();
      safeReels.forEach((reel) => {
        if (reel?.isLiked) next.add(String(reel.id));
      });
      return next;
    });
  }, [safeReels]);

  const applyStatDelta = useCallback((id, delta) => {
    if (!id) return;
    const key = String(id);
    const prev = statsRef.current.get(key) || {};
    statsRef.current.set(key, { ...prev, ...delta });
    setStatsTick((x) => x + 1);
  }, []);

  const toggleLike = async (id) => {
    if (!id) return;
    const key = String(id);
    let wasLiked = false;
    setLikedIds((prev) => {
      const next = new Set(prev);
      wasLiked = next.has(key);
      if (wasLiked) next.delete(key);
      else next.add(key);
      return next;
    });
    applyStatDelta(key, {
      likesDelta: (statsRef.current.get(key)?.likesDelta || 0) + (wasLiked ? -1 : 1),
    });
    try {
      await likeInBuzzReel(key, {});
    } catch {
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(key);
        else next.delete(key);
        return next;
      });
      applyStatDelta(key, {
        likesDelta: (statsRef.current.get(key)?.likesDelta || 0) + (wasLiked ? 1 : -1),
      });
    }
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);

    const activeReel = safeReels[activeIndex];
    const key = activeReel?.id ? String(activeReel.id) : "";
    const video = key ? videoRefs.current[key] : null;
    if (!video) return;
    try {
      // eslint-disable-next-line react-hooks/immutability
      video.muted = nextMuted;
      if (!nextMuted) {
        video.volume = 1;
        video.play?.().catch(() => {});
      }
    } catch {
      // ignore playback errors
    }
  };

  const windowed = useMemo(() => {
    const total = safeReels.length;
    if (!total) {
      return { start: 0, end: -1, reels: [], top: 0, bottom: 0 };
    }
    const start = Math.max(0, activeIndex - 1);
    const end = Math.min(total - 1, activeIndex + 1);
    return {
      start,
      end,
      reels: safeReels.slice(start, end + 1),
      top: viewportHeight * start,
      bottom: viewportHeight * (total - end - 1),
    };
  }, [activeIndex, safeReels, viewportHeight]);

  const getReel = useCallback((reel) => {
    if (!reel?.id) return reel;
    const patch = statsRef.current.get(String(reel.id));
    if (!patch) return reel;
    const likes = Number(reel.likes || 0) + Number(patch.likesDelta || 0);
    const comments = Number(reel.comments || 0) + Number(patch.commentsDelta || 0);
    const shares = Number(reel.shares || 0) + Number(patch.sharesDelta || 0);
    return { ...reel, likes, comments, shares };
  }, []);

  useEffect(() => {
    const reel = safeReels[activeIndex];
    if (!reel?.id) return;
    const id = String(reel.id);
    if (sentViewRef.current.has(id)) return;

    watchTimersRef.current.id = id;
    watchTimersRef.current.start = performance.now();
    watchTimersRef.current.last = performance.now();
    watchTimersRef.current.ms = 0;

    const tick = () => {
      const currentId = watchTimersRef.current.id;
      if (currentId !== id) return;
      const now = performance.now();
      const delta = now - watchTimersRef.current.last;
      watchTimersRef.current.last = now;
      watchTimersRef.current.ms += delta;
      if (watchTimersRef.current.ms >= 3000) {
        sentViewRef.current.add(id);
        recordInBuzzReelView(id, { watchDuration: 3, completed: false }).catch(() => {});
        return;
      }
      watchTimersRef.current.raf = requestAnimationFrame(tick);
    };

    watchTimersRef.current.raf = requestAnimationFrame(tick);
    return () => {
      if (watchTimersRef.current.raf) cancelAnimationFrame(watchTimersRef.current.raf);
      watchTimersRef.current.raf = null;
      watchTimersRef.current.id = "";
    };
  }, [activeIndex, safeReels]);

  if (loading && !safeReels.length) {
    return <InBuzzViewerSkeleton />;
  }

  if (!safeReels.length) {
    return (
      <div className="h-[100dvh] flex items-center justify-center text-[#b9b4c7]">
        No InBuzz reels yet.
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-[100dvh] w-full overflow-y-auto snap-y snap-mandatory scroll-smooth overscroll-contain"
      >
        {windowed.top > 0 && <div style={{ height: windowed.top }} />}
        {windowed.reels.map((raw, idx) => {
          const index = windowed.start + idx;
          const reel = getReel(raw);
          const showVideo = Math.abs(index - activeIndex) <= 1;
          const neighborPreload = networkTier === "low" ? "none" : "metadata";
          const nextPreload =
            networkTier === "high" ? "auto" : networkTier === "mid" ? "metadata" : "none";
          return (
            <ReelCard
              key={reel.id}
              reel={reel}
              index={index}
              isActive={index === activeIndex}
              showVideo={showVideo}
              preload={
                index === activeIndex
                  ? "auto"
                  : index === activeIndex + 1
                    ? nextPreload
                    : neighborPreload
              }
              thumbWidth={thumbWidth}
              muted={muted}
              onToggleMute={toggleMute}
              onShare={async () => {
                onShare?.(reel);
                applyStatDelta(reel.id, {
                  sharesDelta: (statsRef.current.get(String(reel.id))?.sharesDelta || 0) + 1,
                });
                shareInBuzzReel(reel.id, { shareType: "link" }).catch(() => {});
              }}
              onInfo={() => onInfo?.(reel)}
              onLike={() => toggleLike(reel.id)}
              onComment={() =>
                setCommentsFor({
                  reelId: reel.id,
                  ownerId:
                    reel?.userId ||
                    reel?.user_id ||
                    reel?.authorId ||
                    reel?.author?.id ||
                    "",
                })
              }
              onOpenProfile={() => onOpenProfile?.(reel)}
              liked={likedIds.has(String(reel.id))}
              cardRef={null}
              videoRef={(node) => {
                if (node) {
                  videoRefs.current[String(reel.id)] = node;
                } else {
                  delete videoRefs.current[String(reel.id)];
                }
              }}
            />
          );
        })}
        {windowed.bottom > 0 && <div style={{ height: windowed.bottom }} />}
      </div>

      <ReelCommentsSheet
        isOpen={!!commentsFor}
        reelId={commentsFor?.reelId}
        reelOwnerId={commentsFor?.ownerId}
        onClose={() => setCommentsFor(null)}
        onCountChange={(delta) => {
          const reelId = commentsFor?.reelId;
          if (!reelId) return;
          applyStatDelta(reelId, {
            commentsDelta: (statsRef.current.get(String(reelId))?.commentsDelta || 0) + (delta || 0),
          });
        }}
      />
    </>
  );
}
