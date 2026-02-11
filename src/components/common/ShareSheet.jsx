import { motion as Motion, AnimatePresence } from "framer-motion";

export default function ShareSheet({ isOpen, onClose, postUrl, postTitle, onShareToChat }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(postUrl);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
    onClose?.();
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: postTitle || "InCampus Post", url: postUrl });
      } catch (error) {
        console.error("Share canceled:", error);
      }
      onClose?.();
    } else {
      handleCopy();
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
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-[#faf0e6] hover:bg-white/10"
              >
                <i className="fa-regular fa-copy mr-2"></i>
                Copy Link
              </button>
              <button
                type="button"
                onClick={onShareToChat}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-[#faf0e6] hover:bg-white/10"
              >
                <i className="fa-solid fa-paper-plane mr-2"></i>
                Share to Chat
              </button>
              <button
                type="button"
                onClick={handleNativeShare}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-[#faf0e6] hover:bg-white/10"
              >
                <i className="fa-solid fa-share-nodes mr-2"></i>
                Share to Apps
              </button>
              <button
                type="button"
                disabled
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-[#b9b4c7] opacity-60"
              >
                <i className="fa-solid fa-repeat mr-2"></i>
                Repost (Soon)
              </button>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
