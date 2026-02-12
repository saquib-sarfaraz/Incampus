import { AnimatePresence, motion as Motion } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import { useApp } from "../../context/useApp";

export default function ChatToastContainer() {
  const navigate = useNavigate();
  const location = useLocation();
  const { chatToasts, dismissChatToast, requestChatOpen } = useApp();

  if (!chatToasts || chatToasts.length === 0) return null;

  const handleToastClick = (toast) => {
    dismissChatToast(toast.id);
    if (toast.chatId) {
      requestChatOpen(toast.chatId);
      if (location.pathname !== "/chat") {
        navigate("/chat");
      }
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed top-20 right-4 left-4 sm:left-auto z-50 space-y-3">
        {chatToasts.map((toast) => (
          <Motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="toast-card rounded-2xl px-4 py-3 text-sm text-[#faf0e6] shadow-lg cursor-pointer"
            onClick={() => handleToastClick(toast)}
          >
            <div className="flex items-center gap-3">
              {toast.avatar && (
                <img
                  src={toast.avatar}
                  alt={toast.title}
                  className="h-9 w-9 rounded-full object-cover"
                />
              )}
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.2em] text-[#b9b4c7] truncate">
                  {toast.title}
                </p>
                <p className="mt-1 truncate">{toast.message}</p>
              </div>
            </div>
          </Motion.div>
        ))}
      </div>
    </AnimatePresence>
  );
}
