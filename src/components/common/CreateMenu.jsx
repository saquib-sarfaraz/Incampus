import { motion as Motion, AnimatePresence } from "framer-motion";

export default function CreateMenu({
  isOpen,
  onClose,
  onCreatePost,
  onCreateStory,
  onCreateInBuzz,
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <Motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 200 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl glass-card p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#faf0e6]">+ Create</p>
                <p className="text-[11px] text-[#b9b4c7]">Pick a format</p>
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
                onClick={onCreatePost}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[#faf0e6] hover:bg-white/10"
              >
                <i className="fa-solid fa-pen-to-square text-lg"></i>
                <p className="mt-2">Post</p>
              </button>
              <button
                type="button"
                onClick={onCreateStory}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[#faf0e6] hover:bg-white/10"
              >
                <i className="fa-solid fa-circle-plus text-lg"></i>
                <p className="mt-2">Story</p>
              </button>
              <button
                type="button"
                onClick={onCreateInBuzz}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[#faf0e6] hover:bg-white/10"
              >
                <i className="fa-solid fa-circle-play text-lg"></i>
                <p className="mt-2">InBuzz</p>
              </button>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
