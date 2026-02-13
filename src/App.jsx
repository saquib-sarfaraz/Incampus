import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthProvider";
import { AppProvider } from "./context/AppContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import PageLoader from "./components/common/PageLoader";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Landing from "./pages/Landing";
import AuthSuccess from "./pages/AuthSuccess";
import CollegeSetup from "./pages/CollegeSetup";
import Feed from "./pages/Feed";
import { preloadChatPage } from "./utils/preloadRoutes";

const Chat = lazy(preloadChatPage);
const Profile = lazy(() => import("./pages/Profile"));
const Trending = lazy(() => import("./pages/Trending"));

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

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AppProvider>
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
                path="/feed"
                element={
                  <ProtectedRoute>
                    <Feed />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/home"
                element={
                  <ProtectedRoute>
                    <Feed />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chat"
                element={
                  <ProtectedRoute>
                    <Chat />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/trending"
                element={
                  <ProtectedRoute>
                    <Trending />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AppProvider>
      </AuthProvider>
    </Router>
  );
}
