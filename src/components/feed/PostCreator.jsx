import { useState, useRef, useEffect, useMemo } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { createPost, searchColleges } from "../../services/api";
import { compressImageFile } from "../../utils/media";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

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
  const [mediaError, setMediaError] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const collegeRef = useRef(null);

  useEffect(() => {
    if (!collegeInput && currentUser?.university) {
      setCollegeInput(currentUser.university);
      setCollegeTagId("");
    }
  }, [currentUser?.university, collegeInput]);

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
    }, 300);

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

  const handleMediaSelect = async (e) => {
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

      setText("");
      setMediaFile(null);
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview);
      }
      setMediaPreview(null);
      setImageLoading(false);
      setIsAnonymous(false);
      setCollegeInput("");
      setCollegeTagId("");
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
    <Motion.div
      id="post-creator"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6"
    >
      <div className="glass-card glass-hover rounded-3xl p-4 transition-all duration-300 ease-out">
        <form onSubmit={handleSubmit}>
          <div className="flex items-start space-x-3 mb-4">
            <img
              src={isAnonymous ? ANONYMOUS_AVATAR : userAvatar}
              alt="Profile"
              className="w-10 h-10 rounded-full object-cover"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"What's happening on campus?\nShare updates, notes, or moments..."}
              rows="3"
              className="flex-1 rounded-2xl glass-input p-3 text-sm placeholder-[#b9b4c7] resize-none"
            />
          </div>

          <div className="mb-4 relative" ref={collegeRef}>
            <label
              htmlFor="post-creator-college"
              className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7] mb-2"
            >
              College Tag (Optional)
            </label>
            <input
              id="post-creator-college"
              type="text"
              value={collegeInput}
              onChange={(e) => handleCollegeChange(e.target.value)}
              onFocus={() => setShowCollegeDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setShowCollegeDropdown(false);
              }}
              placeholder="Tag College (Optional)"
              className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm"
            />
            <p className="text-[11px] text-[#b9b4c7] mt-1">
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
                disabled={loading || (!text.trim() && !mediaFile)}
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
