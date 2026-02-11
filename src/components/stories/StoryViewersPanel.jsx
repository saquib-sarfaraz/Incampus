import { motion as Motion, AnimatePresence } from "framer-motion";

const formatViewTime = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function StoryViewersPanel({ isOpen, onClose, views, loading }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={onClose}
        >
          <Motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 220 }}
            className="w-full max-w-md glass-card rounded-t-3xl p-5 sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-semibold text-[#faf0e6]">Story Views</h3>
              <button
                type="button"
                onClick={onClose}
                className="text-xl text-[#b9b4c7] hover:text-[#faf0e6]"
              >
                &times;
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto pt-4 space-y-3">
              {loading ? (
                <p className="text-center text-sm text-[#b9b4c7]">Loading viewers...</p>
              ) : views.length === 0 ? (
                <p className="text-center text-sm text-[#b9b4c7]">No views yet</p>
              ) : (
                views.map((view) => (
                  <div
                    key={view.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <img
                      src={view.viewerAvatar}
                      alt={view.viewerName}
                      className="h-9 w-9 rounded-full object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold text-[#faf0e6]">
                        {view.viewerName}
                      </p>
                      <p className="text-[11px] text-[#b9b4c7]">
                        {formatViewTime(view.viewedAt)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
