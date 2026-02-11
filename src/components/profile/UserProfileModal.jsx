import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useApp } from "../../context/useApp";
import { sendFriendRequest, reportUser, blockUser } from "../../services/api";
import ReportModal from "../moderation/ReportModal";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

const UserProfileModalContent = ({
  user,
  onClose,
  currentUser,
  requested = false,
  onRequestSent,
}) => {
  const { posts, loadPosts, addBlockedUser } = useApp();
  const navigate = useNavigate();
  const [requestSent, setRequestSent] = useState(Boolean(requested));
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const publicPosts = useMemo(() => {
    if (!user) return [];
    const list = Array.isArray(posts) ? posts : [];
    return list.filter((post) => {
      const authorId = post.author?._id || post.authorId || post.author;
      const userId = user._id || user.id;
      if (String(authorId) !== String(userId)) return false;
      return !post.isAnonymous && !post.author?.isAnonymous;
    });
  }, [posts, user]);

  if (!user) return null;
  const userId = user._id || user.id;
  const isSelf = String(userId) === String(currentUser?.id);
  const isFriend = (currentUser?.friends || []).includes(userId);
  const isRequestSent = requestSent || Boolean(requested);

  const handleAddFriend = async () => {
    if (!userId || isFriend || isSelf || isRequestSent) return;
    setRequestSent(true);
    try {
      await sendFriendRequest(userId);
      onRequestSent?.(userId);
    } catch (error) {
      setRequestSent(false);
      alert(error.message || "Failed to send request");
    }
  };

  const handleMessage = () => {
    navigate("/chat");
    onClose?.();
  };

  const handleReportUser = () => {
    setShowReport(true);
  };

  const submitReport = async ({ reason, details }) => {
    if (!userId) return;
    try {
      await reportUser(userId, {
        reason,
        details,
        context: "user_profile_modal",
      });
      alert("Thanks for reporting. Our team will review it.");
    } catch (error) {
      alert(error.message || "Failed to report user");
      throw error;
    }
  };

  const handleBlockUser = async () => {
    if (!userId) return;
    if (!confirm("Block this user? You will no longer see their content.")) return;
    try {
      await blockUser(userId, { context: "user_profile_modal" });
      addBlockedUser(userId);
      onClose?.();
      alert("User blocked.");
    } catch (error) {
      alert(error.message || "Failed to block user");
    }
  };

  return (
    <>
      <Motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        onClick={onClose}
      >
        <Motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 240 }}
          className="w-full max-w-2xl glass-card rounded-3xl p-6 sm:p-8"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <img
                src={user.profilePicUrl || ANONYMOUS_AVATAR}
                alt={user.fullName || user.username}
                className="h-14 w-14 rounded-full object-cover"
              />
              <div>
                <h3 className="text-lg font-semibold text-[#faf0e6]">
                  {user.fullName || user.displayName || user.username || "User"}
                </h3>
                <p className="text-xs text-[#b9b4c7]">@{user.username || "student"}</p>
                <p className="text-xs text-[#b9b4c7] mt-1">
                  {user.university || user.college || "Verified Campus"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isSelf &&
                (isFriend ? (
                  <button
                    onClick={handleMessage}
                    className="liquid-button text-xs font-semibold px-3 py-2 rounded-full text-[#faf0e6]"
                  >
                    <i className="fa-solid fa-message mr-1"></i> Message
                  </button>
                ) : (
                  <button
                    onClick={handleAddFriend}
                    disabled={isRequestSent}
                    className={`text-xs font-semibold px-3 py-2 rounded-full ${
                      isRequestSent
                        ? "bg-white/10 text-[#b9b4c7] cursor-not-allowed"
                        : "liquid-button text-[#faf0e6]"
                    }`}
                  >
                    <i className="fa-solid fa-user-plus mr-1"></i>
                    {isRequestSent ? "Requested" : "Add Friend"}
                  </button>
                ))}
              {!isSelf && (
                <button
                  onClick={handleReportUser}
                  className="text-xs font-semibold px-3 py-2 rounded-full border border-amber-300/40 text-amber-200 hover:bg-amber-300/10"
                >
                  <i className="fa-solid fa-flag mr-1"></i>
                  Report
                </button>
              )}
              {!isSelf && (
                <button
                  onClick={handleBlockUser}
                  className="text-xs font-semibold px-3 py-2 rounded-full border border-rose-300/40 text-rose-200 hover:bg-rose-300/10"
                >
                  <i className="fa-solid fa-ban mr-1"></i>
                  Block
                </button>
              )}
              <button
                onClick={onClose}
                className="text-[#b9b4c7] hover:text-[#faf0e6] text-xl"
              >
                &times;
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center text-xs text-[#b9b4c7] mb-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 py-3">
              <p className="text-base font-semibold text-[#faf0e6]">
                {publicPosts.length}
              </p>
              <p>Public Posts</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 py-3">
              <p className="text-base font-semibold text-[#faf0e6]">
                {user.friends?.length || 0}
              </p>
              <p>Friends</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 py-3">
              <p className="text-base font-semibold text-[#faf0e6]">
                {String(user._id || user.id) === String(currentUser?.id) ? "You" : "Verified"}
              </p>
              <p>Campus</p>
            </div>
          </div>

          <div className="mb-6">
            <h4 className="text-sm font-semibold text-[#faf0e6] mb-2">Bio</h4>
            <p className="text-sm text-[#b9b4c7]">
              {user.bio || "No bio shared yet."}
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[#faf0e6]">Public Posts</h4>
            {publicPosts.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-[#b9b4c7]">
                No public posts available.
              </div>
            ) : (
              publicPosts.slice(0, 4).map((post) => (
                <div
                  key={post._id || post.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-[#faf0e6]"
                >
                  {post.content || "Campus update"}
                </div>
              ))
            )}
            <p className="text-[11px] text-[#b9b4c7]">
              Anonymous posts remain hidden outside the feed.
            </p>
          </div>
        </Motion.div>
      </Motion.div>
      <ReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        onSubmit={submitReport}
        title="Report User"
      />
    </>
  );
};

export default function UserProfileModal({
  isOpen,
  user,
  onClose,
  currentUser,
  requested = false,
  onRequestSent,
}) {
  if (!user) return null;
  const userKey = user._id || user.id || "user";

  return (
    <AnimatePresence>
      {isOpen && (
        <UserProfileModalContent
          key={String(userKey)}
          user={user}
          onClose={onClose}
          currentUser={currentUser}
          requested={requested}
          onRequestSent={onRequestSent}
        />
      )}
    </AnimatePresence>
  );
}
