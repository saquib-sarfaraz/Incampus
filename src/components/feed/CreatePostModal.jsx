import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { createPost, searchColleges } from "../../services/api";
import Post from "./Post";
import {
  compressImageFile,
  createCroppedImage,
  detectAspectRatio,
  resolveAspectRatioString,
} from "../../utils/media";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const COLLEGE_SEARCH_DEBOUNCE_MS = 150;
const THOUGHT_MIN_LENGTH = 3;
const THOUGHT_MAX_LENGTH = 2000;
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
const EDIT_TOOL_OPTIONS = [
  { id: "crop", label: "Crop", icon: "fa-crop-simple" },
  { id: "adjust", label: "Adjust", icon: "fa-sliders" },
  { id: "filter", label: "Filter", icon: "fa-wand-magic-sparkles" },
  { id: "text", label: "Text", icon: "fa-font" },
];
const ASPECT_OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "1:1", label: "Square (1:1)" },
  { id: "4:5", label: "Portrait (4:5)" },
  { id: "1.91:1", label: "Landscape (1.91:1)" },
];
const AUDIENCE_OPTIONS = [
  { id: "universal", label: "🌍 Universal" },
  { id: "college", label: "🏫 College Only" },
  { id: "private", label: "🔒 Friends Only" },
];

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

const resolveFilterPreset = (presetId) => {
  if (!presetId) return FILTER_PRESETS[0];
  return FILTER_PRESETS.find((preset) => preset.id === presetId) || FILTER_PRESETS[0];
};

const buildFilterString = (presetId, adjustments = DEFAULT_ADJUSTMENTS) => {
  const preset = resolveFilterPreset(presetId);
  const { brightness, contrast, saturation } = adjustments;
  const adjust = `brightness(${brightness / 100}) contrast(${contrast / 100}) saturate(${saturation / 100})`;
  if (!preset || preset.filter === "none") return adjust;
  return `${preset.filter} ${adjust}`;
};

const loadImageFromFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    const image = new Image();
    reader.onload = () => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to load image"));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });

const drawWrappedText = (ctx, text, x, y, maxWidth, lineHeight) => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return;
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  });
  if (line) lines.push(line);
  const totalHeight = lines.length * lineHeight;
  let startY = y - totalHeight / 2 + lineHeight / 2;
  lines.forEach((item, index) => {
    const lineY = startY + index * lineHeight;
    ctx.strokeText(item, x, lineY);
    ctx.fillText(item, x, lineY);
  });
};

const clampPercent = (value) => Math.min(95, Math.max(5, value));

const applyImageEdits = async ({
  file,
  filterPreset,
  adjustments,
  overlayText,
  overlaySize = 32,
  overlayColor = "#faf0e6",
  overlayPosition = { x: 50, y: 50 },
}) => {
  if (!file || !file.type || !file.type.startsWith("image/")) return file;
  const image = await loadImageFromFile(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  const filterString = buildFilterString(filterPreset, adjustments);
  ctx.filter = filterString || "none";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const overlayValue = overlayText ? overlayText.trim() : "";
  if (overlayValue) {
    ctx.filter = "none";
    const size = Math.max(16, Math.min(overlaySize, canvas.width / 6));
    ctx.font = `600 ${size}px "Poppins", "Sora", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = overlayColor;
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = Math.max(6, size * 0.15);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = Math.max(2, size * 0.08);
    const posX = canvas.width * (clampPercent(overlayPosition.x) / 100);
    const posY = canvas.height * (clampPercent(overlayPosition.y) / 100);
    drawWrappedText(ctx, overlayValue, posX, posY, canvas.width * 0.8, size * 1.2);
    ctx.shadowBlur = 0;
  }

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(file);
          return;
        }
        const editedFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
          type: "image/jpeg",
        });
        resolve(editedFile);
      },
      "image/jpeg",
      0.86
    );
  });
};

export default function CreatePostModal({ isOpen, onClose, onCreated }) {
  const { currentUser } = useAuth();
  const { loadPosts } = useApp();
  const [step, setStep] = useState(1);
  const [postMode, setPostMode] = useState("post");
  const [visibility, setVisibility] = useState("universal");
  const [text, setText] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [aspectChoice, setAspectChoice] = useState("auto");
  const [detectedAspect, setDetectedAspect] = useState("4:5");
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [activeTool, setActiveTool] = useState("crop");
  const [filterPreset, setFilterPreset] = useState("normal");
  const [adjustments, setAdjustments] = useState(DEFAULT_ADJUSTMENTS);
  const [overlayText, setOverlayText] = useState("");
  const [overlaySize, setOverlaySize] = useState(32);
  const [overlayPosition, setOverlayPosition] = useState({ x: 50, y: 50 });
  const [editedMediaFile, setEditedMediaFile] = useState(null);
  const [editedPreviewUrl, setEditedPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [collegeInput, setCollegeInput] = useState("");
  const [selectedColleges, setSelectedColleges] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [collegeLoading, setCollegeLoading] = useState(false);
  const [collegeError, setCollegeError] = useState("");
  const [showCollegeDropdown, setShowCollegeDropdown] = useState(false);
  const [showAudienceMenu, setShowAudienceMenu] = useState(false);
  const [pendingCaptionFocus, setPendingCaptionFocus] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);
  const collegeRef = useRef(null);
  const audienceRef = useRef(null);
  const mediaMenuRef = useRef(null);
  const textRef = useRef(null);
  const mediaContainerRef = useRef(null);
  const pressTimerRef = useRef(null);
  const isDraggingRef = useRef(false);
  const isThought = postMode === "thought";
  const effectiveAspect = useMemo(
    () => (aspectChoice === "auto" ? detectedAspect : aspectChoice),
    [aspectChoice, detectedAspect]
  );
  const previewAspectStyle = useMemo(
    () => ({ aspectRatio: resolveAspectRatioString(effectiveAspect) }),
    [effectiveAspect]
  );
  const previewFilterStyle = useMemo(
    () => ({ filter: buildFilterString(filterPreset, adjustments) }),
    [filterPreset, adjustments]
  );
  const trimmedText = text.trim();
  const canProceedStep1 = useMemo(() => {
    if (isThought) return trimmedText.length >= THOUGHT_MIN_LENGTH;
    return Boolean(mediaFile);
  }, [isThought, trimmedText.length, mediaFile]);
  const canProceedStep2 = useMemo(() => {
    if (isThought) return trimmedText.length >= THOUGHT_MIN_LENGTH;
    return Boolean(mediaFile) || trimmedText.length > 0;
  }, [isThought, trimmedText.length, mediaFile]);
  const hasEdits = useMemo(() => {
    if (!mediaFile) return false;
    const isDefaultAdjust =
      adjustments.brightness === DEFAULT_ADJUSTMENTS.brightness &&
      adjustments.contrast === DEFAULT_ADJUSTMENTS.contrast &&
      adjustments.saturation === DEFAULT_ADJUSTMENTS.saturation;
    const hasOverlay = Boolean(overlayText.trim());
    const hasFilter = filterPreset !== "normal";
    return hasOverlay || hasFilter || !isDefaultAdjust || aspectChoice !== "auto";
  }, [mediaFile, adjustments, overlayText, filterPreset, aspectChoice]);
  const defaultCollege = useMemo(() => {
    if (!currentUser) return null;
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
    if (!name) return null;
    return { name: String(name).trim(), id: id ? String(id) : "" };
  }, [currentUser]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    return () => {
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview);
      }
    };
  }, [mediaPreview]);

  useEffect(() => {
    return () => {
      if (editedPreviewUrl) {
        URL.revokeObjectURL(editedPreviewUrl);
      }
    };
  }, [editedPreviewUrl]);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!showMediaMenu) return undefined;
    const handleClick = (event) => {
      if (mediaMenuRef.current && !mediaMenuRef.current.contains(event.target)) {
        setShowMediaMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMediaMenu]);

  useEffect(() => {
    if (!pendingCaptionFocus || step !== 2) return undefined;
    const timeout = window.setTimeout(() => {
      textRef.current?.focus();
      setPendingCaptionFocus(false);
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [pendingCaptionFocus, step]);

  useEffect(() => {
    const handleAudienceOutside = (event) => {
      if (audienceRef.current && !audienceRef.current.contains(event.target)) {
        setShowAudienceMenu(false);
      }
    };
    document.addEventListener("mousedown", handleAudienceOutside);
    return () => document.removeEventListener("mousedown", handleAudienceOutside);
  }, []);

  useEffect(() => {
    if (!mediaFile) {
      setActiveTool("crop");
      setFilterPreset("normal");
      setAdjustments(DEFAULT_ADJUSTMENTS);
      setOverlayText("");
      setOverlaySize(32);
      setOverlayPosition({ x: 50, y: 50 });
    }
  }, [mediaFile]);

  useEffect(() => {
    setEditedMediaFile(null);
    setEditedPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [
    mediaFile,
    aspectChoice,
    filterPreset,
    adjustments,
    overlayText,
    overlaySize,
    overlayPosition,
  ]);

  useEffect(() => {
    if (!isThought) return;
    if (mediaFile || mediaPreview) {
      setMediaFile(null);
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview);
      }
      setMediaPreview(null);
      setImageLoading(false);
      setAspectChoice("auto");
      setDetectedAspect("4:5");
      setShowMediaMenu(false);
      setActiveTool("crop");
      setFilterPreset("normal");
      setAdjustments(DEFAULT_ADJUSTMENTS);
      setOverlayText("");
      setOverlaySize(32);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [isThought, mediaFile, mediaPreview]);

  useEffect(() => {
    if (!isOpen) return;
    if (selectedColleges.length > 0) return;
    if (defaultCollege) {
      setSelectedColleges([defaultCollege]);
    }
  }, [isOpen, selectedColleges.length, defaultCollege]);

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
    if (!isOpen || !showCollegeDropdown) return;
    const query = collegeInput.trim();
    if (query.length < 2) {
      setColleges([]);
      setCollegeLoading(false);
      setCollegeError("");
      return;
    }

    let isMounted = true;
    setCollegeLoading(true);
    setCollegeError("");
    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchColleges(query, { limit: 20 });
        if (!isMounted) return;
        const list = normalizeCollegeList(results);
        setColleges(list);
      } catch {
        if (isMounted) {
          setColleges([]);
          setCollegeError("Unable to load colleges. You can type manually.");
        }
      } finally {
        if (isMounted) setCollegeLoading(false);
      }
    }, COLLEGE_SEARCH_DEBOUNCE_MS);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [isOpen, showCollegeDropdown, collegeInput]);

  const resetForm = () => {
    setStep(1);
    setPostMode("post");
    setVisibility("universal");
    setText("");
    setIsAnonymous(false);
    setMediaFile(null);
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaPreview(null);
    setImageLoading(false);
    setAspectChoice("auto");
    setDetectedAspect("4:5");
    setShowMediaMenu(false);
    setActiveTool("crop");
    setFilterPreset("normal");
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setOverlayText("");
    setOverlaySize(32);
    setOverlayPosition({ x: 50, y: 50 });
    setEditedMediaFile(null);
    setPreviewLoading(false);
    setEditedPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCollegeInput("");
    setSelectedColleges([]);
    setShowCollegeDropdown(false);
    setShowAudienceMenu(false);
    setPendingCaptionFocus(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    resetForm();
    onClose?.();
  };

  const handleMediaSelect = async (e) => {
    if (isThought) {
      setToast({
        title: "Thought mode",
        message: "Media uploads are disabled for Thought posts.",
      });
      return;
    }
    const file = e.target.files[0];
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setToast({
        title: "Unsupported file",
        message: "Please upload a JPG, PNG, or WEBP image.",
      });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setToast({
        title: "Image too large",
        message: "Maximum upload size is 20MB.",
      });
      return;
    }
    const processed = await compressImageFile(file);
    setMediaFile(processed);
    setImageLoading(true);
    setAspectChoice("auto");
    setDetectedAspect("4:5");
    setShowMediaMenu(false);
    setActiveTool("crop");
    setFilterPreset("normal");
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setOverlayText("");
    setOverlaySize(32);
    setOverlayPosition({ x: 50, y: 50 });
    setMediaPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(processed);
    });
  };

  const clearMedia = useCallback(() => {
    setMediaFile(null);
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaPreview(null);
    setImageLoading(false);
    setAspectChoice("auto");
    setDetectedAspect("4:5");
    setShowMediaMenu(false);
    setActiveTool("crop");
    setFilterPreset("normal");
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setOverlayText("");
    setOverlaySize(32);
    setOverlayPosition({ x: 50, y: 50 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [mediaPreview]);

  const handlePreviewLoad = useCallback(
    (event) => {
      setImageLoading(false);
      const { naturalWidth, naturalHeight } = event.currentTarget;
      const detected = detectAspectRatio(naturalWidth, naturalHeight);
      setDetectedAspect(detected);
    },
    []
  );

  const buildEditedMedia = useCallback(async () => {
    if (!mediaFile || isThought) return null;
    let baseFile = mediaFile;
    try {
      baseFile = await createCroppedImage(baseFile, effectiveAspect);
    } catch {
      baseFile = mediaFile;
    }
    const isDefaultAdjust =
      adjustments.brightness === DEFAULT_ADJUSTMENTS.brightness &&
      adjustments.contrast === DEFAULT_ADJUSTMENTS.contrast &&
      adjustments.saturation === DEFAULT_ADJUSTMENTS.saturation;
    const hasOverlay = Boolean(overlayText.trim());
    const hasFilter = filterPreset !== "normal";
    if (!hasOverlay && !hasFilter && isDefaultAdjust) {
      return baseFile;
    }
    return applyImageEdits({
      file: baseFile,
      filterPreset,
      adjustments,
      overlayText,
      overlaySize,
      overlayPosition,
    });
  }, [
    mediaFile,
    isThought,
    effectiveAspect,
    adjustments,
    overlayText,
    overlaySize,
    overlayPosition,
    filterPreset,
  ]);

  const handleStepBack = () => {
    setStep((prev) => Math.max(1, prev - 1));
  };

  const handleStepNext = () => {
    if (step === 1 && canProceedStep1) {
      setStep(2);
      setPendingCaptionFocus(true);
      return;
    }
    if (step === 2 && canProceedStep2) {
      setStep(3);
    }
  };

  const updateOverlayPositionFromEvent = useCallback((event) => {
    const container = mediaContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0]?.clientX : event.clientX;
    const clientY = event.touches ? event.touches[0]?.clientY : event.clientY;
    if (clientX === undefined || clientY === undefined) return;
    const xPercent = ((clientX - rect.left) / rect.width) * 100;
    const yPercent = ((clientY - rect.top) / rect.height) * 100;
    setOverlayPosition({
      x: clampPercent(xPercent),
      y: clampPercent(yPercent),
    });
  }, []);

  const handleOverlayPointerDown = useCallback(
    (event) => {
      if (!overlayText.trim()) return;
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      pressTimerRef.current = setTimeout(() => {
        isDraggingRef.current = true;
        updateOverlayPositionFromEvent(event);
      }, 250);
    },
    [overlayText, updateOverlayPositionFromEvent]
  );

  const handleOverlayPointerMove = useCallback(
    (event) => {
      if (!isDraggingRef.current) return;
      updateOverlayPositionFromEvent(event);
    },
    [updateOverlayPositionFromEvent]
  );

  const handleOverlayPointerUp = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    if (!isOpen || step !== 3) return undefined;
    if (isThought || !mediaFile) {
      setEditedMediaFile(null);
      setEditedPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return undefined;
    }
    let isMounted = true;
    setPreviewLoading(true);
    buildEditedMedia()
      .then((edited) => {
        if (!isMounted) return;
        if (!edited) return;
        setEditedMediaFile(edited);
        setEditedPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(edited);
        });
      })
      .finally(() => {
        if (isMounted) setPreviewLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [isOpen, step, isThought, mediaFile, buildEditedMedia]);

  const handleSubmit = async () => {
    const trimmedText = text.trim();
    if (isThought) {
      if (trimmedText.length < THOUGHT_MIN_LENGTH) {
        setToast({
          title: "Add more detail",
          message: `Thought posts need at least ${THOUGHT_MIN_LENGTH} characters.`,
        });
        return;
      }
      if (trimmedText.length > THOUGHT_MAX_LENGTH) {
        setToast({
          title: "Thought too long",
          message: `Keep thoughts under ${THOUGHT_MAX_LENGTH} characters.`,
        });
        return;
      }
    } else if (!trimmedText && !mediaFile) {
      return;
    }
    if (!currentUser) return;
    const trimmedCollegeInput = collegeInput.trim();
    const fallbackColleges =
      trimmedCollegeInput && !isCollegeSelected({ name: trimmedCollegeInput })
        ? [...selectedColleges, { name: trimmedCollegeInput, id: "" }]
        : selectedColleges;
    const finalColleges = fallbackColleges.length > 0 ? fallbackColleges : [];
    if (visibility === "college" && finalColleges.length === 0) {
      setToast({
        title: "Add a college tag",
        message: "College-only posts need at least one college tag.",
      });
      return;
    }
    const primaryCollege = finalColleges[0];
    const collegeTagName = primaryCollege?.name || "";
    const collegeTagId = primaryCollege?.id || "";
    const collegeTags = finalColleges
      .map((tag) => tag.id || tag.name)
      .filter(Boolean);

    setLoading(true);
    try {
      let finalMedia = mediaFile;
      if (!isThought && mediaFile) {
        if (editedMediaFile) {
          finalMedia = editedMediaFile;
        } else {
          try {
            finalMedia = await buildEditedMedia();
          } catch {
            finalMedia = mediaFile;
          }
        }
      }
      await createPost(
        {
          content: trimmedText,
          isAnonymous,
          contentType: isThought ? "thought" : "post",
          visibility,
          authorId: currentUser.id,
          collegeTagName,
          collegeTagId,
          collegeTags,
          aspectRatio: !isThought && mediaFile ? effectiveAspect : undefined,
          authorCollegeId:
            currentUser.collegeGroupId ||
            currentUser.college_group_id ||
            currentUser.groupId ||
            currentUser.collegeGroup ||
            "",
        },
        isThought ? null : finalMedia
      );
      await loadPosts();
      setToast({ title: "Posted", message: "Your post is live on InCampus." });
      onCreated?.();
      handleClose();
    } catch (error) {
      setToast({
        title: "Upload failed",
        message: error.message || "Unable to post right now.",
      });
    } finally {
      setLoading(false);
    }
  };

  const userAvatar = currentUser?.profilePicUrl || ANONYMOUS_AVATAR;
  const selectedAudience =
    AUDIENCE_OPTIONS.find((option) => option.id === visibility) || AUDIENCE_OPTIONS[0];
  const previewPost = useMemo(() => {
    const authorName =
      currentUser?.fullName || currentUser?.username || currentUser?.name || "User";
    const authorId = currentUser?.id || currentUser?._id || "preview-author";
    const primaryCollege = selectedColleges[0];
    return {
      _id: "preview-post",
      id: "preview-post",
      content: trimmedText,
      createdAt: new Date().toISOString(),
      isAnonymous,
      visibility,
      authorId,
      author: {
        _id: authorId,
        fullName: authorName,
        username: currentUser?.username,
        profilePicUrl: userAvatar,
      },
      collegeTagName: primaryCollege?.name || "",
      mediaUrl: isThought ? "" : editedPreviewUrl || mediaPreview || "",
      aspectRatio: !isThought && mediaFile ? effectiveAspect : undefined,
      isPreview: true,
    };
  }, [
    currentUser,
    trimmedText,
    isAnonymous,
    visibility,
    selectedColleges,
    editedPreviewUrl,
    mediaPreview,
    isThought,
    mediaFile,
    effectiveAspect,
    userAvatar,
  ]);
  const isCollegeSelected = useCallback(
    (college) => {
      if (!college) return false;
      const id = String(college.id || "");
      const name = String(college.name || "").toLowerCase();
      return selectedColleges.some((tag) => {
        if (id && String(tag.id || "") === id) return true;
        return name && String(tag.name || "").toLowerCase() === name;
      });
    },
    [selectedColleges]
  );

  const filteredColleges = useMemo(() => {
    if (!collegeInput) return colleges.filter((college) => !isCollegeSelected(college));
    const query = collegeInput.toLowerCase();
    return colleges.filter((college) => {
      const name = String(college.name || "").toLowerCase();
      return name.includes(query) && !isCollegeSelected(college);
    });
  }, [colleges, collegeInput, isCollegeSelected]);

  const topMatches = useMemo(() => filteredColleges.slice(0, 5), [filteredColleges]);

  const addCollegeTag = (college) => {
    if (!college?.name) return;
    setSelectedColleges((prev) => {
      const id = String(college.id || "");
      const name = String(college.name || "").toLowerCase();
      const exists = prev.some((tag) => {
        if (id && String(tag.id || "") === id) return true;
        return name && String(tag.name || "").toLowerCase() === name;
      });
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
      if (next.length === 0 && defaultCollege) {
        return [defaultCollege];
      }
      return next;
    });
  };

  const handleCollegeChange = (value) => {
    setCollegeInput(value);
    setShowCollegeDropdown(true);
  };

  const handleCollegeKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const trimmed = collegeInput.trim();
    if (!trimmed) return;
    addCollegeTag({ name: trimmed, id: "" });
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <Motion.div
            id="create-post-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
            onClick={handleClose}
          >
            <Motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 220 }}
              className="relative w-full h-[100vh] max-w-2xl glass-card rounded-t-3xl p-6 pb-24 shadow-2xl overflow-y-auto sm:h-auto sm:max-h-[90vh] sm:rounded-3xl sm:pb-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={step === 1 ? handleClose : handleStepBack}
                  className="h-9 w-9 rounded-full text-[#b9b4c7] hover:text-[#faf0e6] hover:bg-white/5 flex items-center justify-center"
                  aria-label={step === 1 ? "Close" : "Back"}
                >
                  <i className={`fa-solid ${step === 1 ? "fa-xmark" : "fa-chevron-left"}`}></i>
                </button>
                <div className="text-center">
                  <p className="text-sm font-semibold text-[#faf0e6]">
                    {step === 1 ? "New Post" : step === 2 ? "Add Details" : "Preview"}
                  </p>
                  <p className="text-[11px] text-[#b9b4c7]">{step}/3</p>
                </div>
                <div className="w-9"></div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (step !== 3) return;
                  handleSubmit();
                }}
                className="mt-5 space-y-6"
              >
                <AnimatePresence mode="wait">
                  {step === 1 && (
                    <Motion.div
                      key="step-1"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      className="space-y-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setPostMode("post")}
                            className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
                              postMode === "post"
                                ? "bg-white/15 text-[#faf0e6]"
                                : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                            }`}
                          >
                            Post
                          </button>
                          <button
                            type="button"
                            onClick={() => setPostMode("thought")}
                            className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
                              postMode === "thought"
                                ? "bg-white/15 text-[#faf0e6]"
                                : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                            }`}
                          >
                            Thought
                          </button>
                        </div>
                        {isThought && (
                          <span className="text-[11px] text-[#b9b4c7]">
                            {text.trim().length}/{THOUGHT_MAX_LENGTH}
                          </span>
                        )}
                      </div>

                      {!isThought && (
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-4">
                          {mediaPreview ? (
                            <div
                              className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20"
                              style={previewAspectStyle}
                              ref={mediaContainerRef}
                              onPointerDown={handleOverlayPointerDown}
                              onPointerMove={handleOverlayPointerMove}
                              onPointerUp={handleOverlayPointerUp}
                              onPointerLeave={handleOverlayPointerUp}
                            >
                              {imageLoading && (
                                <div className="absolute inset-0 animate-pulse bg-white/10"></div>
                              )}
                              <img
                                src={mediaPreview}
                                alt="Preview"
                                className="w-full h-full object-cover"
                                style={previewFilterStyle}
                                onLoad={handlePreviewLoad}
                                onError={() => setImageLoading(false)}
                              />
                              {overlayText.trim() && (
                                <div
                                  className="absolute flex items-center justify-center pointer-events-none px-6"
                                  style={{
                                    left: `${overlayPosition.x}%`,
                                    top: `${overlayPosition.y}%`,
                                    transform: "translate(-50%, -50%)",
                                  }}
                                >
                                  <p
                                    className="text-center font-semibold text-[#faf0e6] drop-shadow-[0_3px_8px_rgba(0,0,0,0.45)] whitespace-pre-wrap"
                                    style={{ fontSize: `${overlaySize}px` }}
                                  >
                                    {overlayText}
                                  </p>
                                </div>
                              )}
                              <div
                                ref={mediaMenuRef}
                                className="absolute top-3 right-3 flex flex-col items-end gap-2"
                              >
                                <button
                                  type="button"
                                  onClick={() => setShowMediaMenu((prev) => !prev)}
                                  className="h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                                  aria-label="Media options"
                                >
                                  <i className="fa-solid fa-ellipsis-vertical text-xs"></i>
                                </button>
                                {showMediaMenu && (
                                  <div className="w-52 rounded-2xl glass-card border border-white/10 overflow-hidden">
                                    <div className="px-3 pt-3 pb-2">
                                      <p className="text-[11px] uppercase tracking-[0.3em] text-[#b9b4c7]">
                                        Media options
                                      </p>
                                    </div>
                                    <div className="px-3 pb-2">
                                      <p className="text-[10px] uppercase tracking-[0.2em] text-[#b9b4c7] mb-2">
                                        Aspect ratio
                                      </p>
                                      <div className="space-y-1">
                                        {ASPECT_OPTIONS.map((option) => (
                                          <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => {
                                              setAspectChoice(option.id);
                                              setShowMediaMenu(false);
                                            }}
                                            className={`w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-colors ${
                                              aspectChoice === option.id
                                                ? "bg-white/15 text-[#faf0e6]"
                                                : "text-[#b9b4c7] hover:bg-white/10 hover:text-[#faf0e6]"
                                            }`}
                                          >
                                            <span>
                                              {option.id === "auto"
                                                ? `Auto (${detectedAspect})`
                                                : option.label}
                                            </span>
                                            {aspectChoice === option.id && (
                                              <i className="fa-solid fa-check text-[10px]"></i>
                                            )}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowMediaMenu(false);
                                        setStep(2);
                                        setPendingCaptionFocus(true);
                                      }}
                                      className="w-full text-left px-4 py-2 text-xs text-[#b9b4c7] hover:bg-white/10"
                                    >
                                      <i className="fa-solid fa-pen mr-2"></i>
                                      Add caption
                                    </button>
                                    <button
                                      type="button"
                                      onClick={clearMedia}
                                      className="w-full text-left px-4 py-2 text-xs text-rose-200 hover:bg-white/10"
                                    >
                                      <i className="fa-solid fa-trash-can mr-2"></i>
                                      Remove image
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                              <div className="h-14 w-14 rounded-full border border-white/10 bg-white/10 flex items-center justify-center text-[#faf0e6]">
                                <i className="fa-solid fa-image text-xl"></i>
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-[#faf0e6]">
                                  Add a photo
                                </p>
                                <p className="text-xs text-[#b9b4c7]">
                                  Upload a single image to start editing.
                                </p>
                              </div>
                            </div>
                          )}

                          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#faf0e6]">
                            <i className="fa-solid fa-image"></i>
                            <span>{mediaPreview ? "Replace image" : "Add Media"}</span>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={handleMediaSelect}
                            />
                          </label>
                        </div>
                      )}

                      {isThought && (
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-3">
                          <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Share a thought with your campus..."
                            rows={6}
                            maxLength={THOUGHT_MAX_LENGTH}
                            className="w-full rounded-2xl glass-input p-4 text-sm placeholder-[#b9b4c7] resize-none"
                          />
                          <div className="text-right text-xs text-[#b9b4c7]">
                            {text.trim().length}/{THOUGHT_MAX_LENGTH}
                          </div>
                        </div>
                      )}

                      {!isThought && mediaPreview && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 overflow-x-auto pb-1">
                            {EDIT_TOOL_OPTIONS.map((tool) => (
                              <button
                                key={tool.id}
                                type="button"
                                onClick={() => setActiveTool(tool.id)}
                                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                                  activeTool === tool.id
                                    ? "bg-white/15 text-[#faf0e6]"
                                    : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                                }`}
                              >
                                <i className={`fa-solid ${tool.icon}`}></i>
                                {tool.label}
                              </button>
                            ))}
                          </div>

                          {activeTool === "crop" && (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
                              <p className="text-xs uppercase tracking-[0.25em] text-[#b9b4c7]">
                                Aspect ratio
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {ASPECT_OPTIONS.map((option) => (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setAspectChoice(option.id)}
                                    className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
                                      aspectChoice === option.id
                                        ? "bg-white/15 text-[#faf0e6]"
                                        : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                                    }`}
                                  >
                                    {option.id === "auto"
                                      ? `Auto (${detectedAspect})`
                                      : option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {activeTool === "adjust" && (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
                              {[
                                { id: "brightness", label: "Brightness", min: 70, max: 130 },
                                { id: "contrast", label: "Contrast", min: 80, max: 130 },
                                { id: "saturation", label: "Saturation", min: 80, max: 150 },
                              ].map((item) => (
                                <div key={item.id} className="flex items-center gap-3">
                                  <span className="w-20 text-xs text-[#b9b4c7]">
                                    {item.label}
                                  </span>
                                  <input
                                    type="range"
                                    min={item.min}
                                    max={item.max}
                                    value={adjustments[item.id]}
                                    onChange={(e) =>
                                      setAdjustments((prev) => ({
                                        ...prev,
                                        [item.id]: Number(e.target.value),
                                      }))
                                    }
                                    className="flex-1"
                                  />
                                  <span className="w-10 text-right text-xs text-[#b9b4c7]">
                                    {adjustments[item.id]}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {activeTool === "filter" && (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {FILTER_PRESETS.map((preset) => (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => setFilterPreset(preset.id)}
                                    className={`rounded-2xl border px-3 py-2 text-xs transition-colors ${
                                      filterPreset === preset.id
                                        ? "border-white/30 bg-white/15 text-[#faf0e6]"
                                        : "border-white/10 bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                                    }`}
                                  >
                                    <div
                                      className="h-12 w-full rounded-xl bg-white/10 mb-2"
                                      style={{
                                        backgroundImage: mediaPreview ? `url(${mediaPreview})` : undefined,
                                        backgroundSize: "cover",
                                        backgroundPosition: "center",
                                        filter: preset.filter === "none" ? "none" : preset.filter,
                                      }}
                                    ></div>
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {activeTool === "text" && (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                              <label className="text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                                Overlay text
                              </label>
                              <input
                                type="text"
                                value={overlayText}
                                onChange={(e) => setOverlayText(e.target.value)}
                                placeholder="Add text on image"
                                className="w-full rounded-2xl glass-input px-4 py-2.5 text-sm"
                                maxLength={60}
                              />
                              <div className="flex items-center gap-3">
                                <span className="w-16 text-xs text-[#b9b4c7]">Size</span>
                                <input
                                  type="range"
                                  min={16}
                                  max={56}
                                  value={overlaySize}
                                  onChange={(e) => setOverlaySize(Number(e.target.value))}
                                  className="flex-1"
                                />
                                <span className="w-10 text-right text-xs text-[#b9b4c7]">
                                  {overlaySize}
                                </span>
                              </div>
                              {overlayText.trim() && (
                                <div className="space-y-2">
                                  <p className="text-[11px] text-[#b9b4c7]">
                                    Long press on the image to place text.
                                  </p>
                                  <div className="grid grid-cols-3 gap-2 max-w-[180px]">
                                    <div></div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOverlayPosition((prev) => ({
                                          ...prev,
                                          y: clampPercent(prev.y - 3),
                                        }))
                                      }
                                      className="h-8 rounded-xl border border-white/10 bg-white/5 text-xs text-[#faf0e6]"
                                    >
                                      <i className="fa-solid fa-arrow-up"></i>
                                    </button>
                                    <div></div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOverlayPosition((prev) => ({
                                          ...prev,
                                          x: clampPercent(prev.x - 3),
                                        }))
                                      }
                                      className="h-8 rounded-xl border border-white/10 bg-white/5 text-xs text-[#faf0e6]"
                                    >
                                      <i className="fa-solid fa-arrow-left"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setOverlayPosition({ x: 50, y: 50 })}
                                      className="h-8 rounded-xl border border-white/10 bg-white/5 text-[11px] text-[#faf0e6]"
                                    >
                                      Center
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOverlayPosition((prev) => ({
                                          ...prev,
                                          x: clampPercent(prev.x + 3),
                                        }))
                                      }
                                      className="h-8 rounded-xl border border-white/10 bg-white/5 text-xs text-[#faf0e6]"
                                    >
                                      <i className="fa-solid fa-arrow-right"></i>
                                    </button>
                                    <div></div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOverlayPosition((prev) => ({
                                          ...prev,
                                          y: clampPercent(prev.y + 3),
                                        }))
                                      }
                                      className="h-8 rounded-xl border border-white/10 bg-white/5 text-xs text-[#faf0e6]"
                                    >
                                      <i className="fa-solid fa-arrow-down"></i>
                                    </button>
                                    <div></div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </Motion.div>
                  )}

                  {step === 2 && (
                    <Motion.div
                      key="step-2"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      className="space-y-5"
                    >
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                          Caption
                        </label>
                        <textarea
                          ref={textRef}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          placeholder={
                            isThought
                              ? "Share a thought with your campus..."
                              : "What's happening on campus?\nShare updates, notes, or moments..."
                          }
                          rows={5}
                          maxLength={isThought ? THOUGHT_MAX_LENGTH : undefined}
                          className="w-full rounded-2xl glass-input p-4 text-sm placeholder-[#b9b4c7] resize-none"
                        />
                        {isThought && (
                          <div className="text-right text-xs text-[#b9b4c7]">
                            {text.trim().length}/{THOUGHT_MAX_LENGTH}
                          </div>
                        )}
                      </div>

                      {!isThought && mediaPreview && (
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-left"
                        >
                          <img
                            src={mediaPreview}
                            alt="Media preview"
                            className="h-16 w-16 rounded-xl object-cover"
                            style={previewFilterStyle}
                          />
                          <div>
                            <p className="text-sm font-semibold text-[#faf0e6]">
                              Edit media
                            </p>
                            <p className="text-xs text-[#b9b4c7]">
                              Tap to adjust crop, filters, or text.
                            </p>
                          </div>
                        </button>
                      )}

                      <div className="space-y-2 relative" ref={audienceRef}>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                          Audience
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowAudienceMenu((prev) => !prev)}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-[#faf0e6] flex items-center justify-between"
                        >
                          <span>{selectedAudience.label}</span>
                          <i className="fa-solid fa-chevron-down text-xs"></i>
                        </button>
                        {showAudienceMenu && (
                          <div className="absolute left-0 right-0 mt-2 rounded-2xl glass-card border border-white/10 z-20 overflow-hidden">
                            {AUDIENCE_OPTIONS.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => {
                                  setVisibility(option.id);
                                  setShowAudienceMenu(false);
                                }}
                                className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                                  visibility === option.id
                                    ? "bg-white/15 text-[#faf0e6]"
                                    : "text-[#b9b4c7] hover:bg-white/10 hover:text-[#faf0e6]"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 relative" ref={collegeRef}>
                        <label
                          htmlFor="post-college-tag"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                        >
                          College Tags
                        </label>
                        <input
                          id="post-college-tag"
                          type="text"
                          value={collegeInput}
                          onChange={(e) => handleCollegeChange(e.target.value)}
                          onFocus={() => setShowCollegeDropdown(true)}
                          onKeyDown={handleCollegeKeyDown}
                          placeholder="Tag College (Optional)"
                          className="w-full rounded-2xl glass-input px-4 py-2.5 text-sm"
                        />
                        <div className="flex flex-wrap gap-2">
                          {selectedColleges.map((college) => (
                            <button
                              key={`${college.name}-${college.id || "manual"}`}
                              type="button"
                              onClick={() => removeCollegeTag(college)}
                              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] text-[#faf0e6]"
                            >
                              <span className="truncate">{college.name}</span>
                              <i className="fa-solid fa-xmark text-[10px]"></i>
                            </button>
                          ))}
                        </div>
                        <p className="text-[11px] text-[#b9b4c7]">
                          Search and add multiple colleges. Press Enter to add a custom tag.
                        </p>
                        {showCollegeDropdown && (
                          <div className="absolute left-0 right-0 mt-2 rounded-2xl glass-card max-h-64 overflow-y-auto z-20">
                            {collegeLoading ? (
                              <div className="p-3 space-y-2">
                                {[1, 2, 3, 4, 5].map((i) => (
                                  <div
                                    key={i}
                                    className="h-8 rounded-xl bg-white/10 animate-pulse"
                                  ></div>
                                ))}
                              </div>
                            ) : collegeError ? (
                              <div className="p-3 text-sm text-[#b9b4c7]">
                                {collegeError}
                              </div>
                            ) : topMatches.length > 0 ? (
                              <div className="p-2">
                                {topMatches.map((college) => (
                                  <button
                                    key={`${college.name}-${college.id || "manual"}`}
                                    type="button"
                                    onClick={() => addCollegeTag(college)}
                                    className="w-full text-left px-3 py-2 rounded-xl text-sm text-[#faf0e6] hover:bg-white/10 transition-colors"
                                  >
                                    {college.name}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="p-3 text-sm text-[#b9b4c7]">
                                No matches. Press Enter to add "{collegeInput}".
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <div>
                          <p className="text-xs font-semibold text-[#faf0e6]">
                            Post anonymously
                          </p>
                          <p className="text-[11px] text-[#b9b4c7]">
                            Hide your identity for this post.
                          </p>
                        </div>
                        <label className="relative inline-flex cursor-pointer items-center">
                          <input
                            type="checkbox"
                            checked={isAnonymous}
                            onChange={(e) => setIsAnonymous(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="h-6 w-11 rounded-full bg-white/10 peer-checked:bg-[#5c5470] transition-colors"></div>
                          <div className="dot absolute left-1 top-1 h-4 w-4 rounded-full bg-[#faf0e6] transition-transform peer-checked:translate-x-full"></div>
                        </label>
                      </div>
                    </Motion.div>
                  )}

                  {step === 3 && (
                    <Motion.div
                      key="step-3"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      className="space-y-4"
                    >
                      {previewLoading ? (
                        <div className="glass-card rounded-3xl p-6 lg:p-4 animate-pulse">
                          <div className="h-4 bg-white/10 rounded w-3/4 mb-4"></div>
                          <div className="h-28 bg-white/10 rounded mb-4"></div>
                          <div className="h-4 bg-white/10 rounded w-1/2"></div>
                        </div>
                      ) : (
                        <Post post={previewPost} isPreview />
                      )}
                      {hasEdits && !isThought && (
                        <p className="text-xs text-[#b9b4c7]">
                          Your edits are applied to the final upload.
                        </p>
                      )}
                    </Motion.div>
                  )}
                </AnimatePresence>

                <div className="sticky bottom-4 flex flex-col gap-3 sm:flex-row sm:justify-between bg-black/30 backdrop-blur rounded-2xl p-3">
                  {step === 1 && (
                    <Motion.button
                      type="button"
                      onClick={handleStepNext}
                      disabled={!canProceedStep1}
                      className="liquid-button rounded-2xl px-5 py-3 text-sm font-semibold text-[#faf0e6] disabled:opacity-50 disabled:cursor-not-allowed"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Next
                    </Motion.button>
                  )}
                  {step === 2 && (
                    <Motion.button
                      type="button"
                      onClick={handleStepNext}
                      disabled={
                        !canProceedStep2 ||
                        (visibility === "college" && selectedColleges.length === 0)
                      }
                      className="liquid-button rounded-2xl px-5 py-3 text-sm font-semibold text-[#faf0e6] disabled:opacity-50 disabled:cursor-not-allowed"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Preview
                    </Motion.button>
                  )}
                  {step === 3 && (
                    <>
                      <Motion.button
                        type="button"
                        onClick={handleStepBack}
                        className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-[#faf0e6]"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        Back
                      </Motion.button>
                      <Motion.button
                        type="submit"
                        disabled={
                          loading ||
                          (visibility === "college" && selectedColleges.length === 0) ||
                          (isThought
                            ? text.trim().length < THOUGHT_MIN_LENGTH
                            : !mediaFile && !text.trim())
                        }
                        className="liquid-button rounded-2xl px-5 py-3 text-sm font-semibold text-[#faf0e6] disabled:opacity-50 disabled:cursor-not-allowed"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        {loading ? "Posting..." : "Share"}
                      </Motion.button>
                    </>
                  )}
                </div>
              </form>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <Motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-6 right-4 z-[70] toast-card rounded-2xl px-4 py-3 text-sm text-[#faf0e6]"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7]">{toast.title}</p>
            <p className="mt-1">{toast.message}</p>
          </Motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
