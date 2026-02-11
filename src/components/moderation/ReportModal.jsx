import { useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";

const DEFAULT_REASONS = [
  "Spam",
  "Abuse",
  "Hate Speech",
  "Fake Account",
  "Harassment",
];

const buildReasonsKey = (reasons = []) => reasons.join("|");

const ReportModalContent = ({ onClose, onSubmit, title, reasons }) => {
  const [reason, setReason] = useState(reasons[0] || "Spam");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!onSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ reason, details: details.trim() });
      onClose?.();
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <Motion.div
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="w-full sm:max-w-md glass-card rounded-t-3xl sm:rounded-3xl p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#faf0e6]">{title}</h3>
          <button
            onClick={onClose}
            className="text-[#b9b4c7] hover:text-[#faf0e6] text-xl"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
              Reason
            </label>
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-xl px-3.5 py-2.5 text-sm glass-input"
            >
              {reasons.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#b9b4c7]">
              Details (optional)
            </label>
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={3}
              placeholder="Add context to help moderation."
              className="w-full rounded-2xl glass-input p-3 text-sm resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-xs font-semibold text-[#b9b4c7] hover:text-[#faf0e6]"
            >
              Cancel
            </button>
            <Motion.button
              type="submit"
              disabled={submitting}
              className="liquid-button text-xs font-semibold px-4 py-2 rounded-full text-[#faf0e6] disabled:opacity-60"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {submitting ? "Submitting..." : "Submit Report"}
            </Motion.button>
          </div>
        </form>
      </Motion.div>
    </Motion.div>
  );
};

export default function ReportModal({
  isOpen,
  onClose,
  onSubmit,
  title = "Report",
  reasons = DEFAULT_REASONS,
}) {
  const reasonsKey = buildReasonsKey(reasons);

  return (
    <AnimatePresence>
      {isOpen && (
        <ReportModalContent
          key={`${title}-${reasonsKey}`}
          onClose={onClose}
          onSubmit={onSubmit}
          title={title}
          reasons={reasons}
        />
      )}
    </AnimatePresence>
  );
}
