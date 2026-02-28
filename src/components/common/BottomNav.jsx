import { useNavigate, useLocation } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { preloadChatPage } from "../../utils/preloadRoutes";

export default function BottomNav({ hidden = false, onCreate, overlay = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { chatUnreadTotal } = useApp();

  const normalizePath = (path = "") => (path.length > 1 ? path.replace(/\/+$/, "") : path);
  const currentPath = normalizePath(location.pathname);
  const isActive = (path) => {
    const normalized = normalizePath(path);
    if (normalized === "/feed") {
      return currentPath === "/feed" || currentPath === "/home";
    }
    if (normalized.startsWith("/profile")) {
      return currentPath.startsWith("/profile");
    }
    return currentPath === normalized || currentPath.startsWith(`${normalized}/`);
  };

  const currentUserId =
    currentUser?.id || currentUser?._id || currentUser?.userId || currentUser?.user_id || "";
  const profilePath = currentUserId ? `/profile/${currentUserId}` : "/profile";
  const navItems = [
    { path: "/feed", icon: "fa-house", label: "Home" },
    { path: "/trending", icon: "fa-compass", label: "Trending" },
    { path: "/chat", icon: "fa-message", label: "Chat" },
    { path: profilePath, icon: "fa-user", label: "Profile" },
  ];

  const handleCreate = (event) => {
    if (event?.currentTarget) {
      event.currentTarget.classList.remove("liquid-ripple");
      void event.currentTarget.offsetWidth;
      event.currentTarget.classList.add("liquid-ripple");
    }
    if (onCreate) onCreate();
    else navigate("/feed");
  };

  return (
    <nav
      className={`fixed bottom-4 left-1/2 z-40 w-[92%] -translate-x-1/2 rounded-3xl border border-white/10 bg-[#1a120b]/90 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] sm:hidden ${
        hidden ? "pointer-events-none opacity-0 translate-y-4" : "opacity-100"
      } ${overlay ? "opacity-80" : ""} transition-all duration-300 ease-out`}
    >
      <div className="relative grid grid-cols-5 items-end px-4 pb-2 pt-5">
        <Motion.button
          onClick={() => navigate(navItems[0].path, { replace: true })}
          className={`nav-link flex flex-col items-center text-[11px] transition-colors ${
            isActive(navItems[0].path)
              ? "active-link text-[#faf0e6]"
              : "text-[#b9b4c7] hover:text-[#faf0e6]"
          }`}
          whileTap={{ scale: 0.9 }}
        >
          <i
            className={`fa-solid ${navItems[0].icon} text-base`}
          />
          <span>{navItems[0].label}</span>
        </Motion.button>

        <Motion.button
          onClick={() => navigate(navItems[1].path, { replace: true })}
          className={`nav-link flex flex-col items-center text-[11px] transition-colors ${
            isActive(navItems[1].path)
              ? "active-link text-[#faf0e6]"
              : "text-[#b9b4c7] hover:text-[#faf0e6]"
          }`}
          whileTap={{ scale: 0.9 }}
        >
          <i
            className={`fa-solid ${navItems[1].icon} text-base`}
          />
          <span>{navItems[1].label}</span>
        </Motion.button>

        <div className="relative flex flex-col items-center">
          <Motion.button
            type="button"
            onClick={handleCreate}
            className="create-fab liquid-button -mt-10 flex h-14 w-14 items-center justify-center rounded-full text-[#faf0e6] shadow-[0_0_24px_rgba(185,180,199,0.6)]"
            whileTap={{ scale: 0.94 }}
          >
            <i className="fa-solid fa-plus text-lg"></i>
          </Motion.button>
          <span className="mt-1 text-[11px] text-[#b9b4c7]">Create</span>
        </div>

        <Motion.button
          onClick={() => navigate(navItems[2].path, { replace: true })}
          onMouseEnter={preloadChatPage}
          onFocus={preloadChatPage}
          onTouchStart={preloadChatPage}
          className={`nav-link flex flex-col items-center text-[11px] transition-colors ${
            isActive(navItems[2].path)
              ? "active-link text-[#faf0e6]"
              : "text-[#b9b4c7] hover:text-[#faf0e6]"
          }`}
          whileTap={{ scale: 0.9 }}
        >
          <span className="relative">
            <i className={`fa-solid ${navItems[2].icon} text-base`} />
            {chatUnreadTotal > 0 && (
              <span className="absolute -top-1 -right-2 block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(34,197,94,0.75)]"></span>
            )}
          </span>
          <span>{navItems[2].label}</span>
        </Motion.button>

        <Motion.button
          onClick={() => navigate(navItems[3].path, { replace: true })}
          className={`nav-link flex flex-col items-center text-[11px] transition-colors ${
            isActive(navItems[3].path)
              ? "active-link text-[#faf0e6]"
              : "text-[#b9b4c7] hover:text-[#faf0e6]"
          }`}
          whileTap={{ scale: 0.9 }}
        >
          <i
            className={`fa-solid ${navItems[3].icon} text-base`}
          />
          <span>{navItems[3].label}</span>
        </Motion.button>
      </div>
    </nav>
  );
}
