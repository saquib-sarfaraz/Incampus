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
    userType: "student",
    university: "",
    course: "",
    graduationYear: "",
    studentType: "undergraduate",
    studentEmail: "",
    passoutYear: "",
    industry: "",
    communityType: "club",
    communityDescription: "",
    communityEmail: "",
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
  const [step, setStep] = useState(1);
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  const collegeRef = useRef(null);
  const DRAFT_KEY = "incampus_register_draft";

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.formData) {
        setFormData((prev) => ({ ...prev, ...parsed.formData }));
      }
      if (parsed?.step) {
        setStep(parsed.step);
      }
    } catch {
      // Ignore malformed draft data.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ formData, step }));
  }, [formData, step]);

  useEffect(() => {
    setError("");
  }, [step, formData.userType]);

  useEffect(() => {
    const nextType = formData.userType;
    if (nextType === "student") {
      if (formData.studentType === "alumni" || formData.studentType === "community") {
        setFormData((prev) => ({ ...prev, studentType: "undergraduate" }));
      }
      return;
    }
    if (nextType === "alumni") {
      if (formData.studentType !== "alumni") {
        setFormData((prev) => ({ ...prev, studentType: "alumni" }));
      }
      return;
    }
    if (nextType === "community") {
      if (formData.studentType !== "community") {
        setFormData((prev) => ({ ...prev, studentType: "community" }));
      }
    }
  }, [formData.userType, formData.studentType]);

  const calculatePasswordStrength = (password) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.match(/[a-z]/) && password.match(/[A-Z]/)) strength++;
    if (password.match(/\d/)) strength++;
    if (password.match(/[^a-zA-Z\d]/)) strength++;
    return strength;
  };

  useEffect(() => {
    setPasswordStrength(calculatePasswordStrength(formData.password));
  }, [formData.password]);

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

  const isStudent = formData.userType === "student";
  const isAlumni = formData.userType === "alumni";
  const isCommunity = formData.userType === "community";

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

  const resolveUsername = () => {
    return formData.username.trim() || formData.email.split("@")[0];
  };

  const validateStepOne = () => {
    if (!validateEmail(formData.email)) {
      setError("Please enter a valid email address.");
      return false;
    }
    if (!formData.password || !formData.fullName) {
      setError("Please complete all required fields.");
      return false;
    }
    const usernameValue = resolveUsername();
    if (!usernameValue) {
      setError("Please choose a username.");
      return false;
    }
    return true;
  };

  const validateStepTwo = () => {
    if (siteKey && !captchaValue) {
      setError("Please complete the reCAPTCHA verification.");
      return false;
    }

    if (isStudent || isAlumni) {
      if (!formData.university.trim()) {
        setError("College is required.");
        return false;
      }
    }

    if (isStudent) {
      if (!formData.graduationYear) {
        setError("Graduation year is required.");
        return false;
      }
      if (!formData.studentType) {
        setError("Select your student level.");
        return false;
      }
    }

    if (isAlumni) {
      if (!formData.passoutYear) {
        setError("Passout year is required.");
        return false;
      }
    }

    if (isCommunity) {
      if (!formData.communityType) {
        setError("Select a community type.");
        return false;
      }
      if (!formData.communityDescription.trim()) {
        setError("Community description is required.");
        return false;
      }
    }

    return true;
  };

  const handleNextStep = () => {
    setError("");
    if (!validateStepOne()) return;
    setStep(2);
  };

  const handlePrevStep = () => {
    setError("");
    setStep(1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!validateStepOne() || !validateStepTwo()) return;

    const universityValue = formData.university.trim();
    const usernameValue = resolveUsername();

    setLoading(true);

    try {
      const username = usernameValue;
      const payload = {
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName.trim(),
        username,
        userType: formData.userType,
        studentType: formData.studentType,
        student_type: formData.studentType,
        recaptchaToken: captchaValue,
      };

      if (!isCommunity) {
        payload.university = universityValue;
        payload.course = formData.course;
      }

      if (isStudent) {
        payload.graduationYear = formData.graduationYear;
        payload.year = formData.graduationYear;
        if (formData.studentEmail) payload.studentEmail = formData.studentEmail;
      }

      if (isAlumni) {
        payload.passoutYear = formData.passoutYear;
        payload.graduationYear = formData.passoutYear;
        payload.year = formData.passoutYear;
        if (formData.industry) payload.industry = formData.industry;
      }

      if (isCommunity) {
        payload.communityName = formData.fullName.trim();
        payload.communityType = formData.communityType;
        payload.communityDescription = formData.communityDescription.trim();
        if (formData.communityEmail) payload.communityEmail = formData.communityEmail;
        if (universityValue) {
          payload.university = universityValue;
          payload.communityCollege = universityValue;
        }
      }

      await registerAPI(payload);

      const loginResult = await login(username, formData.password);
      if (loginResult.success) {
        if (typeof window !== "undefined") {
          localStorage.removeItem(DRAFT_KEY);
        }
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
            <div className="flex items-center justify-between text-xs text-[#b9b4c7]">
              <span className="uppercase tracking-[0.2em]">Step {step} of 2</span>
              <div className="flex items-center gap-2">
                {["Account", "Details"].map((label, index) => (
                  <span
                    key={label}
                    className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${
                      step === index + 1
                        ? "bg-white/10 text-[#faf0e6]"
                        : "bg-white/5 text-[#b9b4c7]"
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {step === 1 && (
              <>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
                    I am joining as
                  </label>
                  <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
                    {[
                      { key: "student", label: "Current Student" },
                      { key: "alumni", label: "Alumni" },
                      { key: "community", label: "Community / Club" },
                    ].map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() =>
                          setFormData((prev) => ({ ...prev, userType: option.key }))
                        }
                        className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                          formData.userType === option.key
                            ? "liquid-button text-[#faf0e6]"
                            : "text-[#b9b4c7] hover:text-[#faf0e6]"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

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
                      {isCommunity ? "Community / Club Name" : "Full Name"}
                    </label>
                    <input
                      type="text"
                      id="register-full-name"
                      name="fullName"
                      required
                      value={formData.fullName}
                      onChange={handleInputChange}
                      placeholder={isCommunity ? "e.g. InCampus Coding Club" : "e.g. SAQUIB SARFARAZ"}
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
              </>
            )}

            {step === 2 && (
              <>
                {(isStudent || isAlumni || isCommunity) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5 relative" ref={collegeRef}>
                      <label
                        htmlFor="register-university"
                        className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                      >
                        {isCommunity ? "College / University (Optional)" : "College / University"}
                      </label>
                      <input
                        type="text"
                        id="register-university"
                        name="university"
                        required={!isCommunity}
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

                    {isStudent && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor="register-course"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                        >
                          Course / Degree
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
                    )}

                    {isStudent && (
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
                          required={isStudent}
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
                    )}

                    {isStudent && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor="register-student-type"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                        >
                          Student Level
                        </label>
                        <select
                          id="register-student-type"
                          name="studentType"
                          required={isStudent}
                          value={formData.studentType}
                          onChange={handleInputChange}
                          className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                        >
                          <option value="undergraduate">Undergraduate</option>
                          <option value="postgraduate">Postgraduate</option>
                          <option value="graduate">Graduate</option>
                        </select>
                      </div>
                    )}

                    {isStudent && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor="register-student-email"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                        >
                          Student Email (Optional)
                        </label>
                        <input
                          type="email"
                          id="register-student-email"
                          name="studentEmail"
                          value={formData.studentEmail}
                          onChange={handleInputChange}
                          placeholder="name@college.edu"
                          className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                        />
                      </div>
                    )}

                    {isAlumni && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor="register-passout"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                        >
                          Passout Year
                        </label>
                        <select
                          id="register-passout"
                          name="passoutYear"
                          required={isAlumni}
                          value={formData.passoutYear}
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
                    )}

                    {isAlumni && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor="register-industry"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                        >
                          Industry / Company (Optional)
                        </label>
                        <input
                          type="text"
                          id="register-industry"
                          name="industry"
                          value={formData.industry}
                          onChange={handleInputChange}
                          placeholder="e.g. Product @ Stripe"
                          className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                        />
                      </div>
                    )}
                  </div>
                )}

                {isCommunity && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="register-community-type"
                        className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                      >
                        Community Type
                      </label>
                      <select
                        id="register-community-type"
                        name="communityType"
                        required={isCommunity}
                        value={formData.communityType}
                        onChange={handleInputChange}
                        className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                      >
                        <option value="club">Club</option>
                        <option value="society">Society</option>
                        <option value="student_organization">Student Organization</option>
                        <option value="event_community">Event Community</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="register-community-email"
                        className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                      >
                        Official Email / Contact
                      </label>
                      <input
                        type="email"
                        id="register-community-email"
                        name="communityEmail"
                        value={formData.communityEmail}
                        onChange={handleInputChange}
                        placeholder="club@college.edu"
                        className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                      />
                    </div>

                    <div className="space-y-1.5 md:col-span-2">
                      <label
                        htmlFor="register-community-description"
                        className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                      >
                        Community Description
                      </label>
                      <textarea
                        id="register-community-description"
                        name="communityDescription"
                        rows="3"
                        required={isCommunity}
                        value={formData.communityDescription}
                        onChange={handleInputChange}
                        placeholder="Tell members what this community is about..."
                        className="block w-full rounded-2xl px-3.5 py-2.5 text-sm glass-input resize-none"
                      />
                    </div>
                  </div>
                )}

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
              </>
            )}

            {error && (
              <p className="text-xs text-center text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              {step === 2 && (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-[#b9b4c7] hover:text-[#faf0e6]"
                >
                  Back
                </button>
              )}
              {step === 1 ? (
                <Motion.button
                  type="button"
                  onClick={handleNextStep}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl liquid-button px-4 py-2.5 text-sm font-semibold text-[#faf0e6]"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Continue
                </Motion.button>
              ) : (
                <Motion.button
                  type="submit"
                  disabled={loading}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl liquid-button px-4 py-2.5 text-sm font-semibold text-[#faf0e6] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {loading ? "Creating account..." : "Create Account"}
                </Motion.button>
              )}
            </div>
          </form>
        </div>
      </Motion.div>
    </div>
  );
}
