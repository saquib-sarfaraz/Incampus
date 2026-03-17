import { useEffect } from "react";
import { motion as Motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { usePWAInstall } from "../hooks/usePWAInstall";
import { useAuth } from "../context/authContext";

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

const valueItems = [
  {
    title: "Hyper-Local Student Network",
    description: "Content comes from your campus ecosystem only.",
    icon: "fa-location-dot",
  },
  {
    title: "Anonymous Academic Voice",
    description: "Ask, share, discuss — without social pressure.",
    icon: "fa-mask",
  },
  {
    title: "Unified Campus Communication",
    description: "Feed discovery + Direct messaging + Study group collaboration.",
    icon: "fa-network-wired",
  },
  {
    title: "Liquid Glass Experience",
    description: "Futuristic translucent UI with glow interaction system.",
    icon: "fa-droplet",
  },
];

const experienceStrip = ["Private", "Verified", "Campus Only", "Real Conversations"];

export default function Landing() {
  const navigate = useNavigate();
  const { isInstallable, install } = usePWAInstall();
  const { authToken, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (authToken) {
      navigate("/feed", { replace: true });
    }
  }, [authToken, loading, navigate]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#1a120b] text-[#faf0e6]">
      <div className="pointer-events-none absolute inset-0">
        <Motion.div
          className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#5c5470]/30 via-[#7a6f8f]/30 to-[#b9b4c7]/25 blur-3xl"
          animate={{ y: [0, -16, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />
        <Motion.div
          className="absolute top-40 right-[-160px] h-80 w-80 rounded-full bg-gradient-to-r from-[#2a1e14]/60 via-[#5c5470]/25 to-[#b9b4c7]/20 blur-3xl"
          animate={{ y: [0, 18, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <Motion.div
          className="absolute bottom-0 left-[-140px] h-80 w-80 rounded-full bg-gradient-to-r from-[#1a120b]/80 via-[#5c5470]/30 to-[#b9b4c7]/20 blur-3xl"
          animate={{ y: [0, -12, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <Motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-50 border-b border-white/10 bg-[#1a120b]/90 backdrop-blur-xl"
      >
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#5c5470] to-[#b9b4c7] shadow-lg shadow-[#5c5470]/30">
              <img src="/incampus-icon.svg" alt="InCampus" className="h-8 w-8" />
            </span>
            <span className="text-lg font-semibold text-[#faf0e6]">InCampus</span>
          </div>
          <div className="flex items-center gap-3">
            {isInstallable && (
              <button
                type="button"
                onClick={install}
                className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-[#faf0e6] transition-all duration-300 ease-out hover:border-white/40 hover:bg-white/10"
              >
                Install App
              </button>
            )}
            <Link
              to="/login"
              className="text-sm font-medium text-[#b9b4c7] transition-colors duration-300 hover:text-[#faf0e6]"
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="liquid-button rounded-full px-4 py-2 text-sm font-semibold text-[#faf0e6]"
            >
              Sign Up
            </Link>
          </div>
        </nav>
      </Motion.header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6 lg:px-8">
        <Motion.section
          initial="hidden"
          animate="show"
          variants={fadeUp}
          className="space-y-6"
        >
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.25em] text-[#b9b4c7]">
            Private Campus Network
          </p>
          <h1 className="text-4xl font-semibold leading-tight text-[#faf0e6] sm:text-5xl lg:text-6xl">
            Your Campus.
            <span className="block">One Private Digital Space.</span>
          </h1>
          <p className="text-base text-[#b9b4c7] sm:text-lg">
            Built only for verified students.
          </p>
          <p className="text-sm text-[#b9b4c7]">
            Conversations, communities, and connections — inside your academic world.
          </p>

          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                to="/register"
                className="liquid-button inline-flex items-center justify-center rounded-full px-10 py-3 text-sm font-small text-[#faf0e6]"
              >
                Explore InCampus
              </Link>
            </div>
            <p className="text-xs text-[#b9b4c7]">
              See what your campus is talking about right now.
            </p>
          </div>
        </Motion.section>

        <Motion.section
          id="core-values"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeUp}
          className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {valueItems.map((item) => (
            <div
              key={item.title}
              className="glass-card glass-hover rounded-2xl border border-white/10 p-5 transition-all duration-300 ease-out"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#5c5470]/30 via-[#7a6f8f]/30 to-[#b9b4c7]/30 text-[#faf0e6]">
                <i className={`fa-solid ${item.icon}`}></i>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-[#faf0e6]">{item.title}</h3>
              <p className="mt-2 text-xs text-[#b9b4c7]">{item.description}</p>
            </div>
          ))}
        </Motion.section>

        <Motion.section
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeUp}
          className="mt-16 text-center"
        >
          <p className="text-sm text-[#b9b4c7]">
            Built for how students actually communicate.
          </p>
          <p className="text-sm text-[#b9b4c7]">
            Not how old social networks think they do.
          </p>
        </Motion.section>

        <Motion.section
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeUp}
          className="mt-10"
        >
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
            {experienceStrip.map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/10 bg-white/10 px-4 py-1 text-xs text-[#faf0e6]"
              >
                {item}
              </span>
            ))}
          </div>
        </Motion.section>

        <Motion.section
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeUp}
          className="mt-16"
        >
          <div className="glass-card glass-hover rounded-[28px] border border-white/10 p-8 text-center">
            <h2 className="text-2xl font-semibold text-[#faf0e6] sm:text-3xl">
              Ready to enter your campus digital space?
            </h2>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                to="/register"
                className="liquid-button rounded-full px-6 py-3 text-sm font-semibold text-[#faf0e6]"
              >
                Sign Up
              </Link>
              <Link
                to="/login"
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-[#faf0e6] transition-all duration-300 ease-out hover:border-white/30 hover:bg-white/5"
              >
                Sign In
              </Link>
            </div>
          </div>
        </Motion.section>
      </main>

      <footer className="border-t border-white/10 bg-[#1a120b]/80">
        <div className="mx-auto max-w-6xl px-4 py-8 text-center text-xs text-[#b9b4c7]">
          <div className="font-semibold text-[#faf0e6]">InCampus</div>
          <div className="mt-1">Private Campus Network</div>
          <div className="mt-2">© 2026 InCampus. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
