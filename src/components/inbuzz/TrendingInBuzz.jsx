import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { formatInBuzzCount } from "../../utils/inbuzz";
import { InBuzzStripSkeleton } from "./InBuzzSkeleton";

const computeEngagement = (reel) =>
  (reel?.likes || 0) + (reel?.comments || 0) * 2 + (reel?.shares || 0) * 3;

export default function TrendingInBuzz({ reels = [], loading = false }) {
  const navigate = useNavigate();
  const list = Array.isArray(reels) ? reels : [];

  const mostEngaging = useMemo(
    () => [...list].sort((a, b) => computeEngagement(b) - computeEngagement(a)).slice(0, 8),
    [list]
  );

  const hasReels = list.length > 0;

  if (!hasReels && !loading) return null;

  if (!hasReels) {
    return (
      <section className="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[#b9b4c7]">
            Trending InBuzz
          </p>
          <p className="text-sm text-[#faf0e6]">Most engaging reels right now.</p>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#faf0e6]">Most engaging</h3>
            <span className="text-[10px] text-[#b9b4c7]">InBuzz</span>
          </div>
          <InBuzzStripSkeleton count={8} />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[#b9b4c7]">
          Trending InBuzz
        </p>
        <p className="text-sm text-[#faf0e6]">Most engaging reels right now.</p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#faf0e6]">Most engaging</h3>
          <span className="text-[10px] text-[#b9b4c7]">InBuzz</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {mostEngaging.map((reel) => (
            <button
              key={reel.id}
              type="button"
              onClick={() => navigate(`/inbuzz/${reel.id}`)}
              className="relative min-w-[150px] max-w-[150px] aspect-[9/16] rounded-2xl overflow-hidden border border-white/10 bg-white/5"
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
      </div>
    </section>
  );
}
