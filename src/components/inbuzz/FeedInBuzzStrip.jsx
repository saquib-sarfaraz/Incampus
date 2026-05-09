import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatInBuzzCount } from "../../utils/inbuzz";
import { InBuzzStripSkeleton } from "./InBuzzSkeleton";

const computeEngagement = (reel) =>
  (reel?.likes || 0) + (reel?.comments || 0) * 2 + (reel?.shares || 0) * 3;

const FILTERS = [
  { id: "liked", label: "Most liked" },
  { id: "engaging", label: "Most engaging" },
];

export default function FeedInBuzzStrip({ reels = [], loading = false }) {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState("liked");

  const sortedReels = useMemo(() => {
    const list = Array.isArray(reels) ? [...reels] : [];
    if (activeFilter === "engaging") {
      return list.sort((a, b) => computeEngagement(b) - computeEngagement(a));
    }
    return list.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  }, [reels, activeFilter]);

  const hasReels = sortedReels.length > 0;

  if (!hasReels && !loading) return null;

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[#b9b4c7]">InBuzz</p>
          <p className="text-sm text-[#faf0e6]">Short videos from campus.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setActiveFilter(filter.id)}
              disabled={!hasReels}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                activeFilter === filter.id
                  ? "bg-white/15 text-[#faf0e6]"
                  : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      {hasReels ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {sortedReels.slice(0, 10).map((reel) => (
            <button
              key={reel.id}
              type="button"
              onClick={() => navigate(`/inbuzz/${reel.id}`)}
              className="relative min-w-[140px] max-w-[140px] aspect-[9/16] rounded-2xl overflow-hidden border border-white/10 bg-white/5"
            >
              {reel.thumbnail ? (
                <img
                  src={reel.thumbnail}
                  alt="InBuzz"
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="h-full w-full bg-white/5" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute bottom-2 left-2 text-[11px] text-[#faf0e6] flex items-center gap-1">
                <i className="fa-solid fa-eye"></i>
                {formatInBuzzCount(
                  reel?.views ?? reel?.viewsCount ?? reel?.views_count ?? reel?.viewCount ?? 0
                )}
              </div>
              <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center">
                <i className="fa-solid fa-play text-xs"></i>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <InBuzzStripSkeleton count={8} />
      )}
    </section>
  );
}
