import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import { markAllNotificationsRead } from "../../services/api";

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { notifications, setNotifications, feedScope, setFeedScope } = useApp();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFeedSwitcher, setShowFeedSwitcher] = useState(false);
  const feedSwitcherRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (feedSwitcherRef.current && !feedSwitcherRef.current.contains(event.target)) {
        setShowFeedSwitcher(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (error) {
      console.error("Failed to mark as read:", error);
    }
  };

  const isActive = (path) => location.pathname === path;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#1a120b]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div ref={feedSwitcherRef} className="relative">
            <Motion.button
              type="button"
              className="flex items-center space-x-3 rounded-full px-3 py-2 glass-surface"
              onClick={() => setShowFeedSwitcher((prev) => !prev)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl shadow-lg shadow-[#0b1f3a]/40">
                <img
                  src="/incampus-icon.svg"
                  alt="InCampus"
                  className="h-9 w-9"
                />
              </span>
              <div className="text-left">
                <p className="text-sm font-semibold text-[#faf0e6]">InCampus</p>
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#b9b4c7]">
                  {feedScope === "college" ? "My University" : "Universal"} Feed
                </p>
              </div>
              <i className="fa-solid fa-chevron-down text-xs text-[#b9b4c7]"></i>
            </Motion.button>

            <AnimatePresence>
              {showFeedSwitcher && (
                <Motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="absolute left-0 mt-3 w-56 rounded-2xl glass-card p-2"
                >
                  {[
                    { key: "universal", label: "Universal Feed", icon: "fa-earth-americas" },
                    { key: "college", label: "My University Feed", icon: "fa-school" },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setFeedScope(option.key);
                        setShowFeedSwitcher(false);
                        navigate("/feed");
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-all duration-300 ease-out ${
                        feedScope === option.key
                          ? "bg-white/10 text-[#faf0e6]"
                          : "text-[#b9b4c7] hover:bg-white/5 hover:text-[#faf0e6]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <i className={`fa-solid ${option.icon} text-[#b9b4c7]`}></i>
                        {option.label}
                      </span>
                      {feedScope === option.key && (
                        <i className="fa-solid fa-check text-xs text-[#b9b4c7]"></i>
                      )}
                    </button>
                  ))}
                </Motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center space-x-3">
            <Motion.button
              onClick={() => navigate("/trending")}
              className={`hidden sm:block rounded-full px-3 py-2 text-sm transition-all duration-300 ease-out ${
                isActive("/trending")
                  ? "bg-white/10 text-[#faf0e6]"
                  : "text-[#b9b4c7] hover:bg-white/5 hover:text-[#faf0e6]"
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
            >
              <i className="fa-solid fa-compass text-base"></i>
            </Motion.button>

            <Motion.button
              onClick={() => navigate("/chat")}
              className={`hidden sm:block rounded-full px-3 py-2 text-sm transition-all duration-300 ease-out ${
                isActive("/chat")
                  ? "bg-white/10 text-[#faf0e6]"
                  : "text-[#b9b4c7] hover:bg-white/5 hover:text-[#faf0e6]"
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
            >
              <i className="fa-solid fa-message text-base"></i>
            </Motion.button>

            <div className="relative">
              <Motion.button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative rounded-full px-3 py-2 text-sm text-[#b9b4c7] transition-all duration-300 ease-out hover:bg-white/5 hover:text-[#faf0e6]"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.96 }}
              >
                <i className="fa-solid fa-bell text-base"></i>
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 block h-2 w-2 rounded-full ring-2 ring-[#1a120b] bg-emerald-400 shadow-[0_0_10px_rgba(34,197,94,0.75)]"></span>
                )}
              </Motion.button>

              <AnimatePresence>
                {showNotifications && (
                  <Motion.div
                    id="notifications-panel"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute mt-3 w-[90vw] left-1/2 -translate-x-1/2 rounded-2xl glass-card z-50 max-h-80 overflow-hidden flex flex-col sm:w-80 sm:left-auto sm:translate-x-0 sm:right-0"
                  >
                    <div className="px-4 py-3 border-b border-white/10 flex justify-between items-center">
                      <h3 className="text-sm font-semibold text-[#faf0e6]">Activity</h3>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllRead}
                          className="text-xs text-[#b9b4c7] hover:text-[#faf0e6]"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="overflow-y-auto max-h-64">
                      {notifications.length === 0 ? (
                        <p className="text-center text-[#b9b4c7] py-4 text-sm">
                          No notifications
                        </p>
                      ) : (
                        notifications.map((notif) => (
                          <div
                            key={notif._id}
                            className={`px-4 py-3 border-b border-white/10 hover:bg-white/5 text-sm ${
                              !notif.read ? "bg-white/5" : ""
                            }`}
                          >
                            <b className="text-[#faf0e6]">
                              {notif.fromUser?.fullName || "Someone"}
                            </b>{" "}
                            <span className="text-[#b9b4c7]">{notif.message}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </Motion.div>
                )}
              </AnimatePresence>
            </div>

            <Motion.button
              onClick={() => navigate("/profile")}
              className={`rounded-full px-3 py-2 text-sm transition-all duration-300 ease-out ${
                isActive("/profile")
                  ? "bg-white/10 text-[#faf0e6]"
                  : "text-[#b9b4c7] hover:bg-white/5 hover:text-[#faf0e6]"
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
            >
              <i className="fa-solid fa-user text-base"></i>
            </Motion.button>

            <Motion.button
              onClick={logout}
              className="hidden sm:block rounded-full px-3 py-2 text-sm text-[#b9b4c7] transition-all duration-300 ease-out hover:bg-white/5 hover:text-red-300"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
            >
              <i className="fa-solid fa-right-from-bracket text-base"></i>
            </Motion.button>
          </div>
        </div>
      </div>
    </header>
  );
}
