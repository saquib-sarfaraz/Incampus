import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import ReelShareSheet from "./ReelShareSheet";
import ShareToChatModal from "../common/ShareToChatModal";
import { formatInBuzzCount } from "../../utils/inbuzz";
import { deleteInBuzzReel, updateInBuzzReel } from "../../services/api";
import { InBuzzGridSkeleton } from "./InBuzzSkeleton";

export default function ProfileReelGrid({
  initialReels = [],
  loading = false,
  pendingUploads = [],
}) {
  const navigate = useNavigate();
  const [reels, setReels] = useState(() => initialReels);
  const [activeMenu, setActiveMenu] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [editingReel, setEditingReel] = useState(null);
  const [shareReel, setShareReel] = useState(null);
  const [shareChatReel, setShareChatReel] = useState(null);
  const [shareChatOpen, setShareChatOpen] = useState(false);
  const [editCaption, setEditCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef(null);
  const sheetRef = useRef(null);

  const normalizedPending = useMemo(
    () => (Array.isArray(pendingUploads) ? pendingUploads : []).slice(0, 9),
    [pendingUploads]
  );
  const hasReels = reels.length > 0 || normalizedPending.length > 0;
  const activeReel = useMemo(
    () => reels.find((reel) => String(reel.id) === String(activeMenu)),
    [activeMenu, reels]
  );

  useEffect(() => {
    if (!activeMenu) return;
    const handleOutside = (event) => {
      if (menuRef.current && menuRef.current.contains(event.target)) return;
      if (sheetRef.current && sheetRef.current.contains(event.target)) return;
      setActiveMenu(null);
    };
    const handleKey = (event) => {
      if (event.key === "Escape") setActiveMenu(null);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [activeMenu]);

  useEffect(() => {
    if (initialReels && Array.isArray(initialReels)) {
      setReels(initialReels);
    } else {
      setReels([]);
    }
  }, [initialReels]);

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete;
    const snapshot = reels;
    setDeleting(true);
    setReels((prev) => prev.filter((reel) => String(reel.id) !== String(id)));
    setPendingDelete(null);
    try {
      await deleteInBuzzReel(id);
    } catch (error) {
      setReels(snapshot);
      alert(error?.message || "Failed to delete InBuzz");
    } finally {
      setDeleting(false);
    }
  };

  const handleEditSave = async () => {
    if (!editingReel) return;
    const id = editingReel;
    const nextCaption = editCaption.trim();
    const snapshot = reels;
    setSaving(true);
    setReels((prev) =>
      prev.map((reel) =>
        String(reel.id) === String(id) ? { ...reel, caption: nextCaption } : reel
      )
    );
    setEditingReel(null);
    setEditCaption("");
    try {
      await updateInBuzzReel(id, { caption: nextCaption });
    } catch (error) {
      setReels(snapshot);
      alert(error?.message || "Failed to update InBuzz");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (reel) => {
    if (!reel) return;
    setEditingReel(reel.id);
    setEditCaption(reel.caption || "");
    setActiveMenu(null);
  };

  const openDelete = (reel) => {
    if (!reel) return;
    setPendingDelete(reel.id);
    setActiveMenu(null);
  };

  const openShare = (reel) => {
    if (!reel) return;
    setShareReel(reel);
    setActiveMenu(null);
  };

  const reelGrid = useMemo(() => {
    const pendingCards = normalizedPending.map((upload, index) => {
      const uploadId = String(upload?.id || upload?.jobId || `pending-${index}`);
      const statusValue = String(upload?.status || "").toLowerCase();
      const isFailed = statusValue === "failed" || statusValue === "error";
      const isUploading = statusValue === "uploading";
      const percentRaw = isUploading ? upload?.uploadPercent : upload?.processingPercent;
      const percent = Number(percentRaw);
      const hasPercent = Number.isFinite(percent);
      const thumb = upload?.previewThumb || upload?.thumbnailUrl || upload?.thumbnail || "";
      const label = isFailed
        ? "Failed"
        : isUploading
          ? "Uploading"
          : "Processing";
      const caption = upload?.caption || upload?.stage || "";

      return (
        <div
          key={`pending-${uploadId}`}
          className={`relative group aspect-[9/16] rounded-3xl overflow-hidden p-[1px] shadow-[0_16px_35px_rgba(0,0,0,0.45)] ${
            isFailed
              ? "bg-gradient-to-b from-rose-400/35 via-white/5 to-transparent"
              : "bg-gradient-to-b from-white/15 via-white/5 to-transparent"
          }`}
        >
          <div className="absolute inset-0 rounded-[calc(1.5rem-1px)] overflow-hidden bg-black/40">
            {thumb ? (
              <img
                src={thumb}
                alt="Upload"
                className={`h-full w-full object-cover ${
                  isFailed ? "opacity-70" : "opacity-90"
                }`}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="h-full w-full bg-white/5" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

            <div className="absolute top-3 left-3 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[10px] text-[#faf0e6]">
              {label}
            </div>

            <div className="absolute bottom-3 left-3 right-3 space-y-2">
              {caption && (
                <p className="text-[11px] text-[#faf0e6] line-clamp-2">
                  {caption}
                </p>
              )}
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
                  <div className="flex items-center justify-between text-[10px] text-[#b9b4c7]">
                    <span>{isUploading ? "Uploading…" : "Processing…"}</span>
                    <span>{hasPercent ? `${Math.round(percent)}%` : ""}</span>
                  </div>
                </div>
              )}

              {isFailed && (
                <p className="text-[11px] text-rose-200">
                  {upload?.error || "Upload failed. Try again."}
                </p>
              )}
            </div>
          </div>
        </div>
      );
    });

    const reelCards = reels.map((reel, index) => (
        <div
          key={reel.id || `reel-${index}`}
          className={`relative group aspect-[9/16] rounded-3xl overflow-visible bg-gradient-to-b from-white/15 via-white/5 to-transparent p-[1px] shadow-[0_16px_35px_rgba(0,0,0,0.45)] transition-all duration-300 ${
            activeMenu === reel.id ? "ring-1 ring-white/20" : "hover:ring-1 hover:ring-white/15"
          }`}
        >
          <div className="absolute inset-0 rounded-[calc(1.5rem-1px)] overflow-hidden bg-black/40">
            <button
              type="button"
              onClick={() => navigate(`/inbuzz/${reel.id}`)}
              className="absolute inset-0"
              aria-label="Open InBuzz"
            >
              {reel.thumbnail ? (
                <img
                  src={reel.thumbnail}
                  alt="InBuzz"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="h-full w-full bg-white/5" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-11 w-11 rounded-full bg-black/60 ring-1 ring-white/20 flex items-center justify-center text-white">
                  <i className="fa-solid fa-play text-sm"></i>
                </div>
              </div>
              <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-full bg-black/60 px-2 py-1 text-[11px] text-[#faf0e6] shadow-sm">
                <i className="fa-solid fa-eye text-[10px]"></i>
                {formatInBuzzCount(reel.views)}
              </div>
            </button>
          </div>

          <div
            className="absolute top-3 right-3 z-40"
            ref={activeMenu === reel.id ? menuRef : null}
          >
            <Motion.button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setActiveMenu((prev) => (prev === reel.id ? null : reel.id));
              }}
              whileTap={{ scale: 0.92 }}
              className={`h-8 w-8 rounded-full bg-black/60 text-white/90 flex items-center justify-center ring-1 ring-white/10 transition ${
                activeMenu === reel.id
                  ? "ring-white/30 shadow-[0_0_12px_rgba(255,255,255,0.18)]"
                  : "hover:ring-white/25 hover:text-white"
              }`}
              aria-label="Reel actions"
            >
              <i className="fa-solid fa-ellipsis-vertical text-xs"></i>
            </Motion.button>
            <AnimatePresence>
              {activeMenu === reel.id && (
                <Motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="absolute right-0 mt-3 w-44 rounded-2xl glass-card border border-white/10 overflow-hidden z-50 hidden sm:block"
                  onClick={(event) => event.stopPropagation()}
                  role="menu"
                >
                  <span className="absolute -top-2 right-4 h-3 w-3 rotate-45 bg-[rgba(18,11,7,0.9)] border border-white/10 shadow-[0_6px_12px_rgba(0,0,0,0.35)]" />
                  <button
                    type="button"
                    onClick={() => openEdit(reel)}
                    className="w-full text-left px-4 py-2 text-xs text-[#faf0e6] hover:bg-white/10 flex items-center gap-2"
                    role="menuitem"
                  >
                    <i className="fa-regular fa-pen-to-square text-[11px]"></i>
                    Edit caption
                  </button>
                  <button
                    type="button"
                    onClick={() => openDelete(reel)}
                    className="w-full text-left px-4 py-2 text-xs text-rose-200 hover:bg-white/10 flex items-center gap-2"
                    role="menuitem"
                  >
                    <i className="fa-regular fa-trash-can text-[11px]"></i>
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => openShare(reel)}
                    className="w-full text-left px-4 py-2 text-xs text-[#faf0e6] hover:bg-white/10 flex items-center gap-2"
                    role="menuitem"
                  >
                    <i className="fa-solid fa-share-nodes text-[11px]"></i>
                    Share
                  </button>
                </Motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      ));

    return [...pendingCards, ...reelCards];
  }, [normalizedPending, reels, navigate, activeMenu]);

  return (
    <div className="space-y-4">
      {loading && !hasReels ? (
        <InBuzzGridSkeleton count={9} />
      ) : !hasReels ? (
        <div className="text-center p-10 rounded-3xl border border-white/10 bg-white/5 text-[#b9b4c7]">
          No InBuzz yet. Upload your first reel.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">{reelGrid}</div>
      )}

      <AnimatePresence>
        {pendingDelete && (
          <Motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-3xl glass-card p-6 text-center"
            >
              <h3 className="text-lg font-semibold text-[#faf0e6]">Delete InBuzz?</h3>
              <p className="mt-2 text-xs text-[#b9b4c7]">
                This will remove the reel from your profile.
              </p>
              <div className="mt-5 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  className="rounded-full bg-white/5 px-4 py-2 text-xs text-[#b9b4c7]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  className="rounded-full bg-rose-500/80 px-4 py-2 text-xs text-white disabled:opacity-60"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeMenu && activeReel && (
          <Motion.div
            className="fixed inset-0 z-[75] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActiveMenu(null)}
          >
            <Motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 220 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full rounded-t-3xl glass-card p-5"
              ref={sheetRef}
            >
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
              <p className="text-sm font-semibold text-[#faf0e6]">InBuzz options</p>
              <div className="mt-4 space-y-2 text-sm">
                <button
                  type="button"
                  onClick={() => openEdit(activeReel)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-[#faf0e6] hover:bg-white/10 flex items-center gap-3"
                >
                  <i className="fa-regular fa-pen-to-square"></i>
                  Edit caption
                </button>
                <button
                  type="button"
                  onClick={() => openDelete(activeReel)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-rose-200 hover:bg-white/10 flex items-center gap-3"
                >
                  <i className="fa-regular fa-trash-can"></i>
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => openShare(activeReel)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-[#faf0e6] hover:bg-white/10 flex items-center gap-3"
                >
                  <i className="fa-solid fa-share-nodes"></i>
                  Share
                </button>
              </div>
              <button
                type="button"
                onClick={() => setActiveMenu(null)}
                className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#b9b4c7] hover:text-[#faf0e6]"
              >
                Cancel
              </button>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingReel && (
          <Motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-3xl glass-card p-6"
            >
              <h3 className="text-lg font-semibold text-[#faf0e6]">Edit caption</h3>
              <textarea
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                className="mt-3 w-full rounded-2xl glass-input p-3 text-sm"
                rows="3"
              />
              <div className="mt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingReel(null)}
                  className="rounded-full bg-white/5 px-4 py-2 text-xs text-[#b9b4c7]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={saving}
                  className="rounded-full liquid-button px-4 py-2 text-xs text-[#faf0e6] disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>

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
    </div>
  );
}
