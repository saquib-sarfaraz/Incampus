import { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_URL;

export default function LoginView({ setAuthToken, setCurrentUser }) {
  const [loginUser, setLoginUser] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!loginUser || !password) {
      setError("Please enter both Login ID and Password.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUser, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message || "Invalid credentials. Please try again.");
        setLoading(false);
        return;
      }

      const data = await res.json();

      localStorage.setItem("authToken", data.token);
      localStorage.setItem("currentUserId", data.id || data._id || data.username);

      setAuthToken(data.token);
      setCurrentUser({ id: data.id || data._id || data.username });

    } catch {
      setError("Network Error: Could not connect to the InCampus server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-genz-bg via-white to-genz-neutral flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-4xl bg-white/80 backdrop-blur-lg rounded-3xl shadow-xl border border-slate-100 overflow-hidden krazy-card">
        <div className="grid md:grid-cols-5">
          {/* Left / main content */}
          <div className="md:col-span-3 p-6 sm:p-10 space-y-8">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-genz-primary/10 text-genz-primary">
                <i className="fa-solid fa-graduation-cap text-2xl transform -rotate-6"></i>
              </span>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                  Welcome to InCampus
                </h1>
                <p className="text-xs sm:text-sm text-slate-500">
                  Sign in to the campus-only social feed.
                </p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-1.5 text-left">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Login ID
                </label>
                <input
                  type="text"
                  required
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  placeholder="e.g., user1"
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-genz-primary focus:border-genz-primary"
                />
              </div>

              <div className="space-y-1.5 text-left">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-genz-primary focus:border-genz-primary"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Use your campus test credentials to explore InCampus.</span>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-genz-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-genz-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-genz-primary transition-all disabled:opacity-70 disabled:cursor-not-allowed krazy-button"
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
              </button>

              {error && (
                <p className="text-xs text-center text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </form>

            <p className="text-[11px] text-center text-slate-500">
              <strong>Test users:</strong> Try{" "}
              <span className="font-mono bg-genz-neutral px-1.5 py-0.5 rounded-md">
                user1
              </span>{" "}
              up to{" "}
              <span className="font-mono bg-genz-neutral px-1.5 py-0.5 rounded-md">
                user1000
              </span>
              .
            </p>
          </div>

          {/* Right / accent panel */}
          <div className="hidden md:flex md:col-span-2 bg-genz-primary text-white flex-col justify-between p-8">
            <div className="space-y-4">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                Live campus-only network
              </p>
              <h2 className="text-2xl font-semibold leading-snug">
                Discover what&apos;s trending
                <br />
                on your campus, in real time.
              </h2>
              <ul className="space-y-2 text-sm text-white/80">
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-300" />
                  <span>Share updates, events, and campus moments instantly.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-300" />
                  <span>Connect with classmates in a safe, closed network.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-300" />
                  <span>Built just for students — no outside noise.</span>
                </li>
              </ul>
            </div>

            <p className="text-[11px] text-white/70">
              By signing in you agree to keep InCampus respectful and campus-first.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
