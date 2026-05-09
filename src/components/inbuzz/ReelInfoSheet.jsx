import { useEffect, useMemo, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { getInBuzzShareUrl } from "../../utils/inbuzz";

export default function ReelInfoSheet({
  isOpen,
  onClose,
  reel,
  onReport,
  onBlock,
  isOwner = false,
  onEdit,
  onDelete,
}) {
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState("menu");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sharePath = reel?.id ? getInBuzzShareUrl(reel.id) : "";
  const shareUrl = useMemo(() => {
    if (!sharePath) return "";
    if (/^https?:\/\//i.test(sharePath)) return sharePath;
    if (typeof window === "undefined") return sharePath;
    return `${window.location.origin}${sharePath}`;
  }, [sharePath]);
  const rawCaption = typeof reel?.caption === "string" ? reel.caption.trim() : "";
  const captionPreview =
    rawCaption.length > 42 ? `${rawCaption.slice(0, 42)}…` : rawCaption;

  const reelId = useMemo(() => reel?.id || reel?._id || "", [reel?._id, reel?.id]);

  useEffect(() => {
    if (!isOpen) return;
    setCopied(false);
    setMode("menu");
    setCaption(typeof reel?.caption === "string" ? reel.caption : "");
    setBusy(false);
    setError("");
  }, [isOpen, reelId, reel?.caption]);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleStartEdit = () => {
    if (!isOwner) return;
    setMode("edit");
    setCaption(typeof reel?.caption === "string" ? reel.caption : "");
    setError("");
  };

  const handleSaveEdit = async () => {
    if (!isOwner || !onEdit || !reelId) return;
    setBusy(true);
    setError("");
    try {
      await onEdit(caption.trim());
      onClose?.();
    } catch (err) {
      setError(err?.message || "Failed to update InBuzz.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!isOwner || !onDelete || !reelId) return;
    if (!confirm("Delete this InBuzz? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await onDelete();
      onClose?.();
    } catch (err) {
      setError(err?.message || "Failed to delete InBuzz.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <Motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 220 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl glass-card p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#faf0e6]">InBuzz Options</p>
                <p className="text-[11px] text-[#b9b4c7]">
                  {captionPreview || "Manage this InBuzz"}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-full text-[#b9b4c7] hover:text-[#faf0e6] hover:bg-white/10"
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              {isOwner && mode === "menu" && (
                <>
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-[#faf0e6] hover:bg-white/10 flex items-center gap-3"
                    disabled={busy}
                  >
                    <i className="fa-regular fa-pen-to-square"></i>
                    Edit Reel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-rose-200 hover:bg-white/10 flex items-center gap-3"
                    disabled={busy}
                  >
                    <i className="fa-regular fa-trash-can"></i>
                    Delete Reel
                  </button>
                </>
              )}

              {isOwner && mode === "edit" && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">
                    Edit caption
                  </p>
                  <textarea
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    rows={4}
                    className="w-full rounded-2xl glass-input p-3 text-sm resize-none"
                    placeholder="Write a caption..."
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("menu");
                        setError("");
                      }}
                      className="rounded-full bg-white/5 px-4 py-2 text-xs text-[#b9b4c7]"
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      className="flex-1 rounded-full liquid-button px-4 py-2 text-xs font-semibold text-[#faf0e6]"
                      disabled={busy}
                    >
                      {busy ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={onReport}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-amber-200 hover:bg-white/10 flex items-center gap-3"
                disabled={busy}
              >
                <i className="fa-solid fa-flag"></i>
                Report Buzz
              </button>
              <button
                type="button"
                onClick={onBlock}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-rose-200 hover:bg-white/10 flex items-center gap-3"
                disabled={busy}
              >
                <i className="fa-solid fa-ban"></i>
                Block User
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-[#faf0e6] hover:bg-white/10 flex items-center gap-3"
                disabled={busy}
              >
                <i className="fa-regular fa-copy"></i>
                {copied ? "Link copied" : "Copy Link"}
              </button>
            </div>

            {error && <p className="mt-3 text-xs text-rose-200">{error}</p>}

            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#b9b4c7] hover:text-[#faf0e6]"
              disabled={busy}
            >
              {mode === "edit" ? "Close" : "Cancel"}
            </button>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
