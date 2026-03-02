import { lazy, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/authContext";
import { useApp } from "../../context/useApp";
import Feed from "../../pages/Feed";
import UserProfileModal from "../profile/UserProfileModal";
import { preloadChatPage } from "../../utils/preloadRoutes";
import { normalizeUserId } from "../../utils/userProfile";

const Chat = lazy(preloadChatPage);
const Profile = lazy(() => import("../../pages/Profile"));
const Trending = lazy(() => import("../../pages/Trending"));

const SCROLL_KEY_PREFIX = "incampus:scroll:";

const normalizePath = (path = "") => (path.length > 1 ? path.replace(/\/+$/, "") : path);

const resolveTabKey = (pathname = "") => {
  const normalized = normalizePath(pathname);
  if (normalized === "/home" || normalized === "/feed") return "feed";
  if (normalized.startsWith("/notifications")) return "feed";
  if (normalized.startsWith("/trending")) return "trending";
  if (normalized.startsWith("/chat")) return "chat";
  if (normalized === "/profile") return "profile";
  return "";
};

const resolveProfileRouteId = (pathname = "") => {
  const normalized = normalizePath(pathname);
  if (!normalized.startsWith("/profile/")) return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts[1] || "";
};

const resolveChatRouteId = (pathname = "") => {
  const normalized = normalizePath(pathname);
  if (!normalized.startsWith("/chat/")) return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts[1] || "";
};

export default function RootTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { requestChatOpen } = useApp();
  const lastTab =
    typeof window !== "undefined" ? localStorage.getItem("incampus:lastTab") : "";
  const currentUserId =
    currentUser?.id ||
    currentUser?._id ||
    currentUser?.userId ||
    currentUser?.user_id ||
    "";
  const profileRouteId = normalizeUserId(resolveProfileRouteId(location.pathname));
  const chatRouteId = resolveChatRouteId(location.pathname);
  const isSelfProfile =
    profileRouteId && currentUserId && String(profileRouteId) === String(currentUserId);
  const rootKey = resolveTabKey(location.pathname) || (isSelfProfile ? "profile" : "");
  const prevTabRef = useRef(
    rootKey || (profileRouteId ? "profile" : "") || lastTab || "feed"
  );
  const modalProfileRequested = Boolean(location.state?.modal);
  const shouldOverlayProfile = Boolean(
    profileRouteId &&
      (modalProfileRequested ||
        (!isSelfProfile && prevTabRef.current && prevTabRef.current !== "profile"))
  );
  const activeKey = shouldOverlayProfile
    ? prevTabRef.current || "profile"
    : rootKey || prevTabRef.current || "feed";
  const [mountedTabs, setMountedTabs] = useState(() =>
    activeKey ? [activeKey] : []
  );
  const backPressRef = useRef(0);
  const [showBackToast, setShowBackToast] = useState(false);
  const currentPathRef = useRef(location.pathname);
  const tabRefs = useRef({});

  useEffect(() => {
    currentPathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!rootKey) return;
    setMountedTabs((prev) => (prev.includes(rootKey) ? prev : [...prev, rootKey]));
  }, [rootKey]);

  useEffect(() => {
    if (!rootKey) {
      return;
    }
    try {
      localStorage.setItem("incampus:lastTab", rootKey);
    } catch {
      // ignore storage errors
    }
    const prevKey = prevTabRef.current;
    if (prevKey && prevKey !== rootKey) {
      try {
        sessionStorage.setItem(
          `${SCROLL_KEY_PREFIX}${prevKey}`,
          String(window.scrollY || 0)
        );
      } catch {
        // ignore storage errors
      }
    }
    const key = `${SCROLL_KEY_PREFIX}${rootKey}`;
    const saved = typeof window !== "undefined" ? sessionStorage.getItem(key) : null;
    if (saved) {
      const y = Number(saved);
      if (Number.isFinite(y)) {
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
    } else {
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }
    prevTabRef.current = rootKey;
  }, [rootKey]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const focused = document.activeElement;
    if (!focused) return;
    const keys = Object.keys(tabRefs.current);
    for (const key of keys) {
      if (key === activeKey) continue;
      const node = tabRefs.current[key];
      if (node && node.contains(focused)) {
        focused.blur();
        break;
      }
    }
  }, [activeKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (window.innerWidth >= 768) return undefined;
    const onPopState = () => {
      const normalized = normalizePath(currentPathRef.current);
      const isRootTab =
        normalized === "/home" ||
        normalized === "/feed" ||
        normalized === "/trending" ||
        normalized === "/chat" ||
        normalized === "/profile";
      if (!isRootTab) return;
      const now = Date.now();
      if (now - backPressRef.current < 2000) {
        backPressRef.current = 0;
        return;
      }
      backPressRef.current = now;
      window.history.pushState(null, "", currentPathRef.current);
      setShowBackToast(true);
      setTimeout(() => setShowBackToast(false), 1600);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!chatRouteId) return;
    requestChatOpen?.(chatRouteId);
  }, [chatRouteId, requestChatOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handlePushRoute = (rawRoute) => {
      const route = typeof rawRoute === "string" ? rawRoute : "";
      if (!route) return;
      if (route.startsWith("/chat/")) {
        const targetId = resolveChatRouteId(route);
        if (targetId) requestChatOpen?.(targetId);
        navigate("/chat", { replace: true });
        return;
      }
      if (route.startsWith("/notifications")) {
        try {
          sessionStorage.setItem("incampus:openNotifications", "1");
        } catch {
          // ignore storage errors
        }
        navigate("/notifications", { replace: true });
        return;
      }
      navigate(route, { replace: true });
    };

    const onMessage = (event) => {
      const payload = event?.detail;
      const route =
        payload?.data?.route ||
        payload?.fcmOptions?.link ||
        payload?.notification?.click_action ||
        "";
      handlePushRoute(route);
    };

    window.addEventListener("fcm:message", onMessage);
    return () => window.removeEventListener("fcm:message", onMessage);
  }, [navigate, requestChatOpen]);

  const tabs = useMemo(
    () => [
      { key: "feed", element: <Feed /> },
      { key: "trending", element: <Trending /> },
      { key: "chat", element: <Chat /> },
      { key: "profile", element: <Profile /> },
    ],
    []
  );

  return (
    <div className="relative min-h-[100dvh]">
      {tabs.map((tab) => {
        if (!mountedTabs.includes(tab.key)) return null;
        const isActive = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            className={isActive ? "block" : "hidden"}
            ref={(node) => {
              if (node) tabRefs.current[tab.key] = node;
            }}
            inert={!isActive}
          >
            {tab.element}
          </div>
        );
      })}
      {shouldOverlayProfile && (
        <UserProfileModal
          isOpen
          variant="modal"
          user={location.state?.userPreview || { _id: profileRouteId }}
          onClose={() => navigate(-1)}
          currentUser={currentUser}
        />
      )}
      <Outlet />
      {showBackToast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[90] rounded-full bg-black/70 px-4 py-2 text-xs text-[#faf0e6] shadow-[0_12px_30px_rgba(0,0,0,0.4)]">
          Press back again to exit
        </div>
      )}
    </div>
  );
}
