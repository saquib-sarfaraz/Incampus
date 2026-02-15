import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../context/authContext";
import { useApp } from "../context/useApp";
import { searchColleges, setupCollege } from "../services/api";

const COLLEGE_SEARCH_DEBOUNCE_MS = 150;

const normalizeCollege = (item) => {
  if (!item) return null;
  if (typeof item === "string") {
    const name = item.trim();
    return name ? { name } : null;
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
    if (!name) return null;
    return { name: String(name).trim() };
  }
  return null;
};

const extractCollegeList = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) return data.map(normalizeCollege).filter(Boolean);
  if (Array.isArray(data.colleges)) return data.colleges.map(normalizeCollege).filter(Boolean);
  if (Array.isArray(data.data)) return data.data.map(normalizeCollege).filter(Boolean);
  if (Array.isArray(data.items)) return data.items.map(normalizeCollege).filter(Boolean);
  return [];
};

const buildYearOptions = () => {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 13 }, (_, idx) => currentYear - 6 + idx);
};

export default function CollegeSetup() {
  const navigate = useNavigate();
  const { currentUser, refreshCurrentUser } = useAuth();
  const { loadPosts, loadStories } = useApp();
  const [collegeInput, setCollegeInput] = useState("");
  const [colleges, setColleges] = useState([]);
  const [collegeLoading, setCollegeLoading] = useState(false);
  const [collegeError, setCollegeError] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [graduationYear, setGraduationYear] = useState("");
  const [studentType, setStudentType] = useState("undergraduate");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    if (currentUser?.university || currentUser?.college || currentUser?.school) {
      navigate("/feed", { replace: true });
    }
  }, [currentUser, navigate]);

  useEffect(() => {
    if (!showDropdown) return;
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
        const results = await searchColleges(query, 8);
        if (!isMounted) return;
        const list = extractCollegeList(results);
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
  }, [showDropdown, collegeInput]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const filteredColleges = useMemo(() => {
    const query = collegeInput.trim().toLowerCase();
    if (!query) return colleges;
    return colleges.filter((college) =>
      String(college.name || "").toLowerCase().includes(query)
    );
  }, [colleges, collegeInput]);

  const topMatches = useMemo(() => filteredColleges.slice(0, 5), [filteredColleges]);

  const yearOptions = useMemo(() => buildYearOptions(), []);

  const handleCollegeSelect = (college) => {
    setCollegeInput(college.name);
    setShowDropdown(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedCollege = collegeInput.trim();
    if (!trimmedCollege) {
      setFormError("Please enter your college.");
      return;
    }
    if (!graduationYear) {
      setFormError("Please select a graduation year.");
      return;
    }

    setSubmitting(true);
    setFormError("");
    try {
      const isAlumni = studentType === "alumni";
      const resolvedUserType = isAlumni ? "alumni" : "student";
      const resolvedStudentType = isAlumni ? "alumni" : studentType || "undergraduate";
      const yearValue = String(graduationYear);
      const payload = {
        collegeName: trimmedCollege,
        college: trimmedCollege,
        university: trimmedCollege,
        graduationYear: yearValue,
        year: yearValue,
        role: resolvedUserType,
        userType: resolvedUserType,
        user_type: resolvedUserType,
        studentType: resolvedStudentType,
        student_type: resolvedStudentType,
      };
      if (isAlumni) {
        payload.passoutYear = yearValue;
      }
      await setupCollege(payload);
      await refreshCurrentUser();
      await Promise.all([loadPosts(), loadStories()]);
      navigate("/feed", { replace: true });
    } catch (error) {
      setFormError(error.message || "Unable to save college details.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <Motion.div
        className="absolute inset-0 opacity-40"
        animate={{
          background: [
            "radial-gradient(circle at 20% 20%, rgba(92,84,112,0.25), transparent)",
            "radial-gradient(circle at 80% 80%, rgba(185,180,199,0.25), transparent)",
            "radial-gradient(circle at 20% 20%, rgba(92,84,112,0.25), transparent)",
          ],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl relative z-10"
      >
        <div className="glass-card rounded-3xl p-6 sm:p-10 space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-[#faf0e6]">
              Complete your college setup
            </h1>
            <p className="text-sm text-[#b9b4c7] mt-2">
              Help us tailor your campus experience.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2 relative" ref={containerRef}>
              <label
                htmlFor="college-setup-input"
                className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
              >
                College Selection
              </label>
              <input
                id="college-setup-input"
                type="text"
                value={collegeInput}
                onChange={(e) => {
                  setCollegeInput(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search your college..."
                className="w-full rounded-2xl glass-input px-4 py-3 text-sm"
              />
              <p className="text-[11px] text-[#b9b4c7]">
                Can&apos;t find your college? Type to create.
              </p>
              {showDropdown && (
                <div className="absolute left-0 right-0 mt-2 rounded-2xl glass-card max-h-64 overflow-y-auto z-20">
                  {collegeInput.trim().length < 2 ? (
                    <div className="p-3 text-sm text-[#b9b4c7]">
                      Type at least 2 characters to search.
                    </div>
                  ) : collegeLoading ? (
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
                          key={college.name}
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
                      No matches. Press Enter to use &quot;{collegeInput}&quot;.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label
                  htmlFor="college-setup-grad"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                >
                  Graduation Year
                </label>
                <select
                  id="college-setup-grad"
                  value={graduationYear}
                  onChange={(e) => setGraduationYear(e.target.value)}
                  className="w-full rounded-2xl glass-input px-4 py-3 text-sm"
                >
                  <option value="">Select year</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                  Student Type
                </label>
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
                  <button
                    type="button"
                    onClick={() => setStudentType("undergraduate")}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                      studentType !== "alumni"
                        ? "liquid-button text-[#faf0e6]"
                        : "text-[#b9b4c7] hover:text-[#faf0e6]"
                    }`}
                  >
                    Current Student
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentType("alumni")}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                      studentType === "alumni"
                        ? "liquid-button text-[#faf0e6]"
                        : "text-[#b9b4c7] hover:text-[#faf0e6]"
                    }`}
                  >
                    Alumni
                  </button>
                </div>
              </div>
            </div>

            {formError && (
              <p className="text-xs text-center text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {formError}
              </p>
            )}

            <Motion.button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl liquid-button px-4 py-3 text-sm font-semibold text-[#faf0e6] disabled:opacity-70 disabled:cursor-not-allowed"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {submitting ? (
                <>
                  <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Saving...
                </>
              ) : (
                <>Continue to Feed</>
              )}
            </Motion.button>
          </form>
        </div>
      </Motion.div>
    </div>
  );
}
