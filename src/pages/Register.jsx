import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import ReCAPTCHA from "react-google-recaptcha";
import { register as registerAPI, searchColleges } from "../services/api";
import { useAuth } from "../context/authContext";

export default function Register() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    fullName: "",
    username: "",
    university: "",
    course: "",
    graduationYear: "",
    studentType: "student",
  });
  const [colleges, setColleges] = useState([]);
  const [collegeInput, setCollegeInput] = useState("");
  const [showCollegeDropdown, setShowCollegeDropdown] = useState(false);
  const [collegeLoading, setCollegeLoading] = useState(false);
  const [collegeError, setCollegeError] = useState("");
  const [captchaValue, setCaptchaValue] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [passwordStrength, setPasswordStrength] = useState(0);
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  const collegeRef = useRef(null);

  const normalizeCollege = useCallback((item) => {
    if (!item) return "";
    if (typeof item === "string") return item.trim();
    if (typeof item === "object") {
      return (
        item.name ||
        item.collegeTagName ||
        item.collegeName ||
        item.college ||
        item.university ||
        item.institution ||
        item.school ||
        item.title ||
        item.value ||
        item.displayName ||
        ""
      ).trim();
    }
    return "";
  }, []);

  const extractCollegeList = useCallback((data) => {
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
  }, [normalizeCollege]);

  useEffect(() => {
    if (!showCollegeDropdown) return;
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
          setCollegeError(
            "Unable to load colleges. You can type your college manually."
          );
        }
      } finally {
        if (isMounted) setCollegeLoading(false);
      }
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [collegeInput, showCollegeDropdown, extractCollegeList]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (collegeRef.current && !collegeRef.current.contains(event.target)) {
        setShowCollegeDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const calculatePasswordStrength = (password) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.match(/[a-z]/) && password.match(/[A-Z]/)) strength++;
    if (password.match(/\d/)) strength++;
    if (password.match(/[^a-zA-Z\d]/)) strength++;
    return strength;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (name === "password") {
      setPasswordStrength(calculatePasswordStrength(value));
    }
  };

  const handleCollegeChange = (e) => {
    const value = e.target.value;
    setCollegeInput(value);
    setFormData((prev) => ({ ...prev, university: value }));
    setShowCollegeDropdown(true);
  };

  useEffect(() => {
    if (!collegeInput && formData.university) {
      setCollegeInput(formData.university);
    }
  }, [formData.university, collegeInput]);

  const handleCollegeKeyDown = (e) => {
    if (e.key === "Enter") {
      setShowCollegeDropdown(false);
    }
  };

  const handleCollegeSelect = (collegeName) => {
    setCollegeInput(collegeName);
    setFormData((prev) => ({ ...prev, university: collegeName }));
    setShowCollegeDropdown(false);
  };

  const filteredColleges = useMemo(() => {
    if (!collegeInput) return colleges;
    const query = collegeInput.toLowerCase();
    return colleges.filter((college) => college.toLowerCase().includes(query));
  }, [colleges, collegeInput]);

  const topMatches = useMemo(() => filteredColleges.slice(0, 5), [filteredColleges]);

  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const start = currentYear - 10;
    const end = currentYear + 6;
    const years = [];
    for (let year = start; year <= end; year += 1) {
      years.push(String(year));
    }
    return years;
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!validateEmail(formData.email)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (siteKey && !captchaValue) {
      setError("Please complete the reCAPTCHA verification.");
      return;
    }

    const universityValue = formData.university.trim();

    const usernameValue = formData.username.trim() || formData.email.split("@")[0];

    if (
      !formData.email ||
      !formData.password ||
      !formData.fullName ||
      !usernameValue ||
      !universityValue ||
      !formData.graduationYear ||
      !formData.studentType
    ) {
      setError("All fields are required.");
      return;
    }

    setLoading(true);

    try {
      const username = usernameValue;
      await registerAPI({
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
        university: universityValue,
        course: formData.course,
        graduationYear: formData.graduationYear,
        year: formData.graduationYear,
        student_type: formData.studentType,
        username,
        recaptchaToken: captchaValue,
      });

          const loginResult = await login(username, formData.password);
      if (loginResult.success) {
        navigate("/feed");
      } else {
        setError("Registration successful but login failed. Please log in manually.");
      }
    } catch (error) {
      setError(error.message || "Registration failed. Email might be in use.");
    } finally {
      setLoading(false);
    }
  };

  const getStrengthColor = () => {
    if (passwordStrength <= 1) return "bg-red-500";
    if (passwordStrength === 2) return "bg-yellow-500";
    if (passwordStrength === 3) return "bg-[#5c5470]";
    return "bg-[#b9b4c7]";
  };

  const getStrengthText = () => {
    if (passwordStrength <= 1) return "Weak";
    if (passwordStrength === 2) return "Fair";
    if (passwordStrength === 3) return "Good";
    return "Strong";
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
        id="register-modal"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl relative z-10"
      >
        <div className="glass-card rounded-3xl p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[#faf0e6]">Join InCampus</h1>
              <p className="text-sm text-[#b9b4c7] mt-1">Create your campus account</p>
            </div>
            <Link to="/login" className="text-sm text-[#b9b4c7] hover:text-[#faf0e6] font-medium">
              Sign In
            </Link>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="register-email"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                >
                  Email ID
                </label>
                <input
                  type="email"
                  id="register-email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="e.g. saquib@gmail.com"
                  className={`block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input ${
                    formData.email && !validateEmail(formData.email)
                      ? "border-red-400 focus:border-red-400 focus:ring-red-500"
                      : ""
                  }`}
                />
                {formData.email && !validateEmail(formData.email) && (
                  <p className="text-xs text-red-300">Invalid email format</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-full-name"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                >
                  Full Name
                </label>
                <input
                  type="text"
                  id="register-full-name"
                  name="fullName"
                  required
                  value={formData.fullName}
                  onChange={handleInputChange}
                  placeholder="e.g. SAQUIB SARFARAZ"
                  className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="register-username"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                >
                  Username
                </label>
                <input
                  type="text"
                  id="register-username"
                  name="username"
                  required
                  value={formData.username}
                  onChange={handleInputChange}
                  placeholder="e.g. saquib"
                  className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-password"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                >
                  Password
                </label>
                <input
                  type="password"
                  id="register-password"
                  name="password"
                  required
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="********"
                  className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[#b9b4c7] mt-2">
                <span>Password strength</span>
                <span className="text-[#faf0e6]">{getStrengthText()}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${getStrengthColor()}`}
                  style={{ width: `${passwordStrength * 25}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 relative" ref={collegeRef}>
                <label
                  htmlFor="register-university"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                >
                  College / University
                </label>
                <input
                  type="text"
                  id="register-university"
                  name="university"
                  required
                  value={collegeInput}
                  onChange={handleCollegeChange}
                  onKeyDown={handleCollegeKeyDown}
                  onFocus={() => setShowCollegeDropdown(true)}
                  placeholder="Search your college..."
                  className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                />
                <p className="text-[11px] text-[#b9b4c7]">
                  Can't find your college? Type to create.
                </p>
                {showCollegeDropdown && (
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
                            key={college}
                            type="button"
                            onClick={() => handleCollegeSelect(college)}
                            className="w-full text-left px-3 py-2 rounded-xl text-sm text-[#faf0e6] hover:bg-white/10 transition-colors"
                          >
                            {college}
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
              <div className="space-y-1.5">
                <label
                  htmlFor="register-course"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                >
                  Major / Program (Optional)
                </label>
                <input
                  type="text"
                  id="register-course"
                  name="course"
                  value={formData.course}
                  onChange={handleInputChange}
                  placeholder="e.g. Computer Science"
                  className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-graduation"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                >
                  Graduation Year
                </label>
                <select
                  id="register-graduation"
                  name="graduationYear"
                  required
                  value={formData.graduationYear}
                  onChange={handleInputChange}
                  className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                >
                  <option value="">Select year</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-student-type"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                >
                  Student Type
                </label>
                <select
                  id="register-student-type"
                  name="studentType"
                  required
                  value={formData.studentType}
                  onChange={handleInputChange}
                  className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                >
                  <option value="student">Current Student</option>
                  <option value="alumni">Alumni</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              {siteKey ? (
                <ReCAPTCHA
                  sitekey={siteKey}
                  onChange={(value) => setCaptchaValue(value)}
                  theme="dark"
                />
              ) : (
                <p className="text-xs text-[#b9b4c7]">
                  reCAPTCHA key missing. Set `VITE_RECAPTCHA_SITE_KEY` in your `.env` to
                  enable verification.
                </p>
              )}
            </div>

            {error && (
              <p className="text-xs text-center text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <Motion.button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl liquid-button px-4 py-2.5 text-sm font-semibold text-[#faf0e6] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {loading ? "Creating account..." : "Create Account"}
            </Motion.button>
          </form>
        </div>
      </Motion.div>
    </div>
  );
}
