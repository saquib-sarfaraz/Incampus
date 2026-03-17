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
      <div className="fixed top-16 right-2 left-auto z-50 w-56 max-w-[75vw] space-y-1.5">
        {chatToasts.map((toast, index) => {
          const toastKey = toast?.id || `toast-${index}`;
          return (
          <Motion.div
            key={String(toastKey)}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="toast-card rounded-lg px-2 py-1.5 text-[10px] text-[#faf0e6] shadow-lg cursor-pointer"
            onClick={() => handleToastClick(toast)}
          >
            <div className="flex items-center gap-2">
              {toast.avatar && (
                <img
                  src={toast.avatar}
                  alt={toast.title}
                  className="h-6 w-6 rounded-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              )}
              <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#b9b4c7] truncate">
                  {toast.title}
                </p>
                <p className="mt-0.5 truncate text-[9px]">{toast.message}</p>
              </div>
            </div>
          </Motion.div>
        );
        })}
      </div>
    </AnimatePresence>
  );
}
