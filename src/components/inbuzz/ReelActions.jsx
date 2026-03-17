import { motion as Motion } from "framer-motion";
import { formatInBuzzCount } from "../../utils/inbuzz";

export default function ReelActions({
  reel,
  liked = false,
  onLike,
  onComment,
  onShare,
  onInfo,
  muted,
  onToggleMute,
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-[#faf0e6]">
      {typeof muted === "boolean" && onToggleMute && (
        <Motion.button
          type="button"
          onClick={onToggleMute}
          whileTap={{ scale: 0.85 }}
          className="flex flex-col items-center gap-1 text-sm"
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Unmute" : "Mute"}
        >
          <i
            className={`fa-solid ${
              muted ? "fa-volume-xmark" : "fa-volume-high"
            } text-xl`}
          ></i>
          <span className="text-[11px] text-[#b9b4c7]">
            {muted ? "Muted" : "Sound"}
          </span>
        </Motion.button>
      )}
      <Motion.button
        type="button"
        onClick={onLike}
        whileTap={{ scale: 0.85 }}
        className={`flex flex-col items-center gap-1 text-sm ${
          liked ? "text-rose-300" : "text-[#faf0e6]"
        }`}
        aria-label="Like"
      >
        <i className={`fa-${liked ? "solid" : "regular"} fa-heart text-xl`}></i>
        <span className="text-[11px] text-[#b9b4c7]">
          {formatInBuzzCount(reel?.likes)}
        </span>
      </Motion.button>
      <Motion.button
        type="button"
        onClick={onComment}
        whileTap={{ scale: 0.85 }}
        className="flex flex-col items-center gap-1 text-sm"
        aria-label="Comment"
      >
        <i className="fa-regular fa-comment text-xl"></i>
        <span className="text-[11px] text-[#b9b4c7]">
          {formatInBuzzCount(reel?.comments)}
        </span>
      </Motion.button>
      <Motion.button
        type="button"
        onClick={onShare}
        whileTap={{ scale: 0.85 }}
        className="flex flex-col items-center gap-1 text-sm"
        aria-label="Share"
      >
        <i className="fa-solid fa-paper-plane text-xl"></i>
        <span className="text-[11px] text-[#b9b4c7]">
          {formatInBuzzCount(reel?.shares)}
        </span>
      </Motion.button>
      <Motion.button
        type="button"
        onClick={onInfo}
        whileTap={{ scale: 0.85 }}
        className="flex flex-col items-center gap-1 text-sm"
        aria-label="Info"
      >
        <i className="fa-solid fa-circle-info text-xl"></i>
        <span className="text-[11px] text-[#b9b4c7]">Info</span>
      </Motion.button>
    </div>
  );
}
