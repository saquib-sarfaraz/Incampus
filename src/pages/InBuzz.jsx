import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReelViewer from "../components/inbuzz/ReelViewer";
import ReelShareSheet from "../components/inbuzz/ReelShareSheet";
import ReelInfoSheet from "../components/inbuzz/ReelInfoSheet";
import ReportModal from "../components/moderation/ReportModal";
import ShareToChatModal from "../components/common/ShareToChatModal";
import { useAuth } from "../context/authContext";
import { useApp } from "../context/useApp";
import {
  blockUser,
  fetchInBuzzFeed,
  fetchInBuzzReel,
  deleteInBuzzReel,
  getInBuzzUploadStatus,
  reportInBuzz,
  updateInBuzzReel,
} from "../services/api";
import {
  clearExpiredPendingInBuzzUploads,
  readPendingInBuzzUploads,
  removePendingInBuzzUpload,
  subscribePendingInBuzzUploads,
  upsertPendingInBuzzUpload,
} from "../utils/inbuzzUploads";
import {
  readInBuzzFeedSnapshot,
  writeInBuzzFeedSnapshot,
} from "../utils/inbuzzCache";

const SCOPE_OPTIONS = [
  { id: "universal", label: "Universal" },
  { id: "college", label: "College Only" },
  { id: "friends", label: "Friends Only" },
];

const INBUZZ_REPORT_REASONS = [
  "Spam",
  "Harassment",
  "Hate Speech",
  "Violence",
  "Adult Content",
  "Misinformation",
  "Other",
];

export default function InBuzz() {
  const navigate = useNavigate();
  const { reelId } = useParams();
  const { currentUser } = useAuth();
  const { blockedUsers, addBlockedUser, isUserBlocked } = useApp();
  const [shareReel, setShareReel] = useState(null);
  const [shareChatReel, setShareChatReel] = useState(null);
  const [shareChatOpen, setShareChatOpen] = useState(false);
  const [infoReel, setInfoReel] = useState(null);
  const [reportReel, setReportReel] = useState(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scope, setScope] = useState("universal");
  const [reels, setReels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const [nextCursor, setNextCursor] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [pendingUploads, setPendingUploads] = useState(() => []);
  const [pendingToast, setPendingToast] = useState("");
  const scopeRef = useRef(null);
  const feedRequestRef = useRef(0);
  const loadMoreBusyRef = useRef(false);
  const lastCursorRequestedRef = useRef("");
  const loadedIdsRef = useRef(new Set());
  const reelsRef = useRef([]);
  const nextCursorRef = useRef("");
  const hasMoreRef = useRef(true);
  const pendingPollersRef = useRef(new Map());

  useEffect(() => {
    reelsRef.current = reels;
  }, [reels]);

  useEffect(() => {
    nextCursorRef.current = nextCursor || "";
  }, [nextCursor]);

  useEffect(() => {
    hasMoreRef.current = Boolean(hasMore);
  }, [hasMore]);

  const currentUserId = useMemo(
    () => currentUser?.id || currentUser?._id || "",
    [currentUser?._id, currentUser?.id]
  );

  const visiblePendingUploads = useMemo(() => {
    if (!pendingUploads.length) return [];
    const list = pendingUploads.filter((item) => {
      const owner = item?.userId || item?.user_id || "";
      if (!currentUserId) return true;
      if (!owner) return true;
      return String(owner) === String(currentUserId);
    });
    return list.slice(0, 2);
  }, [pendingUploads, currentUserId]);

  const infoReelOwnerId = useMemo(() => {
    if (!infoReel) return "";
    return (
      infoReel.userId ||
      infoReel.user_id ||
      infoReel.authorId ||
      infoReel.author_id ||
      infoReel.author?.id ||
      ""
    );
  }, [infoReel]);

  const isInfoOwner = useMemo(() => {
    if (!currentUserId || !infoReelOwnerId) return false;
    return String(currentUserId) === String(infoReelOwnerId);
  }, [currentUserId, infoReelOwnerId]);

  const filteredReels = useMemo(() => {
    if (!reels.length) return [];
    if (!blockedUsers || blockedUsers.length === 0) return reels;
    const blockedSet = new Set(blockedUsers.map((id) => String(id)));
    return reels.filter((reel) => {
      const reelUserId = reel?.userId || reel?.user_id || reel?.authorId;
      if (!reelUserId) return true;
      return !blockedSet.has(String(reelUserId));
    });
  }, [blockedUsers, reels]);

  useEffect(() => {
    if (typeof window === "undefined") return () => {};
    clearExpiredPendingInBuzzUploads();
    setPendingUploads(readPendingInBuzzUploads());
    return subscribePendingInBuzzUploads(() => {
      setPendingUploads(readPendingInBuzzUploads());
    });
  }, []);

  useEffect(() => {
    const pollableIds = new Set();
    pendingUploads.forEach((upload) => {
      const uploadId = String(upload?.id || "");
      const jobId = String(upload?.jobId || "");
      const status = String(upload?.status || "").toLowerCase();
      if (!uploadId || !jobId) return;
      if (status === "published" || status === "completed" || status === "done") return;
      if (status === "failed" || status === "error") return;
      pollableIds.add(uploadId);
    });

    for (const [uploadId, controller] of pendingPollersRef.current.entries()) {
      if (!pollableIds.has(uploadId)) {
        controller.cancelled = true;
        pendingPollersRef.current.delete(uploadId);
      }
    }

    if (!pollableIds.size) return;

    pendingUploads.forEach((upload) => {
      const uploadId = String(upload?.id || "");
      const jobId = String(upload?.jobId || "");
      if (!uploadId || !jobId) return;
      if (!pollableIds.has(uploadId)) return;

      if (pendingPollersRef.current.has(uploadId)) return;
      const controller = { cancelled: false };
      pendingPollersRef.current.set(uploadId, controller);

      const poll = async () => {
        const startedAt = Date.now();
        for (;;) {
          if (controller.cancelled) return;
          try {
            const statusRes = await getInBuzzUploadStatus(jobId);
            const statusValue =
              statusRes?.status ||
              statusRes?.state ||
              statusRes?.data?.status ||
              statusRes?.data?.state ||
              "";
            const lowered = String(statusValue).toLowerCase();
            const progressValue =
              statusRes?.progress ??
              statusRes?.percentage ??
              statusRes?.percent ??
              statusRes?.data?.progress ??
              statusRes?.data?.percentage ??
              statusRes?.data?.percent ??
              null;
            const progress = Number(progressValue);
            const hasProgress = Number.isFinite(progress);
            const reelFromStatus =
              statusRes?.reel ||
              statusRes?.reelData ||
              statusRes?.data?.reel ||
              statusRes?.data?.reelData ||
              null;
            const reelIdFromStatus =
              statusRes?.reelId ||
              statusRes?.reel_id ||
              statusRes?.data?.reelId ||
              statusRes?.data?.reel_id ||
              reelFromStatus?._id ||
              reelFromStatus?.id ||
              "";

            if (lowered === "completed" || lowered === "complete" || lowered === "done") {
              upsertPendingInBuzzUpload({
                id: uploadId,
                status: "published",
                processingPercent: 100,
                reelId: reelIdFromStatus ? String(reelIdFromStatus) : "",
                completedAt: new Date().toISOString(),
              });
              setPendingToast("Your InBuzz is live.");
              setFeedRefreshKey((prev) => prev + 1);
              setTimeout(() => {
                removePendingInBuzzUpload(uploadId);
              }, 2500);
              return;
            }

            if (lowered === "failed" || lowered === "error") {
              upsertPendingInBuzzUpload({
                id: uploadId,
                status: "failed",
                error: statusRes?.message || statusRes?.error || "Upload failed.",
              });
              return;
            }

            upsertPendingInBuzzUpload({
              id: uploadId,
              status: "processing",
              processingPercent: hasProgress ? Math.max(0, Math.min(100, progress)) : undefined,
              stage:
                statusRes?.stage ||
                statusRes?.step ||
                statusRes?.data?.stage ||
                statusRes?.data?.step ||
                "Processing video…",
            });

            if (Date.now() - startedAt > 10 * 60 * 1000) {
              upsertPendingInBuzzUpload({
                id: uploadId,
                status: "processing",
                stage: "Still processing… It will appear soon.",
              });
              return;
            }
          } catch {
            // keep polling; network may briefly fail.
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      };

      void poll().finally(() => {
        pendingPollersRef.current.delete(uploadId);
      });
    });
  }, [pendingUploads]);

  useEffect(() => {
    return () => {
      pendingPollersRef.current.forEach((controller) => {
        controller.cancelled = true;
      });
      pendingPollersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!pendingToast) return;
    const id = setTimeout(() => setPendingToast(""), 2500);
    return () => clearTimeout(id);
  }, [pendingToast]);

  useEffect(() => {
    let isMounted = true;
    const requestId = ++feedRequestRef.current;
    const cached = readInBuzzFeedSnapshot({ userId: currentUserId, scope });
    const cachedItems = Array.isArray(cached?.items) ? cached.items : [];
    const hadCached = cachedItems.length > 0;
    if (cachedItems.length) {
      setReels(cachedItems);
      loadedIdsRef.current = new Set(
        cachedItems
          .map((item) => String(item?.id || item?._id || ""))
          .filter(Boolean)
      );
      setNextCursor(cached?.nextCursor || "");
      setHasMore(typeof cached?.hasMore === "boolean" ? cached.hasMore : true);
      setLoading(false);
    } else {
      setReels([]);
      loadedIdsRef.current = new Set();
      setNextCursor("");
      setHasMore(true);
      setLoading(true);
    }
    setLoadingMore(false);
    setLoadError("");
    loadMoreBusyRef.current = false;
    lastCursorRequestedRef.current = "";
    fetchInBuzzFeed({ scope, limit: 12 })
      .then((response) => {
        const list = Array.isArray(response?.items) ? response.items : [];
        if (isMounted && requestId === feedRequestRef.current) {
          setReels(list);
          loadedIdsRef.current = new Set(
            list
              .map((item) => String(item?.id || item?._id || ""))
              .filter(Boolean)
          );
          const cursor = response?.nextCursor || "";
          setNextCursor(cursor);
          const hasMoreValue =
            typeof response?.hasMore === "boolean" ? response.hasMore : true;
          setHasMore(hasMoreValue);
          writeInBuzzFeedSnapshot({
            userId: currentUserId,
            scope,
            items: list,
            nextCursor: cursor,
            hasMore: hasMoreValue,
          });
        }
      })
      .catch((error) => {
        if (isMounted && requestId === feedRequestRef.current) {
          setLoadError(error?.message || "Unable to load InBuzz feed.");
          if (!hadCached) {
            setReels([]);
            setNextCursor("");
            setHasMore(false);
          }
        }
      })
      .finally(() => {
        if (isMounted && requestId === feedRequestRef.current) {
          setLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [scope, feedRefreshKey, currentUserId]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    if (hasMoreRef.current === false) return;
    if (loadMoreBusyRef.current) return;

    const current = reelsRef.current || [];
    const last = current.length ? current[current.length - 1] : null;
    const lastId = last?.id || last?._id || "";
    const cursor = nextCursorRef.current || (lastId ? String(lastId) : "");
    if (!cursor) return;
    if (cursor && cursor === lastCursorRequestedRef.current) return;

    loadMoreBusyRef.current = true;
    lastCursorRequestedRef.current = cursor;
    setLoadingMore(true);
    try {
      const response = await fetchInBuzzFeed({ scope, cursor, limit: 12 });
      const list = Array.isArray(response?.items) ? response.items : [];
      const fresh = [];
      list.forEach((item) => {
        const id = String(item?.id || item?._id || "");
        if (!id) return;
        if (loadedIdsRef.current.has(id)) return;
        loadedIdsRef.current.add(id);
        fresh.push(item);
      });

      const combined = fresh.length ? [...current, ...fresh] : current;
      if (fresh.length) setReels(combined);

      const cursorNext = response?.nextCursor || "";
      setNextCursor(cursorNext);
      let hasMoreValue = hasMoreRef.current;
      if (typeof response?.hasMore === "boolean") {
        hasMoreValue = response.hasMore;
        setHasMore(hasMoreValue);
      } else if (!cursorNext && fresh.length === 0) {
        hasMoreValue = false;
        setHasMore(false);
      }
      writeInBuzzFeedSnapshot({
        userId: currentUserId,
        scope,
        items: combined,
        nextCursor: cursorNext,
        hasMore: typeof hasMoreValue === "boolean" ? hasMoreValue : undefined,
      });
    } catch {
      // keep existing list; we can try again on next swipe
    } finally {
      loadMoreBusyRef.current = false;
      setLoadingMore(false);
    }
  }, [loading, loadingMore, scope, currentUserId]);

  const handleActiveIndexChange = useCallback(
    (index) => {
      if (loading || loadingMore) return;
      const length = filteredReels.length;
      if (!length) return;
      if (index >= length - 3) {
        loadMore();
      }
    },
    [filteredReels.length, loadMore, loading, loadingMore]
  );

  useEffect(() => {
    if (!reelId) return;
    if (filteredReels.some((reel) => String(reel.id) === String(reelId))) return;
    let isMounted = true;
    fetchInBuzzReel(reelId)
      .then((reel) => {
        if (!isMounted || !reel) return;
        if (isUserBlocked?.(reel.userId || reel.user_id || reel.authorId)) return;
        const id = reel?.id || reel?._id || "";
        if (id) loadedIdsRef.current.add(String(id));
        setReels((prev) => {
          if (!id) return [reel, ...prev];
          const exists = prev.some((item) => String(item?.id || item?._id) === String(id));
          return exists ? prev : [reel, ...prev];
        });
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [filteredReels, isUserBlocked, reelId]);
  const initialIndex = useMemo(() => {
    if (!reelId) return 0;
    const index = filteredReels.findIndex((reel) => String(reel.id) === String(reelId));
    return index >= 0 ? index : 0;
  }, [reelId, filteredReels]);

  useEffect(() => {
    if (!scopeOpen) return;
    const handleClick = (event) => {
      if (scopeRef.current && !scopeRef.current.contains(event.target)) {
        setScopeOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [scopeOpen]);

  return (
    <div className="min-h-[100dvh] bg-[#0b0b0f] text-[#faf0e6]">
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-black/40 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 flex items-center justify-center"
            aria-label="Back"
          >
            <i className="fa-solid fa-arrow-left"></i>
          </button>
          <div ref={scopeRef} className="relative">
            <button
              type="button"
              onClick={() => setScopeOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold"
            >
              {SCOPE_OPTIONS.find((item) => item.id === scope)?.label || "Universal"}
              <i className="fa-solid fa-chevron-down text-xs"></i>
            </button>
            {scopeOpen && (
              <div className="absolute left-0 mt-2 w-44 rounded-2xl border border-white/10 bg-[#0b0b0f]/95 backdrop-blur-md shadow-lg overflow-hidden z-40">
                {SCOPE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setScope(option.id);
                      setScopeOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                      scope === option.id
                        ? "bg-white/10 text-[#faf0e6]"
                        : "text-[#b9b4c7] hover:bg-white/5 hover:text-[#faf0e6]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/create/inbuzz")}
          className="rounded-full px-4 py-2 text-xs font-semibold liquid-button"
        >
          + Upload InBuzz
        </button>
      </div>

      {visiblePendingUploads.length > 0 && (
        <div className="fixed top-16 left-1/2 z-40 w-[min(92vw,420px)] -translate-x-1/2 space-y-2 px-2">
          {visiblePendingUploads.map((upload) => {
            const uploadId = String(upload?.id || upload?.jobId || "");
            const stageRaw = String(upload?.stage || "");
            const statusValue = String(upload?.status || "").toLowerCase();
            const isFailed = statusValue === "failed" || statusValue === "error";
            const isUploading = statusValue === "uploading";
            const percentRaw = isUploading ? upload?.uploadPercent : upload?.processingPercent;
            const percent = Number(percentRaw);
            const hasPercent = Number.isFinite(percent);
            const title = isFailed
              ? "Upload failed"
              : isUploading
                ? "Uploading InBuzz"
                : "Processing InBuzz";
            const subtitle =
              upload?.caption ||
              stageRaw ||
              (isFailed ? upload?.error || "Please try again." : "Please wait…");
            const thumb = upload?.previewThumb || upload?.thumbnailUrl || upload?.thumbnail || "";
            return (
              <div
                key={uploadId}
                className={`rounded-3xl border backdrop-blur-md px-3 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.55)] ${
                  isFailed
                    ? "border-rose-400/30 bg-rose-900/25"
                    : "border-white/10 bg-black/60"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="h-16 w-12 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt="Upload preview"
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-b from-white/10 via-white/5 to-transparent" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#faf0e6]">
                          {title}
                        </p>
                        <p className="text-[11px] text-[#b9b4c7] line-clamp-2">
                          {subtitle}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePendingInBuzzUpload(uploadId)}
                        className="h-8 w-8 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] hover:bg-white/10 flex items-center justify-center"
                        title="Dismiss"
                        aria-label="Dismiss upload"
                      >
                        <i className="fa-solid fa-xmark text-xs"></i>
                      </button>
                    </div>

                    {!isFailed && (
                      <div className="space-y-1">
                        <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-300/80 transition-all duration-300"
                            style={{
                              width: `${hasPercent ? Math.max(0, Math.min(100, percent)) : 35}%`,
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-[#b9b4c7]">
                          <span>
                            {isUploading ? "Uploading…" : "Processing…"}
                          </span>
                          <span>{hasPercent ? `${Math.round(percent)}%` : ""}</span>
                        </div>
                      </div>
                    )}

                    {isFailed && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => navigate("/create/inbuzz")}
                          className="flex-1 rounded-full liquid-button px-4 py-2 text-xs font-semibold text-[#faf0e6]"
                        >
                          Try again
                        </button>
                        <button
                          type="button"
                          onClick={() => removePendingInBuzzUpload(uploadId)}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#faf0e6] hover:bg-white/10"
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pendingToast && (
        <div className="fixed top-[4.75rem] left-1/2 z-40 -translate-x-1/2 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[11px] text-[#faf0e6] backdrop-blur">
          {pendingToast}
        </div>
      )}

      <ReelViewer
        reels={filteredReels}
        loading={loading}
        initialIndex={initialIndex}
        onActiveIndexChange={handleActiveIndexChange}
        onShare={(reel) => setShareReel(reel)}
        onInfo={(reel) => setInfoReel(reel)}
        onOpenProfile={(reel) => {
          const profileId =
            reel?.userId ||
            reel?.user_id ||
            reel?.author?.id ||
            reel?.authorId ||
            reel?.author_id ||
            reel?.username;
          if (profileId) navigate(`/profile/${profileId}`);
        }}
      />

      {loadingMore && (
        <div className="fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-[11px] text-[#faf0e6] backdrop-blur">
          Loading more reels…
        </div>
      )}

      {!filteredReels.length && !loading && loadError && (
        <div className="fixed inset-x-0 top-20 z-20 flex justify-center px-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-rose-200">
            {loadError}
          </div>
        </div>
      )}

      <ReelShareSheet
        isOpen={!!shareReel}
        reel={shareReel}
        onClose={() => setShareReel(null)}
        onShareToChat={() => {
          setShareChatReel(shareReel);
          setShareReel(null);
          setShareChatOpen(true);
        }}
      />
      <ShareToChatModal
        isOpen={shareChatOpen}
        onClose={() => {
          setShareChatOpen(false);
          setShareChatReel(null);
        }}
        reelId={shareChatReel?.id || shareChatReel?._id}
        reelUrl={
          shareChatReel?.shareUrl
            ? String(shareChatReel.shareUrl).startsWith("http")
              ? shareChatReel.shareUrl
              : typeof window !== "undefined"
                ? `${window.location.origin}${shareChatReel.shareUrl}`
                : shareChatReel.shareUrl
            : shareChatReel?.id
              ? typeof window !== "undefined"
                ? `${window.location.origin}/inbuzz/${shareChatReel.id}`
                : `/inbuzz/${shareChatReel.id}`
              : ""
        }
        reelThumbnail={
          shareChatReel?.thumbnailUrl ||
          shareChatReel?.thumbnail ||
          shareChatReel?.poster ||
          ""
        }
        reelCaption={shareChatReel?.caption || ""}
        reelAuthorName={
          shareChatReel?.displayName ||
          shareChatReel?.author?.fullName ||
          shareChatReel?.author?.name ||
          shareChatReel?.username ||
          "InBuzz"
        }
        reelAuthorId={
          shareChatReel?.userId ||
          shareChatReel?.user_id ||
          shareChatReel?.authorId ||
          shareChatReel?.author_id ||
          shareChatReel?.author?.id ||
          ""
        }
      />
      <ReelInfoSheet
        isOpen={!!infoReel}
        reel={infoReel}
        onClose={() => setInfoReel(null)}
        isOwner={isInfoOwner}
        onEdit={async (nextCaption) => {
          const id = infoReel?.id || infoReel?._id;
          if (!id) return;
          const snapshot = reels;
          setReels((prev) =>
            prev.map((item) =>
              String(item.id || item._id) === String(id)
                ? { ...item, caption: nextCaption }
                : item
            )
          );
          try {
            await updateInBuzzReel(id, { caption: nextCaption });
          } catch (error) {
            setReels(snapshot);
            throw error;
          }
        }}
        onDelete={async () => {
          const id = infoReel?.id || infoReel?._id;
          if (!id) return;
          const snapshot = reels;
          setReels((prev) =>
            prev.filter((item) => String(item.id || item._id) !== String(id))
          );
          try {
            await deleteInBuzzReel(id);
          } catch (error) {
            setReels(snapshot);
            throw error;
          }
        }}
        onReport={() => {
          setReportReel(infoReel);
          setInfoReel(null);
        }}
        onBlock={async () => {
          const targetId =
            infoReel?.userId || infoReel?.user_id || infoReel?.authorId || infoReel?.author;
          if (!targetId) return;
          if (!currentUser) {
            alert("Please sign in to block.");
            return;
          }
          if (!confirm("Block this user? You will no longer see their content.")) return;
          try {
            await blockUser(targetId, { context: "inbuzz_viewer" });
            addBlockedUser?.(targetId);
            setInfoReel(null);
            alert("User blocked.");
          } catch (error) {
            alert(error.message || "Failed to block user");
          }
        }}
      />
      <ReportModal
        isOpen={!!reportReel}
        onClose={() => setReportReel(null)}
        title="Report InBuzz"
        reasons={INBUZZ_REPORT_REASONS}
        onSubmit={async ({ reason, details }) => {
          if (!currentUser) {
            alert("Please sign in to report.");
            return;
          }
          const reel = reportReel;
          if (!reel) return;
          const reelIdValue = reel.id || reel._id;
          const reportedUserId =
            reel.userId || reel.user_id || reel.authorId || reel.author;
          if (!reelIdValue) return;
          try {
            await reportInBuzz(reelIdValue, {
              reason,
              details,
              description: details,
              reportedUserId,
              reported_user_id: reportedUserId,
              context: "inbuzz_viewer",
            });
            alert("Thanks for helping keep InCampus safe.");
            setReportReel(null);
          } catch (error) {
            alert(error.message || "Failed to report reel");
            throw error;
          }
        }}
      />
    </div>
  );
}
