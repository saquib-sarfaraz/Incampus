import { useMemo, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { getInBuzzShareUrl } from "../../utils/inbuzz";

export default function ReelShareSheet({ isOpen, onClose, reel, onShareToChat }) {
  const [copied, setCopied] = useState(false);
  const sharePath = reel?.id ? getInBuzzShareUrl(reel.id) : "";
  const shareUrl = useMemo(() => {
    if (!sharePath) return "";
    if (/^https?:\/\//i.test(sharePath)) return sharePath;
    if (typeof window === "undefined") return sharePath;
    return `${window.location.origin}${sharePath}`;
  }, [sharePath]);

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

  const handleExternalShare = async () => {
    if (!shareUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "InBuzz",
          text: reel?.caption || "Check this InBuzz",
          url: shareUrl,
        });
      } catch {
        // user cancelled
      }
      return;
    }
    handleCopy();
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
                <p className="text-sm font-semibold text-[#faf0e6]">Share InBuzz</p>
                <p className="text-[11px] text-[#b9b4c7]">
                  {reel?.caption ? reel.caption.slice(0, 42) : "Share this reel"}
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

            <div className="mt-5 grid grid-cols-3 gap-3 text-center text-xs">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[#faf0e6] hover:bg-white/10"
              >
                <i className="fa-regular fa-copy text-lg"></i>
                <p className="mt-2">{copied ? "Copied" : "Copy link"}</p>
              </button>
              <button
                type="button"
                onClick={() => onShareToChat?.(shareUrl)}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[#faf0e6] hover:bg-white/10"
              >
                <i className="fa-solid fa-message text-lg"></i>
                <p className="mt-2">Share to chat</p>
              </button>
              <button
                type="button"
                onClick={handleExternalShare}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[#faf0e6] hover:bg-white/10"
              >
                <i className="fa-solid fa-share-nodes text-lg"></i>
                <p className="mt-2">External</p>
              </button>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
