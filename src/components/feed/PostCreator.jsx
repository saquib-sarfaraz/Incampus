import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { createPost, searchColleges } from "../../services/api";
import { compressImageFile } from "../../utils/media";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";
const COLLEGE_SEARCH_DEBOUNCE_MS = 150;
const THOUGHT_MIN_LENGTH = 3;
const THOUGHT_MAX_LENGTH = 2000;

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
  return [];
};

export default function PostCreator() {
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
  const [mediaError, setMediaError] = useState("");
  const [loading, setLoading] = useState(false);
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
    if (selectedColleges.length > 0) return;
    if (defaultCollege) {
      setSelectedColleges([defaultCollege]);
    }
  }, [selectedColleges.length, defaultCollege]);

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
    }, COLLEGE_SEARCH_DEBOUNCE_MS);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [collegeInput]);

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
      setMediaError("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [isThought, mediaFile, mediaPreview]);

  useEffect(() => {
    if (!isThought || !mediaError) return;
    const length = text.trim().length;
    if (length >= THOUGHT_MIN_LENGTH && length <= THOUGHT_MAX_LENGTH) {
      setMediaError("");
    }
  }, [isThought, mediaError, text]);

  const handleMediaSelect = async (e) => {
    if (isThought) {
      setMediaError("Media uploads are disabled for Thought posts.");
      return;
    }
    const file = e.target.files[0];
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setMediaError("Only JPG, PNG, or WEBP images are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMediaError("Please upload an image under 10MB.");
      return;
    }
    setMediaError("");
    const processed = await compressImageFile(file);
    setMediaFile(processed);
    setImageLoading(true);
    setMediaPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(processed);
    });
  };

  const submitPost = async () => {
    const trimmedText = text.trim();
    if (isThought) {
      if (trimmedText.length < THOUGHT_MIN_LENGTH) {
        setMediaError(`Thought posts need at least ${THOUGHT_MIN_LENGTH} characters.`);
        return;
      }
      if (trimmedText.length > THOUGHT_MAX_LENGTH) {
        setMediaError(`Keep thoughts under ${THOUGHT_MAX_LENGTH} characters.`);
        return;
      }
    } else if (!trimmedText && !mediaFile) {
      return;
    }
    if (!currentUser) return;
    const trimmedCollegeInput = collegeInput.trim();
    const finalColleges =
      trimmedCollegeInput && !selectedColleges.some((tag) => tag.name === trimmedCollegeInput)
        ? [...selectedColleges, { name: trimmedCollegeInput, id: "" }]
        : selectedColleges;
    if (visibility === "college" && finalColleges.length === 0) {
      setMediaError("College-only posts need at least one college tag.");
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

      setText("");
      setMediaFile(null);
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview);
      }
      setMediaPreview(null);
      setImageLoading(false);
      setIsAnonymous(false);
      setPostMode("post");
      setVisibility("universal");
      setCollegeInput("");
      setSelectedColleges([]);
      setShowCollegeDropdown(false);
      setMediaError("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await loadPosts();
    } catch (error) {
      alert(error.message || "Failed to create post");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitPost();
  };

  const removeImage = () => {
    setMediaFile(null);
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaPreview(null);
    setImageLoading(false);
    setMediaError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
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
    <Motion.div
      id="post-creator"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6"
    >
      <div className="glass-card glass-hover rounded-3xl p-4 transition-all duration-300 ease-out">
        <form onSubmit={handleSubmit}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
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
          <div className="flex items-start space-x-3 mb-4">
            <img
              src={isAnonymous ? ANONYMOUS_AVATAR : userAvatar}
              alt="Profile"
              className="w-10 h-10 rounded-full object-cover"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                isThought
                  ? "Share a thought with your campus..."
                  : "What's happening on campus?\nShare updates, notes, or moments..."
              }
              rows="3"
              maxLength={isThought ? THOUGHT_MAX_LENGTH : undefined}
              className="flex-1 rounded-2xl glass-input p-3 text-sm placeholder-[#b9b4c7] resize-none"
            />
          </div>
          {mediaError && isThought && (
            <p className="text-[11px] text-red-300 mb-3">{mediaError}</p>
          )}

          <div className="mb-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7] mb-2">
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

          <div className="mb-4 relative" ref={collegeRef}>
            <label
              htmlFor="post-creator-college"
              className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7] mb-2"
            >
              College Tags
            </label>
            <input
              id="post-creator-college"
              type="text"
              value={collegeInput}
              onChange={(e) => handleCollegeChange(e.target.value)}
              onFocus={() => setShowCollegeDropdown(true)}
              onKeyDown={handleCollegeKeyDown}
              placeholder="Tag College (Optional)"
              className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-2">
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
            <p className="text-[11px] text-[#b9b4c7] mt-1">
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

          <AnimatePresence>
            {(text.trim() || mediaPreview) && (
              <Motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="glass-card rounded-3xl p-5 border border-white/10 mb-4"
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
                  <p className="mt-4 text-sm text-[#faf0e6] whitespace-pre-wrap">{text}</p>
                )}
                {mediaPreview && (
                  <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/10">
                    {imageLoading && (
                      <div className="absolute inset-0 animate-pulse bg-white/10"></div>
                    )}
                    <img
                      src={mediaPreview}
                      alt="Preview"
                      className="w-full max-h-96 object-cover"
                      onLoad={() => setImageLoading(false)}
                      onError={() => setImageLoading(false)}
                    />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute top-2 right-2 rounded-full bg-black/60 text-white p-2 hover:bg-red-500 transition-colors"
                    >
                      <i className="fa-solid fa-times"></i>
                    </button>
                  </div>
                )}
              </Motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pt-4 border-t border-white/10 space-y-3 sm:space-y-0">
            {!isThought && (
              <div className="flex flex-col items-start space-y-1">
                <label
                  htmlFor="photo-upload"
                  className="cursor-pointer text-[#b9b4c7] hover:text-[#faf0e6] transition-colors p-2 rounded-full hover:bg-white/5"
                >
                  <i className="fa-solid fa-image text-lg"></i>
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="photo-upload"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleMediaSelect}
                  />
                </label>
                {mediaError && (
                  <span className="text-[11px] text-red-300">{mediaError}</span>
                )}
              </div>
            )}

            <div className="flex items-center space-x-4 w-full sm:w-auto justify-between sm:justify-end">
              <label className="flex items-center cursor-pointer">
                <span className="text-xs font-medium text-[#b9b4c7] mr-2">
                  Post Anonymously
                </span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-6 bg-white/10 rounded-full peer peer-checked:bg-[#5c5470] transition-colors"></div>
                  <div className="dot absolute left-1 top-1 bg-[#faf0e6] w-4 h-4 rounded-full transition-transform peer-checked:translate-x-full"></div>
                </div>
              </label>
              <Motion.button
                type="submit"
                disabled={
                  loading ||
                  (visibility === "college" && selectedColleges.length === 0) ||
                  (isThought
                    ? text.trim().length < THOUGHT_MIN_LENGTH
                    : !text.trim() && !mediaFile)
                }
                className="liquid-button text-[#faf0e6] px-5 py-2 rounded-full font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {loading ? "Posting..." : "Post"}
              </Motion.button>
            </div>
          </div>
        </form>
      </div>
    </Motion.div>
  );
}
