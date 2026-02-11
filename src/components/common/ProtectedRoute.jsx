import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/authContext";

export default function ProtectedRoute({ children }) {
  const { authToken, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#b9b4c7]"></div>
      </div>
    );
  }

  return authToken ? children : <Navigate to="/login" replace />;
}
