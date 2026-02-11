import { useState, useRef, useEffect, useMemo } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { createPost } from "../../services/api";
import { compressImageFile } from "../../utils/media";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

export default function CreatePostModal({ isOpen, onClose, onCreated }) {
  const { currentUser } = useAuth();
  const { loadPosts } = useApp();
  const [text, setText] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [collegeInput, setCollegeInput] = useState("");
  const [collegeTagId, setCollegeTagId] = useState("");
  const [colleges, setColleges] = useState([]);
  const [collegeLoading, setCollegeLoading] = useState(false);
  const [collegeError, setCollegeError] = useState("");
  const [showCollegeDropdown, setShowCollegeDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);
  const collegeRef = useRef(null);

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
    if (!isOpen) return;
    if (!collegeInput && currentUser?.university) {
      setCollegeInput(currentUser.university);
      setCollegeTagId("");
    }
  }, [isOpen, currentUser?.university, collegeInput]);

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
    setText("");
    setIsAnonymous(false);
    setMediaFile(null);
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaPreview(null);
    setImageLoading(false);
    setCollegeInput("");
    setCollegeTagId("");
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
    if (!text.trim() && !mediaFile) return;
    if (!currentUser) return;
    const collegeTagName = collegeInput.trim();

    setLoading(true);
    try {
      await createPost(
        {
          content: text,
          isAnonymous,
          authorId: currentUser.id,
          collegeTagName,
          collegeTagId,
          authorCollegeId:
            currentUser.collegeGroupId ||
            currentUser.college_group_id ||
            currentUser.groupId ||
            currentUser.collegeGroup ||
            "",
        },
        mediaFile
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
  const filteredColleges = useMemo(() => {
    if (!collegeInput) return colleges;
    const query = collegeInput.toLowerCase();
    return colleges.filter((college) =>
      String(college.name || "").toLowerCase().includes(query)
    );
  }, [colleges, collegeInput]);

  const topMatches = useMemo(() => filteredColleges.slice(0, 5), [filteredColleges]);

  const handleCollegeChange = (value) => {
    setCollegeInput(value);
    setCollegeTagId("");
    setShowCollegeDropdown(true);
  };

  const handleCollegeSelect = (college) => {
    setCollegeInput(college.name);
    setCollegeTagId(college.id || "");
    setShowCollegeDropdown(false);
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
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={"What's happening on campus?\nShare updates, notes, or moments..."}
                  rows={4}
                  className="w-full rounded-2xl glass-input p-4 text-sm placeholder-[#b9b4c7] resize-none"
                />

                <div className="space-y-2 relative" ref={collegeRef}>
                  <label
                    htmlFor="post-college-tag"
                    className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                  >
                    College Tag (Optional)
                  </label>
                  <input
                    id="post-college-tag"
                    type="text"
                    value={collegeInput}
                    onChange={(e) => handleCollegeChange(e.target.value)}
                    onFocus={() => setShowCollegeDropdown(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setShowCollegeDropdown(false);
                    }}
                    placeholder="Tag College (Optional)"
                    className="w-full rounded-2xl glass-input px-4 py-2.5 text-sm"
                  />
                  <p className="text-[11px] text-[#b9b4c7]">
                    Can't find your college? Type to create.
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
                              onClick={() => handleCollegeSelect(college)}
                              className="w-full text-left px-3 py-2 rounded-xl text-sm text-[#faf0e6] hover:bg-white/10 transition-colors"
                            >
                              {college.name}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="p-3 text-sm text-[#b9b4c7]">
                          No matches. Press Enter to use "{collegeInput}".
                        </div>
                      )}
                    </div>
                  )}
                </div>

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
                            {collegeInput.trim() && (
                              <>
                                <span className="text-[#b9b4c7]">|</span>
                                <span className="inline-flex items-center gap-1 max-w-[220px] truncate">
                                  <i className="fa-solid fa-school text-[10px]"></i>
                                  <span className="truncate">{collegeInput.trim()}</span>
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
                    disabled={loading || (!text.trim() && !mediaFile)}
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
