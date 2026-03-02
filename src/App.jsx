import { Suspense, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "./context/AuthProvider";
import { AppProvider } from "./context/AppContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import PageLoader from "./components/common/PageLoader";
import RootTabs from "./components/common/RootTabs";
import { preloadChatPage } from "./utils/preloadRoutes";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Landing from "./pages/Landing";
import AuthSuccess from "./pages/AuthSuccess";
import CollegeSetup from "./pages/CollegeSetup";
import InstallBanner from "./components/InstallBanner";

export default function App() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefetch = () => {
      preloadChatPage().catch(() => {});
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 1500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(prefetch, 800);
    return () => window.clearTimeout(id);
  }, []);

  const BodyOverflowReset = () => {
    const location = useLocation();
    useEffect(() => {
      if (typeof document === "undefined") return;
      document.body.style.overflow = "";
      document.body.style.overflowX = "";
      document.body.style.overflowY = "";
    }, [location.pathname]);
    return null;
  };

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AppProvider>
          <BodyOverflowReset />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/auth-success" element={<AuthSuccess />} />
              <Route
                path="/college-setup"
                element={
                  <ProtectedRoute>
                    <CollegeSetup />
                  </ProtectedRoute>
                }
              />
              <Route
                element={
                  <ProtectedRoute>
                    <RootTabs />
                  </ProtectedRoute>
                }
              >
                <Route path="/feed" element={<div />} />
                <Route path="/home" element={<div />} />
                <Route path="/trending" element={<div />} />
                <Route path="/chat" element={<div />} />
                <Route path="/chat/:chatId" element={<div />} />
                <Route path="/notifications" element={<div />} />
                <Route path="/profile" element={<div />} />
                <Route path="/profile/:userId" element={<div />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <InstallBanner />
        </AppProvider>
      </AuthProvider>
    </Router>
  );
}
