import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import ReelEditor from "./ReelEditor";
import { useAuth } from "../../context/authContext";
import { createInBuzzReelWithProgress, searchColleges } from "../../services/api";
import { removePendingInBuzzUpload, upsertPendingInBuzzUpload } from "../../utils/inbuzzUploads";

const DEFAULT_ADJUSTMENTS = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
};

const FILTER_PRESETS = [
  { id: "normal", label: "Normal", filter: "none" },
  { id: "warm", label: "Warm", filter: "sepia(0.18) saturate(1.1)" },
  { id: "cool", label: "Cool", filter: "saturate(0.9) hue-rotate(12deg)" },
  { id: "mono", label: "Mono", filter: "grayscale(1)" },
  { id: "vintage", label: "Vintage", filter: "sepia(0.28) contrast(1.05) saturate(0.95)" },
];

const VISIBILITY_OPTIONS = [
  { id: "universal", label: "🌍 Universal" },
  { id: "college", label: "🏫 College Only" },
  { id: "friends", label: "🔒 Friends Only" },
];

const resolveFilterPreset = (presetId) =>
  FILTER_PRESETS.find((preset) => preset.id === presetId) || FILTER_PRESETS[0];

const buildFilterString = (presetId, adjustments) => {
  const preset = resolveFilterPreset(presetId);
  const { brightness, contrast, saturation } = adjustments;
  const adjust = `brightness(${brightness / 100}) contrast(${contrast / 100}) saturate(${saturation / 100})`;
  if (!preset || preset.filter === "none") return adjust;
  return `${preset.filter} ${adjust}`;
};

const normalizeCollege = (item) => {
  if (!item) return null;
  if (typeof item === "string") {
    const name = item.trim();
    return name ? { name, id: "" } : null;
  }
  if (typeof item === "object") {
    const name =
      item.name ||
      item.tagName ||
      item.tag ||
      item.collegeTagName ||
      item.collegeName ||
      item.college ||
      item.university ||
      item.institution ||
      item.school ||
      item.title ||
      item.value ||
      item.label ||
      item.displayName ||
      "";
    const id =
      item.id ||
      item._id ||
      item.collegeId ||
      item.universityId ||
      item.code ||
      "";
    if (!name) return null;
    return { name: String(name).trim(), id: id ? String(id) : "" };
  }
  return null;
};

const normalizeCollegeList = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map(normalizeCollege).filter(Boolean);
  }
  if (Array.isArray(data.colleges)) {
    return data.colleges.map(normalizeCollege).filter(Boolean);
  }
  if (Array.isArray(data.data)) {
    return data.data.map(normalizeCollege).filter(Boolean);
  }
  if (Array.isArray(data.items)) {
    return data.items.map(normalizeCollege).filter(Boolean);
  }
  if (Array.isArray(data.results)) {
    return data.results.map(normalizeCollege).filter(Boolean);
  }
  return [];
};

const EDITOR_MUTED_KEY = "inbuzz:editorMuted";
const MAX_UPLOAD_MB = 50;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const readEditorMutedPref = () => {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(EDITOR_MUTED_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // ignore storage errors
  }
  return false; // default sound ON inside editor preview
};

export default function ReelUpload() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState("universal");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [duration, setDuration] = useState(0);
  const [filterPreset, setFilterPreset] = useState("normal");
  const [adjustments, setAdjustments] = useState(DEFAULT_ADJUSTMENTS);
  const [frames, setFrames] = useState([]);
  const [framesLoading, setFramesLoading] = useState(false);
  const [collegeInput, setCollegeInput] = useState("");
  const [selectedColleges, setSelectedColleges] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [collegeLoading, setCollegeLoading] = useState(false);
  const [collegeError, setCollegeError] = useState("");
  const [showCollegeDropdown, setShowCollegeDropdown] = useState(false);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [editorMuted, setEditorMuted] = useState(() => readEditorMutedPref());
  const fileInputRef = useRef(null);
  const previewVideoRef = useRef(null);
  const collegeRef = useRef(null);
  const frameRequestRef = useRef(0);
  const previewPlayRef = useRef(null);
  const uploadAbortRef = useRef(null);
  const uploadClientIdRef = useRef("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(EDITOR_MUTED_KEY, editorMuted ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [editorMuted]);

  useEffect(() => {
    if (!file) return undefined;
    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [file]);

  const canProceed = useMemo(() => Boolean(file), [file]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (collegeRef.current && !collegeRef.current.contains(event.target)) {
        setShowCollegeDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    if (!collegeInput || collegeInput.trim().length < 2) {
      setColleges([]);
      setCollegeLoading(false);
      setCollegeError("");
      return;
    }

    let isMounted = true;
    const timeoutId = setTimeout(async () => {
      setCollegeLoading(true);
      setCollegeError("");
      try {
        const results = await searchColleges(collegeInput.trim(), { limit: 20 });
        if (isMounted) {
          const list = normalizeCollegeList(results);
          setColleges(list);
          setShowCollegeDropdown(true);
        }
      } catch {
        if (isMounted) {
          setCollegeError("Unable to load colleges. You can type manually.");
        }
      } finally {
        if (isMounted) setCollegeLoading(false);
      }
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [collegeInput]);

  useEffect(() => {
    if (!currentUser || selectedColleges.length > 0) return;
    const name =
      currentUser.collegeTagName ||
      currentUser.collegeTag ||
      currentUser.university ||
      currentUser.college ||
      currentUser.school ||
      "";
    const id =
      currentUser.collegeTagId ||
      currentUser.college_tag_id ||
      currentUser.collegeTag?._id ||
      currentUser.collegeId ||
      currentUser.college_id ||
      "";
    if (!name) return;
    setSelectedColleges([{ name: String(name).trim(), id: id ? String(id) : "" }]);
  }, [currentUser, selectedColleges.length]);

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;

    if (Number(nextFile.size || 0) > MAX_UPLOAD_BYTES) {
      setFile(null);
      setStatus("");
      setUploadPercent(0);
      setUploadError(`Max file size is ${MAX_UPLOAD_MB}MB.`);
      uploadClientIdRef.current = "";
      setFrames([]);
      setStep(1);
      if (event.target) {
        try {
          event.target.value = "";
        } catch {
          // ignore
        }
      }
      return;
    }

    setFile(nextFile);
    setStatus("");
    setUploadPercent(0);
    setUploadError("");
    uploadClientIdRef.current = "";
    setFrames([]);
    setStep(2);
  };

  const handleTrimStart = (value) => {
    setTrimStart(Math.min(value, trimEnd));
  };

  const handleTrimEnd = (value) => {
    setTrimEnd(Math.max(value, trimStart));
  };

  const handleLoadedMetadata = () => {
    const durationValue = previewVideoRef.current?.duration || 0;
    setDuration(durationValue);
    setTrimStart(0);
    setTrimEnd(durationValue || 0);
  };

  useEffect(() => {
    const video = previewPlayRef.current;
    if (!video) return;
    try {
      video.muted = editorMuted;
      if (!editorMuted) video.volume = 1;
    } catch {
      // ignore
    }
  }, [editorMuted, showPreview]);

  useEffect(() => {
    if (!previewUrl || !duration || step !== 2) {
      setFrames([]);
      setFramesLoading(false);
      return;
    }
    let isMounted = true;
    const requestId = ++frameRequestRef.current;
    const frameCount = 8;
    const extractFrames = async () => {
      setFramesLoading(true);
      try {
        const video = document.createElement("video");
        video.src = previewUrl;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";

        await new Promise((resolve, reject) => {
          const handleLoaded = () => resolve();
          const handleError = () => reject(new Error("Failed to load video"));
          video.addEventListener("loadedmetadata", handleLoaded, { once: true });
          video.addEventListener("error", handleError, { once: true });
        });

        const targetWidth = 120;
        const scale = targetWidth / (video.videoWidth || targetWidth);
        const targetHeight = Math.max(60, Math.round((video.videoHeight || 200) * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No canvas context");

        const capture = (time) =>
          new Promise((resolve) => {
            const safeTime = Math.min(Math.max(time, 0.01), Math.max(duration - 0.05, 0.05));
            const handleSeeked = () => resolve();
            video.addEventListener("seeked", handleSeeked, { once: true });
            video.currentTime = safeTime;
          });

        const results = [];
        for (let i = 0; i < frameCount; i += 1) {
          const time = (duration / frameCount) * i;
          await capture(time);
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          results.push(canvas.toDataURL("image/jpeg", 0.7));
        }

        if (isMounted && requestId === frameRequestRef.current) {
          setFrames(results);
        }
      } catch {
        if (isMounted && requestId === frameRequestRef.current) {
          setFrames([]);
        }
      } finally {
        if (isMounted && requestId === frameRequestRef.current) {
          setFramesLoading(false);
        }
      }
    };
    extractFrames();
    return () => {
      isMounted = false;
    };
  }, [previewUrl, duration, step]);

  const addCollegeTag = (college) => {
    if (!college) return;
    setSelectedColleges((prev) => {
      const exists = prev.some(
        (tag) =>
          (college.id && String(tag.id || "") === String(college.id)) ||
          (!college.id && tag.name === college.name)
      );
      if (exists) return prev;
      return [...prev, { name: college.name, id: college.id || "" }];
    });
    setCollegeInput("");
    setShowCollegeDropdown(false);
  };

  const removeCollegeTag = (college) => {
    setSelectedColleges((prev) => {
      const next = prev.filter((tag) => {
        if (college.id && String(tag.id || "") === String(college.id)) return false;
        if (!college.id && tag.name === college.name) return false;
        return true;
      });
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canProceed || uploading) return;
    if (!currentUser) {
      alert("Please sign in to upload.");
      return;
    }
    if (!file) return;
    if (Number(file.size || 0) > MAX_UPLOAD_BYTES) {
      setUploadError(`Max file size is ${MAX_UPLOAD_MB}MB.`);
      setStatus("");
      return;
    }

    const clientUploadId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `inbuzz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    uploadClientIdRef.current = clientUploadId;

    const previewThumb = frames?.[0] || "";
    const authorId = currentUser?.id || currentUser?._id || "";
    upsertPendingInBuzzUpload({
      id: clientUploadId,
      userId: authorId ? String(authorId) : "",
      createdAt: new Date().toISOString(),
      status: "uploading",
      caption: caption.trim(),
      visibility,
      previewThumb,
      stage: "Uploading…",
      uploadPercent: 0,
      fileName: file?.name || "",
      fileSize: Number(file?.size || 0),
    });

    setUploading(true);
    setStatus("Uploading InBuzz…");
    setUploadPercent(0);
    setUploadError("");
    const payload = {
      caption: caption.trim(),
      visibility,
      trim_start: trimStart,
      trim_end: trimEnd || duration,
      is_hidden_from_feed: false,
    };

    const uploadPromise = createInBuzzReelWithProgress(
      file,
      payload,
      (percent) => {
        if (mountedRef.current) setUploadPercent(percent);
        upsertPendingInBuzzUpload({
          id: clientUploadId,
          status: "uploading",
          stage: "Uploading…",
          uploadPercent: percent,
        });
      },
      (controls) => {
        uploadAbortRef.current = controls?.abort || null;
      }
    );

    // TikTok-style UX: jump back to the feed immediately and let the upload finish in the background.
    const fromPath = typeof location?.state?.from === "string" ? location.state.from : "";
    const cameFromInBuzz = fromPath.startsWith("/inbuzz");
    if (cameFromInBuzz && typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/inbuzz", { replace: true });
    }

	    uploadPromise
	      .then((response) => {
	        const responseStatus =
	          response?.status ||
	          response?.state ||
	          response?.data?.status ||
	          response?.data?.state ||
	          "";
	        const loweredStatus = String(responseStatus).toLowerCase();
	        const isProcessing =
	          loweredStatus === "processing" ||
	          loweredStatus === "queued" ||
	          loweredStatus === "pending";
	        const isCompleted =
	          loweredStatus === "completed" ||
	          loweredStatus === "complete" ||
	          loweredStatus === "done" ||
	          loweredStatus === "published" ||
	          loweredStatus === "ready";

	        const uploadJob =
	          response?.uploadJob ||
	          response?.jobId ||
	          response?.job_id ||
          response?.data?.uploadJob ||
          response?.data?.jobId ||
          response?.data?.job_id ||
          null;

        if (mountedRef.current) {
          setUploadPercent(100);
          setStatus("Processing video…");
        }

        upsertPendingInBuzzUpload({
          id: clientUploadId,
          status: "processing",
          stage: "Processing video…",
          uploadPercent: 100,
        });

	        const jobId =
	          typeof uploadJob === "string"
	            ? uploadJob
	            : uploadJob?.id || uploadJob?.jobId || uploadJob?._id;

	        const possibleReelId =
	          response?.reelId ||
	          response?.reel_id ||
	          response?.id ||
	          response?.data?.reelId ||
	          response?.data?.reel_id ||
	          response?.data?.id ||
	          response?.reel?._id ||
	          response?.reel?.id ||
	          response?.data?.reel?._id ||
	          response?.data?.reel?.id ||
	          "";

		        if (jobId) {
		          const nextUpload = {
		            id: clientUploadId,
		            jobId: String(jobId),
		            status: "processing",
		          };
		          if (possibleReelId) nextUpload.reelId = String(possibleReelId);
		          upsertPendingInBuzzUpload(nextUpload);
		          return;
		        }

		        if (possibleReelId && isProcessing) {
		          upsertPendingInBuzzUpload({
		            id: clientUploadId,
		            status: "processing",
	            reelId: String(possibleReelId),
	            stage: "Processing in background… It will appear shortly.",
	          });
	          return;
	        }

	        if (possibleReelId && (isCompleted || !loweredStatus)) {
	          upsertPendingInBuzzUpload({
	            id: clientUploadId,
	            status: "published",
	            processingPercent: 100,
            reelId: String(possibleReelId),
            completedAt: new Date().toISOString(),
          });
          setTimeout(() => removePendingInBuzzUpload(clientUploadId), 2400);
	          return;
	        }

        upsertPendingInBuzzUpload({
          id: clientUploadId,
          status: "failed",
          error: "Upload started but server did not return a job id.",
        });
      })
      .catch((error) => {
        const message = error?.message || "Failed to upload InBuzz.";
        if (mountedRef.current) {
          setStatus(message);
          setUploadError(message);
        }
        upsertPendingInBuzzUpload({
          id: clientUploadId,
          status: "failed",
          error: message,
        });
      })
      .finally(() => {
        if (mountedRef.current) {
          setUploading(false);
        }
        uploadAbortRef.current = null;
      });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#faf0e6]">
              {step === 1
                ? "Select video"
                : step === 2
                  ? "Edit InBuzz"
                  : "Add details"}
            </h2>
            <p className="text-xs text-[#b9b4c7]">
              {step === 1
                ? "Choose a vertical video to begin."
                : step === 2
                  ? "Trim, filter, and adjust your reel."
                  : "Caption, visibility, and tags."}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[#b9b4c7]">
            <span className={step >= 1 ? "text-[#faf0e6]" : ""}>1</span>
            <span>•</span>
            <span className={step >= 2 ? "text-[#faf0e6]" : ""}>2</span>
            <span>•</span>
            <span className={step >= 3 ? "text-[#faf0e6]" : ""}>3</span>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {step === 1 && (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center space-y-4">
          <div className="text-sm text-[#b9b4c7]">
            Upload a vertical video (9:16 recommended).
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="liquid-button rounded-full px-5 py-2 text-xs font-semibold text-[#faf0e6]"
          >
            Select video
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div className="hidden">
              {previewUrl ? (
                <video
                  ref={previewVideoRef}
                  src={previewUrl}
                  onLoadedMetadata={handleLoadedMetadata}
                />
              ) : null}
            </div>
            <ReelEditor
              previewUrl={previewUrl}
              duration={duration}
              trimStart={trimStart}
              trimEnd={trimEnd || duration}
              onTrimStart={handleTrimStart}
              onTrimEnd={handleTrimEnd}
              frames={frames}
              framesLoading={framesLoading}
              filterPreset={filterPreset}
              adjustments={adjustments}
              onFilterPresetChange={setFilterPreset}
              onAdjustmentsChange={setAdjustments}
              muted={editorMuted}
              onToggleMute={() => setEditorMuted((prev) => !prev)}
            />
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-[#b9b4c7]">
              Trim range: {trimStart.toFixed(1)}s - {trimEnd.toFixed(1)}s
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-full bg-white/5 px-4 py-2 text-xs text-[#b9b4c7]"
              >
                Back
              </button>
              <Motion.button
                type="button"
                onClick={() => setStep(3)}
                disabled={!canProceed}
                whileTap={{ scale: 0.97 }}
                className="flex-1 rounded-full liquid-button px-4 py-2 text-xs font-semibold text-[#faf0e6] disabled:opacity-60"
              >
                Next
              </Motion.button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={`grid gap-6 ${showPreview ? "lg:grid-cols-[1.1fr_0.9fr]" : ""}`}>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-5">
            <label className="block text-xs text-[#b9b4c7]">
              Caption
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="mt-2 w-full rounded-2xl glass-input p-3 text-sm resize-none"
                rows="3"
                placeholder="Write a caption..."
              />
            </label>

            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">Visibility</p>
              <div className="mt-3 space-y-2">
                {VISIBILITY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setVisibility(option.id)}
                    className={`w-full rounded-2xl px-4 py-2 text-left text-sm transition-colors ${
                      visibility === option.id
                        ? "bg-white/15 text-[#faf0e6]"
                        : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div ref={collegeRef} className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">Tag college</p>
              <div className="flex flex-wrap gap-2">
                {selectedColleges.map((tag) => (
                  <span
                    key={`${tag.id || tag.name}`}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#faf0e6]"
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => removeCollegeTag(tag)}
                      className="text-[#b9b4c7] hover:text-[#faf0e6]"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={collegeInput}
                onChange={(e) => setCollegeInput(e.target.value)}
                onFocus={() => collegeInput && setShowCollegeDropdown(true)}
                placeholder="Search college..."
                className="w-full rounded-2xl glass-input px-4 py-2 text-sm"
              />
              {showCollegeDropdown && (collegeLoading || colleges.length > 0 || collegeError) && (
                <div className="mt-2 rounded-2xl border border-white/10 bg-[#1a120b]/95 backdrop-blur-md shadow-lg max-h-56 overflow-y-auto">
                  {collegeLoading && (
                    <p className="px-4 py-3 text-xs text-[#b9b4c7]">Loading...</p>
                  )}
                  {collegeError && (
                    <p className="px-4 py-3 text-xs text-rose-200">{collegeError}</p>
                  )}
                  {!collegeLoading &&
                    colleges.map((college) => (
                      <button
                        key={`${college.id || college.name}`}
                        type="button"
                        onClick={() => addCollegeTag(college)}
                        className="w-full text-left px-4 py-2 text-xs text-[#faf0e6] hover:bg-white/10"
                      >
                        {college.name}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-full bg-white/5 px-4 py-2 text-xs text-[#b9b4c7]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (showPreview) {
                    const video = previewPlayRef.current;
                    if (video) video.pause();
                    setPreviewPlaying(false);
                  }
                  setShowPreview((prev) => !prev);
                }}
                className="rounded-full bg-white/5 px-4 py-2 text-xs text-[#b9b4c7]"
              >
                {showPreview ? "Hide preview" : "Preview"}
              </button>
              <Motion.button
                type="button"
                onClick={handleSubmit}
                disabled={!canProceed || uploading}
                whileTap={{ scale: 0.97 }}
                className="flex-1 rounded-full liquid-button px-4 py-2 text-xs font-semibold text-[#faf0e6] disabled:opacity-60"
              >
                {uploading ? "Posting…" : "Post InBuzz"}
              </Motion.button>
            </div>
            {uploading && (
              <div className="mt-3 space-y-2">
                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-300/80 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, uploadPercent || 0))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#b9b4c7]">
                  <span>{status || "Uploading…"}</span>
                  <span>{uploadPercent ? `${uploadPercent}%` : ""}</span>
                </div>
                <button
                  type="button"
                  onClick={() => uploadAbortRef.current?.()}
                  className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#faf0e6] hover:bg-white/10"
                >
                  Cancel upload
                </button>
              </div>
            )}
            {!uploading && status && (
              <p className={`text-xs ${uploadError ? "text-rose-200" : "text-emerald-200"}`}>
                {status}
              </p>
            )}
            {!uploading && uploadError && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="rounded-full liquid-button px-4 py-2 text-xs font-semibold text-[#faf0e6]"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUploadError("");
                    setStatus("");
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#faf0e6] hover:bg-white/10"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          {showPreview && (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">Preview</p>
              <div className="flex justify-center">
                <div className="relative w-[240px] aspect-[9/16] rounded-3xl border border-white/10 bg-black/50 overflow-hidden shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
                  {previewUrl ? (
                    <video
                      ref={previewPlayRef}
                      src={previewUrl}
                      className="h-full w-full object-cover"
                      style={{ filter: buildFilterString(filterPreset, adjustments) }}
                      muted={editorMuted}
                      loop
                      playsInline
                      preload="metadata"
                      onPlay={() => setPreviewPlaying(true)}
                      onPause={() => setPreviewPlaying(false)}
                    />
                  ) : (
                    <div className="h-full w-full bg-white/5" />
                  )}
                  {previewUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        const video = previewPlayRef.current;
                        if (!video) return;
                        if (video.paused) {
                          try {
                            video.muted = editorMuted;
                            if (!editorMuted) video.volume = 1;
                          } catch {
                            // ignore
                          }
                          video.play().catch(() => {
                            // fallback to muted playback if sound gets blocked
                            if (!editorMuted) {
                              try {
                                video.muted = true;
                              } catch {
                                // ignore
                              }
                              setEditorMuted(true);
                              video.play().catch(() => {});
                            }
                          });
                        } else {
                          video.pause();
                        }
                      }}
                      className="absolute inset-0 flex items-center justify-center text-white/90"
                      aria-label="Play preview"
                    >
                      <span className="h-12 w-12 rounded-full bg-black/60 flex items-center justify-center">
                        <i className={`fa-solid ${previewPlaying ? "fa-pause" : "fa-play"}`}></i>
                      </span>
                    </button>
                  )}
                  {previewUrl && (
                    <button
                      type="button"
                      onClick={() => setEditorMuted((prev) => !prev)}
                      className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/60 text-white flex items-center justify-center border border-white/10"
                      aria-label={editorMuted ? "Unmute preview" : "Mute preview"}
                      title={editorMuted ? "Unmute" : "Mute"}
                    >
                      <i
                        className={`fa-solid ${
                          editorMuted ? "fa-volume-xmark" : "fa-volume-high"
                        } text-sm`}
                      ></i>
                    </button>
                  )}
                  {previewUrl && editorMuted && (
                    <div className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] text-[#faf0e6] border border-white/10">
                      Tap sound icon
                    </div>
                  )}
                  {caption && (
                    <div className="absolute bottom-3 left-3 right-3 rounded-2xl bg-black/50 px-3 py-2 text-[11px] text-[#faf0e6]">
                      {caption}
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-[#b9b4c7]">
                Visibility: {VISIBILITY_OPTIONS.find((o) => o.id === visibility)?.label}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
