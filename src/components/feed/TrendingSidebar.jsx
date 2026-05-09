import { useMemo } from "react";
import { motion as Motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { getOptimizedFillUrl } from "../../utils/media";
import { isVideoUrl } from "../../utils/storyMedia";

const FALLBACK_THUMB = "/incampus-icon.svg";

const resolvePostId = (post) =>
  post?._id || post?.id || post?.postId || post?.post_id || "";

const resolvePostMediaUrl = (post) =>
  post?.mediaUrl ||
  post?.media?.url ||
  post?.media?.secure_url ||
  post?.media?.secureUrl ||
  post?.imageUrl ||
  post?.image ||
  post?.videoUrl ||
  post?.video ||
  "";

const resolvePostPreview = (post) => {
  const raw =
    post?.content ||
    post?.caption ||
    post?.text ||
    post?.description ||
    "Campus update";
  const text = String(raw).trim();
  if (!text) return "Campus update";
  return text.length > 72 ? `${text.slice(0, 72).trimEnd()}…` : text;
};

const resolvePostAuthor = (post) =>
  post?.author?.displayName ||
  post?.author?.fullName ||
  post?.author?.name ||
  post?.authorName ||
  post?.userName ||
  "Campus";

export default function TrendingSidebar({ items = [], onOpenPost }) {
  const navigate = useNavigate();
  const displayItems = useMemo(() => items.slice(0, 6), [items]);

  return (
    <div className="glass-card rounded-3xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">
            Trending
          </p>
          <p className="text-sm font-semibold text-[#faf0e6]">Campus picks</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/trending")}
          className="text-xs text-[#b9b4c7] hover:text-[#faf0e6] transition-colors"
        >
          View all
        </button>
      </div>

      {displayItems.length === 0 ? (
        <p className="text-xs text-[#b9b4c7]">
          No trending posts yet. Check back soon.
        </p>
      ) : (
        <div className="space-y-3">
          {displayItems.map((entry, index) => {
            const post = entry?.post || entry;
            const postId = entry?.id || resolvePostId(post) || `trend-${index}`;
            const mediaUrl = resolvePostMediaUrl(post);
            const isVideo =
              isVideoUrl(mediaUrl) ||
              String(post?.mediaType || post?.type || "")
                .toLowerCase()
                .includes("video");
            const preview = resolvePostPreview(post);
            const author = resolvePostAuthor(post);
            const thumb = mediaUrl
              ? getOptimizedFillUrl(mediaUrl, { width: 120, aspectRatio: "1:1" })
              : FALLBACK_THUMB;

            return (
              <Motion.button
                key={String(postId)}
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => onOpenPost?.(postId)}
                className="w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10 transition-colors"
              >
                <div className="h-12 w-12 rounded-xl overflow-hidden border border-white/10 bg-black/20 shrink-0">
                  {thumb ? (
                    isVideo ? (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-[#faf0e6]/80">
                        ▶
                      </div>
                    ) : (
                      <img
                        src={thumb}
                        alt="Trending thumbnail"
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    )
                  ) : (
                    <img
                      src={FALLBACK_THUMB}
                      alt="Trending"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#b9b4c7] truncate">
                    {author}
                  </p>
                  <p className="text-sm text-[#faf0e6] truncate">{preview}</p>
                </div>
              </Motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
