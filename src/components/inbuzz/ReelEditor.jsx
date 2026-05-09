import { useCallback, useEffect, useRef, useState } from "react";

const FILTER_PRESETS = [
  { id: "normal", label: "Normal", filter: "none" },
  { id: "warm", label: "Warm", filter: "sepia(0.18) saturate(1.1)" },
  { id: "cool", label: "Cool", filter: "saturate(0.9) hue-rotate(12deg)" },
  { id: "mono", label: "Mono", filter: "grayscale(1)" },
  { id: "vintage", label: "Vintage", filter: "sepia(0.28) contrast(1.05) saturate(0.95)" },
];

const formatTime = (value = 0) => {
  const total = Math.max(0, value);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const resolveFilterPreset = (presetId) =>
  FILTER_PRESETS.find((preset) => preset.id === presetId) || FILTER_PRESETS[0];

const buildFilterString = (presetId, adjustments) => {
  const preset = resolveFilterPreset(presetId);
  const { brightness, contrast, saturation } = adjustments;
  const adjust = `brightness(${brightness / 100}) contrast(${contrast / 100}) saturate(${saturation / 100})`;
  if (!preset || preset.filter === "none") return adjust;
  return `${preset.filter} ${adjust}`;
};

export default function ReelEditor({
  previewUrl,
  duration,
  trimStart,
  trimEnd,
  onTrimStart,
  onTrimEnd,
  frames,
  framesLoading,
  filterPreset,
  adjustments,
  onFilterPresetChange,
  onAdjustmentsChange,
  muted = false,
  onToggleMute,
}) {
  const percentStart = duration ? (trimStart / duration) * 100 : 0;
  const percentEnd = duration ? (trimEnd / duration) * 100 : 100;
  const selectionWidth = Math.max(0, percentEnd - percentStart);
  const filterString = buildFilterString(filterPreset, adjustments);
  const previewRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = previewRef.current;
    if (!video) return;
    try {
      video.muted = muted;
      if (!muted) video.volume = 1;
    } catch {
      // ignore
    }
  }, [muted]);

  useEffect(() => {
    const video = previewRef.current;
    if (!video) return;
    try {
      video.pause();
      video.currentTime = 0;
    } catch {
      // ignore
    }
  }, [previewUrl]);

  const togglePlay = useCallback(() => {
    const video = previewRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        video.muted = muted;
        if (!muted) video.volume = 1;
      } catch {
        // ignore
      }
      video.play().catch(() => {
        // Fallback: allow at least muted playback if sound gets blocked.
        if (!muted) {
          try {
            video.muted = true;
            video.play().catch(() => {});
          } catch {
            // ignore
          }
        }
      });
    } else {
      video.pause();
    }
  }, [muted]);

  return (
    <div className="space-y-5">
      <div className="flex justify-center">
        <div className="relative w-[240px] sm:w-[280px] aspect-[9/16] rounded-3xl border border-white/10 bg-black/50 overflow-hidden shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
          {previewUrl ? (
            <>
              <video
                ref={previewRef}
                src={previewUrl}
                className="h-full w-full object-cover"
                style={{ filter: filterString }}
                muted={muted}
                loop
                playsInline
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />

              <button
                type="button"
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center text-white/90"
                aria-label="Play preview"
              >
                <span className="h-12 w-12 rounded-full bg-black/60 flex items-center justify-center">
                  <i className={`fa-solid ${playing ? "fa-pause" : "fa-play"}`}></i>
                </span>
              </button>

              {typeof onToggleMute === "function" && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleMute();
                  }}
                  className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/60 text-white flex items-center justify-center border border-white/10"
                  aria-label={muted ? "Unmute preview" : "Mute preview"}
                  title={muted ? "Unmute" : "Mute"}
                >
                  <i
                    className={`fa-solid ${
                      muted ? "fa-volume-xmark" : "fa-volume-high"
                    } text-sm`}
                  ></i>
                </button>
              )}

              {muted && (
                <div className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] text-[#faf0e6] border border-white/10">
                  Tap sound icon
                </div>
              )}
            </>
          ) : (
            <div className="h-full w-full flex items-center justify-center text-xs text-[#b9b4c7]">
              Upload a vertical video to preview
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-[#b9b4c7]">
          <span>Trim video</span>
          <span>
            {formatTime(trimStart)} - {formatTime(trimEnd)}
          </span>
        </div>
        <div className="relative h-14 rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
          {frames && frames.length > 0 ? (
            <div className="absolute inset-0 flex">
              {frames.map((src, idx) => (
                <img
                  key={`frame-${idx}`}
                  src={src}
                  alt="Frame"
                  className="h-full flex-1 object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>
          ) : (
            <div className="absolute inset-2 rounded-xl bg-gradient-to-r from-white/10 via-white/5 to-white/10" />
          )}
          {framesLoading && (
            <div className="absolute inset-0 animate-pulse bg-white/5" />
          )}
          <div
            className="absolute inset-y-1 rounded-xl border-2 border-amber-300/70 bg-amber-300/10"
            style={{ left: `${percentStart}%`, width: `${selectionWidth}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-[#b9b4c7]">
            Start
            <input
              type="range"
              min="0"
              max={Math.max(duration || 0, 1)}
              step="0.1"
              value={trimStart}
              onChange={(e) => onTrimStart(Number(e.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <label className="text-xs text-[#b9b4c7]">
            End
            <input
              type="range"
              min="0"
              max={Math.max(duration || 0, 1)}
              step="0.1"
              value={trimEnd}
              onChange={(e) => onTrimEnd(Number(e.target.value))}
              className="mt-2 w-full"
            />
          </label>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">Filters</p>
        <div className="flex flex-wrap gap-2">
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onFilterPresetChange(preset.id)}
              className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
                filterPreset === preset.id
                  ? "bg-white/15 text-[#faf0e6]"
                  : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">Adjust</p>
        {[
          { key: "brightness", label: "Brightness" },
          { key: "contrast", label: "Contrast" },
          { key: "saturation", label: "Saturation" },
        ].map((item) => (
          <label key={item.key} className="text-xs text-[#b9b4c7] block">
            {item.label}
            <input
              type="range"
              min="70"
              max="130"
              value={adjustments[item.key]}
              onChange={(e) =>
                onAdjustmentsChange({
                  ...adjustments,
                  [item.key]: Number(e.target.value),
                })
              }
              className="mt-2 w-full"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
