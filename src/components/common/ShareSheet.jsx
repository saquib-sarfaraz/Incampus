import { useEffect, useMemo, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";

export default function ShareSheet({
  isOpen,
  onClose,
  postUrl,
  postTitle,
  postId,
  postThumbnail,
  postPreviewText,
  isPrivate = false,
  isAnonymous = false,
  onShareToChat,
}) {
  const [toast, setToast] = useState("");

  const shareUrl = useMemo(() => {
    if (postUrl) return postUrl;
    if (postId) return `${window.location.origin}/feed?post=${postId}`;
    return window.location.origin;
  }, [postUrl, postId]);

  const shareTitle = useMemo(() => {
    if (postTitle) return postTitle;
    if (postPreviewText) return postPreviewText;
    return "InCampus Post";
  }, [postTitle, postPreviewText]);

  const shareText = useMemo(() => {
    if (isAnonymous) return "Anonymous campus post";
    return shareTitle || "InCampus post";
  }, [isAnonymous, shareTitle]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 1400);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleCopy = async () => {
    if (isPrivate) {
      setToast("Private posts can't be shared outside.");
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast("Link copied");
    } catch (error) {
      console.error("Failed to copy:", error);
      setToast("Copy failed");
    }
  };

  const handleNativeShare = async () => {
    if (!navigator.share) return false;
    try {
      await navigator.share({
        title: shareTitle || "InCampus Post",
        text: shareText,
        url: shareUrl,
      });
      return true;
    } catch (error) {
      console.error("Share canceled:", error);
      return false;
    }
  };

  const handleExternalShare = async (target) => {
    if (isPrivate) {
      setToast("Private posts can't be shared outside.");
      return;
    }
    const encodedUrl = encodeURIComponent(shareUrl);
    const encodedText = encodeURIComponent(`${shareText} ${shareUrl}`);

    if (target === "system") {
      const shared = await handleNativeShare();
      if (!shared) {
        handleCopy();
      }
      return;
    }

    if (target === "whatsapp") {
      window.open(`https://wa.me/?text=${encodedText}`, "_blank", "noopener");
      return;
    }

    if (target === "snapchat") {
      const shared = await handleNativeShare();
      if (!shared) {
        window.open(
          `https://www.snapchat.com/scan?attachmentUrl=${encodedUrl}`,
          "_blank",
          "noopener"
        );
      }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          onClick={onClose}
        >
          <Motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 220 }}
            className="w-full max-w-md rounded-3xl glass-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#faf0e6]">Share Post</h3>
              <button
                onClick={onClose}
                className="text-[#b9b4c7] hover:text-[#faf0e6] text-xl"
              >
                &times;
              </button>
            </div>

            {(postThumbnail || postPreviewText || postTitle) && (
              <div className="flex items-center gap-3 mb-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                {postThumbnail ? (
                  <img
                    src={postThumbnail}
                    alt="Post preview"
                    className="h-14 w-14 rounded-xl object-cover"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-xl bg-white/5 flex items-center justify-center text-[10px] text-[#b9b4c7]">
                    Post
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#faf0e6]">Post Preview</p>
                  <p className="text-[11px] text-[#b9b4c7] line-clamp-2">
                    {postPreviewText || postTitle || "Campus update"}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                  Share in InCampus
                </p>
                <button
                  type="button"
                  onClick={onShareToChat}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-[#faf0e6] hover:bg-white/10"
                >
                  <i className="fa-solid fa-paper-plane mr-2"></i>
                  Send to Chat
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                  Share Outside InCampus
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => handleExternalShare("whatsapp")}
                    disabled={isPrivate}
                    className={`rounded-2xl border border-white/10 px-3 py-3 text-[11px] ${
                      isPrivate
                        ? "bg-white/5 text-[#b9b4c7] opacity-60 cursor-not-allowed"
                        : "bg-white/5 text-[#faf0e6] hover:bg-white/10"
                    }`}
                  >
                    <i className="fa-brands fa-whatsapp mr-1"></i>
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExternalShare("snapchat")}
                    disabled={isPrivate}
                    className={`rounded-2xl border border-white/10 px-3 py-3 text-[11px] ${
                      isPrivate
                        ? "bg-white/5 text-[#b9b4c7] opacity-60 cursor-not-allowed"
                        : "bg-white/5 text-[#faf0e6] hover:bg-white/10"
                    }`}
                  >
                    <i className="fa-brands fa-snapchat mr-1"></i>
                    Snapchat
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExternalShare("system")}
                    disabled={isPrivate}
                    className={`rounded-2xl border border-white/10 px-3 py-3 text-[11px] ${
                      isPrivate
                        ? "bg-white/5 text-[#b9b4c7] opacity-60 cursor-not-allowed"
                        : "bg-white/5 text-[#faf0e6] hover:bg-white/10"
                    }`}
                  >
                    <i className="fa-solid fa-share-nodes mr-1"></i>
                    More
                  </button>
                </div>
                {isPrivate && (
                  <p className="text-[11px] text-rose-200">
                    Private posts can’t be shared outside.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                  Copy Link
                </p>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={isPrivate}
                  className={`w-full rounded-2xl border border-white/10 px-4 py-3 text-xs ${
                    isPrivate
                      ? "bg-white/5 text-[#b9b4c7] opacity-60 cursor-not-allowed"
                      : "bg-white/5 text-[#faf0e6] hover:bg-white/10"
                  }`}
                >
                  <i className="fa-regular fa-copy mr-2"></i>
                  Copy Link
                </button>
              </div>
            </div>

            {toast && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-center text-xs text-[#faf0e6]">
                {toast}
              </div>
            )}
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
