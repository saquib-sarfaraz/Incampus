import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import ReelActions from "./ReelActions";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { getOptimizedMediaUrl } from "../../utils/media";
import { getStreamUrl } from "../../utils/inbuzzStream";
import { fetchInBuzzStreamToken } from "../../services/api";

const truncateCaption = (caption = "", limit = 120) => {
  const text = caption.trim();
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}…`, truncated: true };
};

export default function ReelCard({
  reel,
  index,
  isActive,
  showVideo,
  preload = "metadata",
  thumbWidth = 720,
  muted,
  onToggleMute,
  onShare,
  onInfo,
  onLike,
  onComment,
  liked,
  onOpenProfile,
  cardRef,
  videoRef,
}) {
  const { currentUser, authToken } = useAuth();
  const { getUserFromCache, prefetchUserProfile } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [mediaLikePulse, setMediaLikePulse] = useState(0);
  const [soundToast, setSoundToast] = useState("");
  const [soundToastPulse, setSoundToastPulse] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [streamToken, setStreamToken] = useState("");
  const [avatarErrorSrc, setAvatarErrorSrc] = useState("");
  const lastTapRef = useRef(0);
  const soundToastTimerRef = useRef(null);
  const retriedRef = useRef(false);
  const prefetchedAuthorRef = useRef(new Set());
  const captionValue = reel?.caption || "";
  const reelId = useMemo(() => String(reel?.id || reel?._id || ""), [reel?.id, reel?._id]);
  const reelUserId = useMemo(() => {
    return String(reel?.userId || reel?.user_id || reel?.authorId || reel?.author?.id || "");
  }, [reel?.author?.id, reel?.authorId, reel?.userId, reel?.user_id]);
  const cachedAuthor = useMemo(() => {
    if (!reelUserId) return null;
    return getUserFromCache?.(reelUserId) || null;
  }, [getUserFromCache, reelUserId]);

  useEffect(() => {
    if (!isActive) return;
    if (!reelUserId) return;
    if (
      currentUser?.id &&
      String(currentUser.id || currentUser._id || "") === String(reelUserId)
    ) {
      return;
    }
    const hasHandle = Boolean(
      String(reel?.username || reel?.author?.username || cachedAuthor?.username || "").trim()
    );
    const hasAvatar =
      Boolean(reel?.profilePicUrl) ||
      Boolean(reel?.author?.profilePicUrl) ||
      Boolean(cachedAuthor?.profilePicUrl);
    if (hasHandle && hasAvatar) return;
    if (prefetchedAuthorRef.current.has(reelUserId)) return;
    prefetchedAuthorRef.current.add(reelUserId);
    prefetchUserProfile?.(reelUserId, reel?.author || { _id: reelUserId }).catch(() => {});
  }, [
    cachedAuthor?.displayName,
    cachedAuthor?.name,
    cachedAuthor?.username,
    cachedAuthor?.profilePicUrl,
    currentUser?._id,
    currentUser?.id,
    isActive,
    prefetchUserProfile,
    reel?.author,
    reel?.author?.fullName,
    reel?.author?.username,
    reel?.author?.name,
    reel?.author?.profilePicUrl,
    reel?.displayName,
    reel?.profilePicUrl,
    reel?.username,
    reelUserId,
  ]);

  const avatarSrc = useMemo(() => {
    return (
      cachedAuthor?.profilePicUrl ||
      reel?.profilePicUrl ||
      reel?.profilePic ||
      reel?.profile_picture ||
      reel?.author?.profilePicUrl ||
      reel?.author?.profilePic ||
      reel?.author?.avatarUrl ||
      reel?.author?.avatar ||
      reel?.author?.imageUrl ||
      reel?.author?.photoURL ||
      reel?.author?.photoUrl ||
      ""
    );
  }, [
    cachedAuthor?.profilePicUrl,
    reel?.author?.avatar,
    reel?.author?.avatarUrl,
    reel?.author?.imageUrl,
    reel?.author?.photoURL,
    reel?.author?.photoUrl,
    reel?.author?.profilePic,
    reel?.author?.profilePicUrl,
    reel?.profilePic,
    reel?.profilePicUrl,
    reel?.profile_picture,
  ]);
  const authorLabel = useMemo(() => {
    const isSelf =
      reelUserId && (currentUser?.id || currentUser?._id)
        ? String(reelUserId) === String(currentUser.id || currentUser._id)
        : false;

    const rawHandle =
      typeof reel?.username === "string"
        ? reel.username
        : typeof reel?.author?.username === "string"
          ? reel.author.username
          : typeof cachedAuthor?.username === "string"
            ? cachedAuthor.username
        : isSelf && typeof currentUser?.username === "string"
          ? currentUser.username
          : "";
    const cleanedHandle = rawHandle.trim().replace(/^@/, "");
    const handleText =
      cleanedHandle && !/\s/.test(cleanedHandle) ? `@${cleanedHandle}` : "";
    const name =
      (typeof reel?.displayName === "string" ? reel.displayName.trim() : "") ||
      (typeof cachedAuthor?.displayName === "string" ? cachedAuthor.displayName.trim() : "") ||
      (typeof cachedAuthor?.name === "string" ? cachedAuthor.name.trim() : "") ||
      (isSelf
        ? String(
            currentUser?.displayName ||
              currentUser?.fullName ||
              currentUser?.name ||
              ""
          ).trim()
        : "") ||
      (typeof reel?.author?.fullName === "string" ? reel.author.fullName.trim() : "") ||
      (typeof reel?.author?.name === "string" ? reel.author.name.trim() : "") ||
      "";

    // Prefer username handle in the reel overlay; only fall back to name if needed.
    const primary = handleText || name || "InBuzz";
    const secondary = "";

    return { primary, secondary };
  }, [cachedAuthor, currentUser, reel, reelUserId]);
  const thumbSrc = useMemo(() => {
    const raw = reel?.thumbnailUrl || reel?.thumbnail || reel?.poster || "";
    if (!raw) return "";
    const width = Number.isFinite(Number(thumbWidth)) ? Number(thumbWidth) : 720;
    return getOptimizedMediaUrl(raw, { width });
  }, [reel?.poster, reel?.thumbnail, reel?.thumbnailUrl, thumbWidth]);
  const resolvedVideoSrc = useMemo(() => {
    if (!reelId) return "";
    return streamToken ? getStreamUrl(reelId, streamToken) : getStreamUrl(reelId);
  }, [reelId, streamToken]);
  const shouldAttachVideoSrc = isActive || preload !== "none";
  const captionData = useMemo(
    () => (expanded ? { text: captionValue.trim(), truncated: false } : truncateCaption(captionValue)),
    [captionValue, expanded]
  );

  const showSoundToast = useCallback((message) => {
    if (!message) return;
    setSoundToast(message);
    setSoundToastPulse((prev) => prev + 1);
    if (soundToastTimerRef.current) {
      clearTimeout(soundToastTimerRef.current);
    }
    soundToastTimerRef.current = setTimeout(() => {
      setSoundToast("");
    }, 1100);
  }, []);

  const handleMediaDoubleTap = useCallback(() => {
    if (!isActive) return;
    setMediaLikePulse((prev) => prev + 1);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([12, 30, 10]);
    }
    if (!liked) {
      onLike?.();
    }
  }, [isActive, liked, onLike]);

  const handleMediaTap = useCallback(() => {
    if (!isActive) return;
    const now = Date.now();
    const delta = now - lastTapRef.current;
    if (delta < 320) {
      lastTapRef.current = 0;
      handleMediaDoubleTap();
      return;
    }
    lastTapRef.current = now;
    const message = muted ? "Sound On" : "Sound Off";
    onToggleMute?.();
    showSoundToast(message);
  }, [handleMediaDoubleTap, isActive, muted, onToggleMute, showSoundToast]);

  const handleMediaDoubleClick = useCallback(
    (event) => {
      if (!isActive) return;
      event.preventDefault();
      event.stopPropagation();
      lastTapRef.current = 0;
      handleMediaDoubleTap();
    },
    [handleMediaDoubleTap, isActive]
  );

  const handleVideoError = useCallback(async () => {
    if (retrying) return;
    if (!reelId) {
      setVideoError(true);
      return;
    }

    // If we already switched to token mode (or already tried once), show the retry UI.
    if (streamToken || retriedRef.current) {
      setVideoError(true);
      return;
    }

    // Can't fetch a stream token if we don't have an auth token.
    if (!authToken) {
      setVideoError(true);
      return;
    }

    retriedRef.current = true;
    setRetrying(true);
    setVideoReady(false);

    try {
      const token = await fetchInBuzzStreamToken(reelId);
      if (!token) {
        setVideoError(true);
        return;
      }
      setStreamToken(token);
      setVideoError(false);
    } catch {
      setVideoError(true);
    } finally {
      setRetrying(false);
    }
  }, [authToken, reelId, retrying, streamToken]);

  useEffect(() => {
    return () => {
      if (soundToastTimerRef.current) {
        clearTimeout(soundToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setVideoError(false);
    setRetrying(false);
    setStreamToken("");
    retriedRef.current = false;
  }, [reelId]);

  useEffect(() => {
    // Reset buffering UI when the source changes.
    setVideoReady(false);
  }, [reelId, resolvedVideoSrc]);

  return (
    <div
      ref={cardRef}
      data-index={index}
      className="relative h-[100dvh] w-full snap-start flex items-center justify-center"
    >
      <div className="relative mx-auto h-full w-full max-w-[420px] overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b0f] shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
        <div className="absolute inset-0 z-0">
          {showVideo && !videoError ? (
            <Motion.video
              ref={(node) => {
                if (typeof videoRef === "function") videoRef(node);
              }}
              src={shouldAttachVideoSrc ? resolvedVideoSrc || undefined : undefined}
              className="h-full w-full object-cover"
              muted={muted}
              playsInline
              loop
              preload={preload}
              poster={thumbSrc || undefined}
              onError={handleVideoError}
              onLoadedData={() => setVideoReady(true)}
              onCanPlay={() => setVideoReady(true)}
              onPlaying={() => setVideoReady(true)}
              onWaiting={() => setVideoReady(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            />
          ) : (
            <div className="h-full w-full bg-black/80 flex items-center justify-center">
              {thumbSrc ? (
                <img
                  src={thumbSrc}
                  alt="InBuzz thumbnail"
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="h-full w-full bg-white/5" />
              )}
              {showVideo && videoError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      retriedRef.current = false;
                      setStreamToken("");
                      setRetrying(false);
                      setVideoError(false);
                    }}
                    className="rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-[#faf0e6] hover:bg-black/70"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <AnimatePresence>
          {isActive && showVideo && !videoError && !videoReady && (
            <Motion.div
              key={`reel-buffer-${reel?.id || index}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-[9] pointer-events-none"
              aria-hidden="true"
            >
              {!thumbSrc && <div className="absolute inset-0 inbuzz-skeleton" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Motion.div
                  initial={{ opacity: 0.3, scale: 0.92 }}
                  animate={{ opacity: [0.25, 0.6, 0.25], scale: [0.92, 1.05, 0.92] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  className="h-14 w-14 rounded-full bg-black/55 ring-1 ring-white/10 flex items-center justify-center"
                >
                  <div className="ml-1 h-0 w-0 border-y-[9px] border-y-transparent border-l-[14px] border-l-white/25" />
                </Motion.div>
                {retrying && (
                  <div className="absolute bottom-14 left-1/2 -translate-x-1/2 text-[11px] text-[#faf0e6]/80">
                    Retrying…
                  </div>
                )}
              </div>
            </Motion.div>
          )}
        </AnimatePresence>

        {showVideo && !videoError && (
          <button
            type="button"
            onPointerUp={handleMediaTap}
            onDoubleClick={handleMediaDoubleClick}
            className="absolute inset-0 z-10"
            aria-label={muted ? "Tap to unmute" : "Tap to mute"}
          />
        )}

        <div className="absolute inset-0 z-10 pointer-events-none bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

        <AnimatePresence>
          {soundToast && (
            <Motion.div
              key={`sound-toast-${soundToastPulse}`}
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-[#faf0e6] shadow-md backdrop-blur"
            >
              <i
                className={`fa-solid ${
                  soundToast === "Sound On" ? "fa-volume-high" : "fa-volume-xmark"
                } mr-1`}
              ></i>
              {soundToast}
            </Motion.div>
          )}
        </AnimatePresence>

        {mediaLikePulse > 0 && (
          <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <Motion.span
              key={`media-like-glow-${mediaLikePulse}`}
              className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: [0, 0.65, 0], scale: [0.6, 1.35, 1.6] }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              style={{ boxShadow: "0 0 45px rgba(248,113,113,0.45)" }}
              aria-hidden="true"
            />
            <Motion.span
              key={`media-like-ring-${mediaLikePulse}`}
              className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rose-200/50"
              initial={{ opacity: 0.4, scale: 0.4 }}
              animate={{ opacity: [0.4, 0], scale: [0.4, 1.6] }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              aria-hidden="true"
            />
            <Motion.i
              key={`media-like-${mediaLikePulse}`}
              className="fa-solid fa-heart text-6xl sm:text-7xl text-red-300 drop-shadow-[0_0_18px_rgba(248,113,113,0.6)]"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: [0, 1, 0], scale: [0.6, 1.15, 1.3] }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              aria-hidden="true"
            />
          </div>
        )}

        <div className="absolute bottom-0 left-0 z-20 w-full p-5 flex gap-4 items-end">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={onOpenProfile}
                className="h-10 w-10 shrink-0 rounded-full overflow-hidden border border-white/15 bg-white/5 shadow-[0_10px_22px_rgba(0,0,0,0.35)]"
                aria-label="Open profile"
              >
                {avatarSrc && avatarErrorSrc !== avatarSrc ? (
                  <img
                    key={avatarSrc}
                    src={avatarSrc}
                    alt={authorLabel.primary || "Profile"}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={() => setAvatarErrorSrc(avatarSrc)}
                  />
                ) : (
                  <div className="h-full w-full grid place-items-center text-white/70">
                    <i className="fa-solid fa-user text-sm"></i>
                  </div>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm text-[#faf0e6] font-semibold">
                  <button
                    type="button"
                    onClick={onOpenProfile}
                    className="hover:text-white truncate"
                    title={authorLabel.primary}
                  >
                    {authorLabel.primary}
                  </button>
                  {authorLabel.secondary && (
                    <span className="text-[11px] text-[#b9b4c7] truncate">
                      {authorLabel.secondary}
                    </span>
                  )}
                  {isActive && muted && (
                    <span className="text-[10px] text-[#b9b4c7]">Tap for sound</span>
                  )}
                </div>

                {captionValue ? (
                  <p className="mt-1 text-sm text-[#faf0e6]">
                    {captionData.text}{" "}
                    {captionData.truncated && (
                      <button
                        type="button"
                        className="text-xs text-[#b9b4c7] hover:text-[#faf0e6]"
                        onClick={() => setExpanded(true)}
                      >
                        read more
                      </button>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-[#b9b4c7]">No caption</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <ReelActions
              reel={reel}
              liked={liked}
              onLike={onLike}
              onComment={onComment}
              onShare={onShare}
              onInfo={onInfo}
              muted={muted}
              onToggleMute={() => {
                const message = muted ? "Sound On" : "Sound Off";
                onToggleMute?.();
                showSoundToast(message);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
