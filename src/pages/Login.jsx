import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../context/authContext";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

const getGoogleAuthUrl = () => {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${base}/auth/google`;
};

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [glowActive, setGlowActive] = useState(false);

  useEffect(() => {
    setGlowActive(username.length > 0 && password.length > 0);
  }, [username, password]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError("");

    if (!username || !password) {
      setError("Please enter both Login ID and Password.");
      return;
    }

    setLoading(true);

    try {
      const result = await login(username, password);
      if (result.success) {
        navigate("/feed");
      } else {
        setError(result.error || "Invalid credentials. Please try again.");
      }
    } catch (error) {
      console.error("Login error:", error);
      setError("Network Error: Could not connect to the InCampus server.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = getGoogleAuthUrl();
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
        transition={{ duration: 0.5 }}
        className="w-full max-w-4xl relative z-10"
      >
        <div className="glass-card rounded-3xl overflow-hidden">
          <div className="grid md:grid-cols-5">
            <Motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="md:col-span-3 p-6 sm:p-10 space-y-8"
            >
              <div className="flex items-center gap-3">
                <Motion.span
                  animate={{ rotate: [-4, 4, -4] }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#5c5470] to-[#b9b4c7] text-[#faf0e6] shadow-lg shadow-[#5c5470]/30"
                >
                  <img
                    src="/incampus-icon.svg"
                    alt="InCampus"
                    className="h-7 w-7 object-contain"
                  />
                </Motion.span>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#faf0e6]">
                    Welcome to InCampus
                  </h1>
                  <p className="text-xs sm:text-sm text-[#b9b4c7]">
                    Sign in to the campus-only social feed.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <Motion.button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-[#faf0e6] transition-all hover:bg-white/10"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <i className="fa-brands fa-google text-sm"></i>
                  Continue with Google
                </Motion.button>

                <div className="flex items-center gap-3 text-[11px] text-[#b9b4c7]">
                  <span className="h-px flex-1 bg-white/10" />
                  or sign in with password
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <div className="space-y-1.5 text-left">
                  <label
                    htmlFor="login-username"
                    className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                  >
                    Login ID
                  </label>
                  <input
                    type="text"
                    id="login-username"
                    name="username"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder=" Your User ID"
                    className="block w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
                  />
                </div>

                <div className="space-y-1.5 text-left">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      id="login-password"
                      name="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="********"
                      className="block w-full rounded-xl px-3.5 py-2.5 pr-10 text-sm glass-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#b9b4c7] hover:text-[#faf0e6]"
                    >
                      <i className={`fa-solid ${showPassword ? "fa-eye-slash" : "fa-eye"}`} />
                    </button>
                  </div>
                </div>

                

                <Motion.button
                  type="submit"
                  disabled={loading || !username || !password}
                  className={`w-full inline-flex items-center justify-center gap-2 rounded-xl liquid-button px-4 py-2.5 text-sm font-semibold text-[#faf0e6] transition-all disabled:opacity-70 disabled:cursor-not-allowed ${
                    glowActive ? "glow-active" : ""
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {loading ? (
                    <>
                      <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign in
                      <i className="fa-solid fa-arrow-right-long text-xs"></i>
                    </>
                  )}
                </Motion.button>

                {error && (
                  <p className="text-xs text-center text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
              </form>

              

              <div className="md:hidden rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
                <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                  Live campus-only network
                </p>
                <h2 className="mt-3 text-lg font-semibold leading-snug text-[#faf0e6]">
                  Discover what is trending
                  <br />
                  on your campus, in real time.
                </h2>
                <ul className="mt-3 space-y-2 text-sm text-[#b9b4c7]">
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#b9b4c7]" />
                    <span>Share updates, events, and campus moments instantly.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#b9b4c7]" />
                    <span>Connect with classmates in a safe, closed network.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#b9b4c7]" />
                    <span>Built just for students - no outside noise.</span>
                  </li>
                </ul>
                <p className="mt-4 text-[11px] text-[#b9b4c7]">
                  By signing in you agree to keep InCampus respectful and campus-first.
                </p>
              </div>
            </Motion.div>

            <div className="hidden md:flex md:col-span-2 flex-col justify-between p-8 bg-gradient-to-b from-[#1f1811] via-[#1a120b] to-[#120c08]">
              <div className="space-y-4">
                <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                  Live campus-only network
                </p>
                <h2 className="text-2xl font-semibold leading-snug text-[#faf0e6]">
                  Discover what is trending
                  <br />
                  on your campus, in real time.
                </h2>
                <ul className="space-y-2 text-sm text-[#b9b4c7]">
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#b9b4c7]" />
                    <span>Share updates, events, and campus moments instantly.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#b9b4c7]" />
                    <span>Connect with classmates in a safe, closed network.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#b9b4c7]" />
                    <span>Built just for students - no outside noise.</span>
                  </li>
                </ul>
              </div>

              <p className="text-[11px] text-[#b9b4c7]">
                By signing in you agree to keep InCampus respectful and campus-first.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 px-6 py-4 text-xs text-[#b9b4c7]">
            <span>New here?</span>
            <Link to="/register" className="text-[#b9b4c7] hover:text-[#faf0e6]">
              Create an account
            </Link>
          </div>
        </div>
      </Motion.div>
    </div>
  );
}
