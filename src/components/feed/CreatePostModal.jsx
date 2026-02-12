import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { createPost } from "../../services/api";
import { compressImageFile } from "../../utils/media";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const THOUGHT_MIN_LENGTH = 3;
const THOUGHT_MAX_LENGTH = 2000;

export default function CreatePostModal({ isOpen, onClose, onCreated }) {
  const { currentUser } = useAuth();
  const { loadPosts } = useApp();
  const [postMode, setPostMode] = useState("post");
  const [visibility, setVisibility] = useState("universal");
  const [text, setText] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [collegeInput, setCollegeInput] = useState("");
  const [selectedColleges, setSelectedColleges] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [collegeLoading, setCollegeLoading] = useState(false);
  const [collegeError, setCollegeError] = useState("");
  const [showCollegeDropdown, setShowCollegeDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);
  const collegeRef = useRef(null);
  const isThought = postMode === "thought";
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
    if (!isThought) return;
    if (mediaFile || mediaPreview) {
      setMediaFile(null);
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview);
      }
      setMediaPreview(null);
      setImageLoading(false);
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
    if (!isOpen) return;
    let isMounted = true;
    const controller = new AbortController();

    const normalizeCollege = (item) => {
      if (!item) return null;
      if (typeof item === "string") {
        const name = item.trim();
        return name ? { name, id: "" } : null;
      }
      if (typeof item === "object") {
        const name =
          item.name ||
          item.college ||
          item.university ||
          item.institution ||
          item.school ||
          item.title ||
          item.value ||
          item.label ||
          item.collegeName ||
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

    const extractCollegeList = (data) => {
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
      return [];
    };

    const loadCollegesFromPackage = async () => {
      try {
        const module = await import("indian-colleges");
        const getAll =
          module.getAllColleges ||
          module.default?.getAllColleges ||
          module.default?.getAll;
        if (typeof getAll !== "function") return null;
        const data = getAll();
        const list = extractCollegeList(data);
        return list.length > 0 ? list : null;
      } catch {
        return null;
      }
    };

    const loadCollegesFromApi = async () => {
      const res = await fetch("https://colleges-api.onrender.com/colleges", {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Failed to load colleges.");
      const data = await res.json();
      return extractCollegeList(data);
    };

    const loadColleges = async () => {
      setCollegeLoading(true);
      setCollegeError("");
      try {
        const cached = sessionStorage.getItem("incampusCollegeOptions");
        if (cached) {
          const list = JSON.parse(cached);
          if (Array.isArray(list) && list.length > 0) {
            if (isMounted) setColleges(list);
            setCollegeLoading(false);
            return;
          }
        }

        let list = await loadCollegesFromPackage();
        if (!list || list.length === 0) {
          list = await loadCollegesFromApi();
        }

        if (isMounted) {
          setColleges(list);
          sessionStorage.setItem("incampusCollegeOptions", JSON.stringify(list));
        }
      } catch {
        if (isMounted) {
          setCollegeError("Unable to load colleges. You can type manually.");
        }
      } finally {
        if (isMounted) setCollegeLoading(false);
      }
    };

    loadColleges();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [isOpen]);

  const resetForm = () => {
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
    setCollegeInput("");
    setSelectedColleges([]);
    setShowCollegeDropdown(false);
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
    if (file.size > 10 * 1024 * 1024) {
      setToast({
        title: "Image too large",
        message: "Please upload an image under 10MB.",
      });
      return;
    }
    const processed = await compressImageFile(file);
    setMediaFile(processed);
    setImageLoading(true);
    setMediaPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(processed);
    });
  };

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
          authorCollegeId:
            currentUser.collegeGroupId ||
            currentUser.college_group_id ||
            currentUser.groupId ||
            currentUser.collegeGroup ||
            "",
        },
        isThought ? null : mediaFile
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
                <div className="flex items-center gap-3">
                  <img
                    src={isAnonymous ? ANONYMOUS_AVATAR : userAvatar}
                    alt="Profile"
                    className="h-10 w-10 rounded-full object-cover"
                  />
                  <div>
                    <p className="text-sm font-semibold text-[#faf0e6]">Create Post</p>
                    <p className="text-[11px] text-[#b9b4c7]">Share with your campus</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-xl text-[#b9b4c7] hover:text-[#faf0e6]"
                >
                  &times;
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit();
                }}
                className="mt-5 space-y-5"
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
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    isThought
                      ? "Share a thought with your campus..."
                      : "What's happening on campus?\nShare updates, notes, or moments..."
                  }
                  rows={4}
                  maxLength={isThought ? THOUGHT_MAX_LENGTH : undefined}
                  className="w-full rounded-2xl glass-input p-4 text-sm placeholder-[#b9b4c7] resize-none"
                />

                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                    Visibility
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "universal", label: "🌍 Universal" },
                      { id: "college", label: "🏫 College Only" },
                      { id: "private", label: "🔒 Friends Only" },
                    ].map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setVisibility(option.id)}
                        className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
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
                        <div className="p-3 text-sm text-[#b9b4c7]">{collegeError}</div>
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

                {!isThought && (
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#faf0e6]">
                      <i className="fa-solid fa-image"></i>
                      <span>Add Media</span>
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

                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-[#faf0e6]">Post anonymously</p>
                    <p className="text-[11px] text-[#b9b4c7]">Hide your identity for this post.</p>
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

                <AnimatePresence>
                  {(text.trim() || mediaPreview) && (
                    <Motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 12 }}
                      className="glass-card rounded-3xl p-5 border border-white/10"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={isAnonymous ? ANONYMOUS_AVATAR : userAvatar}
                          alt="Preview avatar"
                          className="h-10 w-10 rounded-full object-cover"
                        />
                        <div>
                          <p className="font-semibold text-[#faf0e6]">
                            {isAnonymous
                              ? "Anonymous Student"
                              : currentUser?.fullName || currentUser?.username || "User"}
                          </p>
                          <small className="text-[#b9b4c7] flex flex-wrap items-center gap-2 text-xs">
                            <span>Just now</span>
                            {isThought && (
                              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] text-[#faf0e6]">
                                Thought
                              </span>
                            )}
                            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] text-[#faf0e6]">
                              {visibility === "college"
                                ? "College Only"
                                : visibility === "private"
                                  ? "Friends Only"
                                  : "Universal"}
                            </span>
                            {selectedColleges.length > 0 && (
                              <>
                                <span className="text-[#b9b4c7]">|</span>
                                <span className="inline-flex items-center gap-2 flex-wrap max-w-[320px]">
                                  {selectedColleges.map((college) => (
                                    <span
                                      key={`${college.name}-${college.id || "manual"}`}
                                      className="inline-flex items-center gap-1"
                                    >
                                      <i className="fa-solid fa-school text-[10px]"></i>
                                      <span className="truncate">{college.name}</span>
                                    </span>
                                  ))}
                                </span>
                              </>
                            )}
                          </small>
                        </div>
                      </div>
                      {text.trim() && (
                        <p className="mt-4 text-sm text-[#faf0e6] whitespace-pre-wrap">
                          {text}
                        </p>
                      )}
                      {mediaPreview && (
                        <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/10">
                          {imageLoading && (
                            <div className="absolute inset-0 animate-pulse bg-white/10"></div>
                          )}
                          <img
                            src={mediaPreview}
                            alt="Preview"
                            className="w-full max-h-80 object-cover"
                            onLoad={() => setImageLoading(false)}
                            onError={() => setImageLoading(false)}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setMediaFile(null);
                              if (mediaPreview) {
                                URL.revokeObjectURL(mediaPreview);
                              }
                              setMediaPreview(null);
                              setImageLoading(false);
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            className="absolute top-3 right-3 rounded-full bg-black/60 px-2 py-1 text-xs text-white hover:bg-red-500"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </Motion.div>
                  )}
                </AnimatePresence>

                <div className="sticky bottom-4 flex flex-col gap-3 sm:flex-row sm:justify-end bg-black/30 backdrop-blur rounded-2xl p-3">
                  <Motion.button
                    type="submit"
                    disabled={
                      loading ||
                      (visibility === "college" && selectedColleges.length === 0) ||
                      (isThought
                        ? text.trim().length < THOUGHT_MIN_LENGTH
                        : !text.trim() && !mediaFile)
                    }
                    className="liquid-button rounded-2xl px-5 py-3 text-sm font-semibold text-[#faf0e6] disabled:opacity-50 disabled:cursor-not-allowed"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? "Posting..." : "Post"}
                  </Motion.button>
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
