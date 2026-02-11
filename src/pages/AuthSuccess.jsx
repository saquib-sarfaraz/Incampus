import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../context/authContext";
import { useApp } from "../context/useApp";

const resolveHasCollege = (paramValue, user) => {
  if (paramValue !== null) return paramValue === "true";
  return Boolean(
    user?.university ||
      user?.college ||
      user?.school ||
      user?.collegeGroupId ||
      user?.college_group_id
  );
};

export default function AuthSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const { loadPosts, loadStories } = useApp();
  const [error, setError] = useState("");
  const token = useMemo(() => searchParams.get("token"), [searchParams]);
  const hasCollegeParam = useMemo(() => searchParams.get("college"), [searchParams]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!token) {
        if (active) setError("Missing auth token. Please try logging in again.");
        return;
      }
      try {
        const user = await loginWithToken(token);
        await Promise.all([loadPosts(), loadStories()]);
        const hasCollege = resolveHasCollege(hasCollegeParam, user);
        navigate(hasCollege ? "/feed" : "/college-setup", { replace: true });
      } catch (err) {
        if (active) {
          setError(err?.message || "Unable to complete login.");
        }
      }
    };

    run();
    return () => {
      active = false;
    };
  }, [token, hasCollegeParam, loginWithToken, loadPosts, loadStories, navigate]);

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
        className="w-full max-w-lg relative z-10"
      >
        <div className="glass-card rounded-3xl p-8 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-white/10 flex items-center justify-center">
            <i className="fa-solid fa-lock text-[#faf0e6]"></i>
          </div>
          <h1 className="text-xl font-semibold text-[#faf0e6]">Finalizing your login</h1>
          <p className="text-sm text-[#b9b4c7] mt-2">
            Setting up your InCampus session.
          </p>

          {error ? (
            <div className="mt-6 space-y-4">
              <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                {error}
              </p>
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold liquid-button text-[#faf0e6]"
              >
                Back to Login
              </Link>
            </div>
          ) : (
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[#b9b4c7]">
              <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Redirecting...
            </div>
          )}
        </div>
      </Motion.div>
    </div>
  );
}
