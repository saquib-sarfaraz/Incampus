import { motion as Motion } from "framer-motion";

const ReelThumbSkeleton = ({ className = "", delay = 0 }) => (
  <Motion.div
    aria-hidden="true"
    initial={{ opacity: 0, y: 10, scale: 0.985 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.35, delay }}
    className={`relative aspect-[9/16] rounded-2xl overflow-hidden border border-white/10 bg-white/5 ${className}`}
  >
    <div className="absolute inset-0 inbuzz-skeleton" />
    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="h-11 w-11 rounded-full bg-black/55 ring-1 ring-white/10 flex items-center justify-center">
        <div className="ml-0.5 h-0 w-0 border-y-[7px] border-y-transparent border-l-[11px] border-l-white/25" />
      </div>
    </div>
    <div className="absolute bottom-2 left-2 flex items-center gap-2">
      <div className="h-2.5 w-2.5 rounded-full bg-rose-200/20" />
      <div className="h-2 w-10 rounded-full inbuzz-skeleton opacity-80" />
    </div>
  </Motion.div>
);

export const InBuzzStripSkeleton = ({ count = 8, itemClassName = "" }) => (
  <div className="flex gap-3 overflow-x-auto pb-1">
    {Array.from({ length: count }).map((_, idx) => (
      <div key={`inbuzz-strip-skeleton-${idx}`} className="min-w-[140px] max-w-[140px]">
        <ReelThumbSkeleton className={itemClassName} delay={idx * 0.03} />
      </div>
    ))}
  </div>
);

export const InBuzzGridSkeleton = ({ count = 6 }) => (
  <div className="grid grid-cols-3 gap-3">
    {Array.from({ length: count }).map((_, idx) => (
      <ReelThumbSkeleton key={`inbuzz-grid-skeleton-${idx}`} delay={idx * 0.03} />
    ))}
  </div>
);

export const InBuzzViewerSkeleton = () => (
  <div className="h-[100dvh] w-full flex items-center justify-center">
    <div className="relative mx-auto h-full w-full max-w-[420px] overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b0f] shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
      <div className="absolute inset-0 inbuzz-skeleton" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Motion.div
          initial={{ opacity: 0.3, scale: 0.92 }}
          animate={{ opacity: [0.25, 0.55, 0.25], scale: [0.92, 1.03, 0.92] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          className="h-14 w-14 rounded-full bg-black/50 ring-1 ring-white/10 flex items-center justify-center"
        >
          <div className="ml-1 h-0 w-0 border-y-[9px] border-y-transparent border-l-[14px] border-l-white/25" />
        </Motion.div>
      </div>

      <div className="absolute bottom-0 left-0 z-10 w-full p-5 flex items-end gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-3 w-24 rounded-full inbuzz-skeleton opacity-80" />
          <div className="h-2.5 w-44 rounded-full inbuzz-skeleton opacity-70" />
          <div className="h-2.5 w-32 rounded-full inbuzz-skeleton opacity-60" />
        </div>
        <div className="flex flex-col items-center gap-4 pb-1">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={`inbuzz-viewer-action-skeleton-${idx}`}
              className="h-10 w-10 rounded-2xl bg-black/40 ring-1 ring-white/10 inbuzz-skeleton opacity-70"
            />
          ))}
        </div>
      </div>
    </div>
  </div>
);

