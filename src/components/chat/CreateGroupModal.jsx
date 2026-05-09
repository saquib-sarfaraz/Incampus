import { useEffect, useMemo, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import { createGroup } from "../../services/api";
import { compressImageFile } from "../../utils/media";

const NAME_MAX_LENGTH = 60;
const DESC_MAX_LENGTH = 220;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export default function CreateGroupModal({ isOpen, onClose, onCreated }) {
  const { currentUser } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const role = String(currentUser?.role || "");
  const isSuperAdmin = role === "super_admin";
  const canCreate = useMemo(
    () => isSuperAdmin || (role === "community_admin" && currentUser?.isVerifiedCommunity),
    [isSuperAdmin, role, currentUser?.isVerifiedCommunity]
  );

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setDescription("");
      setVisibility("public");
      setImageFile(null);
      setImagePreview("");
      setError("");
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!imagePreview) return;
    return () => {
      if (imagePreview.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const handleClose = () => {
    if (loading) return;
    onClose?.();
  };

  const handleImageChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError("Please upload an image under 10MB.");
      return;
    }
    setError("");
    const compressed = await compressImageFile(file, { maxDimension: 1200, quality: 0.85 });
    setImageFile(compressed);
    const previewUrl = URL.createObjectURL(compressed);
    setImagePreview(previewUrl);
  };

  const handleSubmit = async () => {
    if (!canCreate) {
      setError("You do not have permission to create a group.");
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("Group name is required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = {
        name: trimmedName,
        description: description.trim(),
        visibility,
      };
      if (isSuperAdmin) {
        payload.type = "official";
      }
      const response = await createGroup(payload, imageFile);
      const created =
        response?.group ||
        response?.item ||
        response?.data ||
        response?.result ||
        response;
      if (created) {
        onCreated?.(created);
        onClose?.();
        return;
      }
      setError("Group created but response was empty.");
    } catch (err) {
      setError(err?.message || "Failed to create group.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={handleClose}
        >
          <Motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 220 }}
            className="relative w-full max-w-xl glass-card rounded-t-3xl p-6 pb-24 shadow-2xl sm:rounded-3xl sm:pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#faf0e6]">Create Group</p>
                <p className="text-[11px] text-[#b9b4c7]">
                  {isSuperAdmin ? "Official public group" : "Community group"}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="text-xl text-[#b9b4c7] hover:text-[#faf0e6]"
              >
                &times;
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center overflow-hidden">
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Group preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <i className="fa-solid fa-camera text-[#b9b4c7] text-lg" />
                  )}
                </div>
                <div>
                  <label className="text-xs text-[#b9b4c7]">Profile image</label>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-[#faf0e6] cursor-pointer hover:bg-white/10">
                      Upload
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleImageChange}
                      />
                    </label>
                    {imagePreview && (
                      <button
                        type="button"
                        onClick={() => {
                          setImageFile(null);
                          setImagePreview("");
                        }}
                        className="text-[11px] text-[#b9b4c7] hover:text-[#faf0e6]"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-[#b9b4c7]">Group name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, NAME_MAX_LENGTH))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#faf0e6] outline-none focus:border-white/30"
                  placeholder="Type group name"
                />
                <div className="mt-1 text-[10px] text-[#b9b4c7]">
                  {name.length}/{NAME_MAX_LENGTH}
                </div>
              </div>

              <div>
                <label className="text-xs text-[#b9b4c7]">Description</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX_LENGTH))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#faf0e6] outline-none focus:border-white/30"
                  placeholder="Describe your group"
                />
                <div className="mt-1 text-[10px] text-[#b9b4c7]">
                  {description.length}/{DESC_MAX_LENGTH}
                </div>
              </div>

              <div>
                <label className="text-xs text-[#b9b4c7]">Visibility</label>
                <div className="mt-2 flex gap-2">
                  {[
                    { key: "public", label: "Public" },
                    { key: "private", label: "Private" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setVisibility(item.key)}
                      className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
                        visibility === item.key
                          ? "bg-white/15 text-[#faf0e6]"
                          : "bg-white/5 text-[#b9b4c7] hover:text-[#faf0e6]"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[11px] text-[#b9b4c7]">
                Member limit: 100 per group.
              </div>

              {error && (
                <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-200">
                  {error}
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-white/10 px-4 py-2 text-xs text-[#b9b4c7] hover:text-[#faf0e6]"
              >
                Cancel
              </button>
              <Motion.button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className={`rounded-full px-5 py-2 text-xs font-semibold text-[#faf0e6] transition-all duration-200 ease-out ${
                  loading
                    ? "bg-[rgba(92,84,112,0.4)] cursor-not-allowed shadow-none"
                    : "bg-[#5c5470] shadow-[0_4px_14px_rgba(92,84,112,0.35)] hover:bg-[#7a6f8f] hover:shadow-[0_6px_18px_rgba(92,84,112,0.45)] active:scale-95"
                }`}
              >
                {loading ? "Creating..." : "Create group"}
              </Motion.button>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
