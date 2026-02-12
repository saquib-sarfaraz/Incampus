import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useApp } from "../../context/useApp";
import { getUserById, reportUser, blockUser } from "../../services/api";
import ReportModal from "../moderation/ReportModal";
import PostModal from "./PostModal";
import { isVideoUrl } from "../../utils/storyMedia";
import {
  resolveStudentType,
  formatStudentType,
  resolveCollegeName,
  resolveUserBio,
  resolveUserType,
  formatUserType,
  resolveCommunityName,
  resolveCommunityType,
  formatCommunityType,
  resolveCommunityDescription,
  resolveMemberCount,
} from "../../utils/userProfile";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=A";

const resolvePostMediaUrl = (post) => {
  if (!post) return "";
  return (
    post.mediaUrl ||
    post.media?.url ||
    post.media?.secure_url ||
    post.media?.secureUrl ||
    post.media?.publicUrl ||
    post.imageUrl ||
    post.image ||
    post.videoUrl ||
    post.video ||
    post.fileUrl ||
    post.file ||
    ""
  );
};

const isPostAnonymous = (post) => {
  return Boolean(
    post?.isAnonymous ||
      post?.is_anonymous ||
      post?.anonymous ||
      post?.author?.isAnonymous ||
      post?.author?.anonymous
  );
};

const isPostPublic = (post) => {
  const visibility = post?.visibility || post?.privacy || post?.access || "";
  if (typeof visibility === "string" && visibility) {
    const value = visibility.toLowerCase();
    if (value.includes("public") || value.includes("universal")) return true;
    if (value.includes("friend") || value.includes("private")) return false;
  }
  if (post?.isPublic === true || post?.public === true) return true;
  if (post?.friendsOnly === true || post?.isPrivate === true) return false;
  return true;
};

const UserProfileModalContent = ({
  user,
  onClose,
  currentUser,
}) => {
  const { posts, loadPosts, addBlockedUser, canChat } = useApp();
  const navigate = useNavigate();
  const [showReport, setShowReport] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [profileUser, setProfileUser] = useState(user);
  const [profileLoading, setProfileLoading] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);

  const baseUserId = user?._id || user?.id;

  useEffect(() => {
    setProfileUser(user);
  }, [user]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    let isActive = true;
    const loadProfile = async () => {
      if (!baseUserId) return;
      setProfileLoading(true);
      const data = await getUserById(baseUserId);
      if (isActive && data) {
        setProfileUser(data);
      }
      if (isActive) setProfileLoading(false);
    };
    loadProfile();
    return () => {
      isActive = false;
    };
  }, [baseUserId]);

  const resolvedUser = profileUser || user;
  const resolvedUserId = resolvedUser?._id || resolvedUser?.id || baseUserId;

  const publicPosts = useMemo(() => {
    if (!resolvedUserId) return [];
    const list = Array.isArray(posts) ? posts : [];
    return list
      .filter((post) => {
        const authorId = post.author?._id || post.authorId || post.author;
        if (String(authorId) !== String(resolvedUserId)) return false;
        if (isPostAnonymous(post)) return false;
        if (!isPostPublic(post)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [posts, resolvedUserId]);

  if (!resolvedUser) return null;
  const isSelf = String(resolvedUserId) === String(currentUser?.id);
  const userType = resolveUserType(resolvedUser);
  const isCommunity = userType === "community";
  const userTypeBadge = formatUserType(userType);
  const studentTypeLabel = formatStudentType(resolveStudentType(resolvedUser));
  const showStudentTypeBadge = !isCommunity && studentTypeLabel !== userTypeBadge;
  const collegeLabel = resolveCollegeName(resolvedUser) || (isCommunity ? "" : "College");
  const bioText = resolveUserBio(resolvedUser) || "No bio shared yet.";
  const communityName = resolveCommunityName(resolvedUser);
  const communityTypeLabel = formatCommunityType(resolveCommunityType(resolvedUser));
  const communityDescription =
    resolveCommunityDescription(resolvedUser) || "No description shared yet.";
  const friendCount = Number(
    resolvedUser.friendCount ||
      resolvedUser.friendsCount ||
      resolvedUser.friends?.length ||
      0
  );
  const memberCount = Number(resolveMemberCount(resolvedUser) || 0);
  const fallbackPublicCount = Number(
    resolvedUser.publicPostCount ||
      resolvedUser.publicPostsCount ||
      resolvedUser.postCount ||
      0
  );
  const publicPostCount = publicPosts.length > 0 ? publicPosts.length : fallbackPublicCount;
  const canMessage = Boolean(resolvedUserId) && (isSelf || canChat(resolvedUserId));

  const handleMessage = () => {
    if (!canMessage) return;
    navigate("/chat");
    onClose?.();
  };

  const handleReportUser = () => {
    setOptionsOpen(false);
    setShowReport(true);
  };

  const submitReport = async ({ reason, details }) => {
    if (!resolvedUserId) return;
    try {
      await reportUser(resolvedUserId, {
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
    if (!resolvedUserId) return;
    if (!confirm("Block this user? You will no longer see their content.")) return;
    try {
      await blockUser(resolvedUserId, { context: "user_profile_modal" });
      addBlockedUser(resolvedUserId);
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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-0 sm:p-4"
        onClick={onClose}
      >
        <Motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 240 }}
          className="relative w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl glass-card rounded-none sm:rounded-3xl p-6 sm:p-8 overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <img
                src={resolvedUser.profilePicUrl || ANONYMOUS_AVATAR}
                alt={communityName || resolvedUser.fullName || resolvedUser.username}
                className="h-14 w-14 rounded-full object-cover"
              />
              <div>
                <h3 className="text-lg font-semibold text-[#faf0e6]">
                  {communityName ||
                    resolvedUser.fullName ||
                    resolvedUser.displayName ||
                    resolvedUser.username ||
                    "User"}
                </h3>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] text-[#faf0e6]">
                    {userTypeBadge}
                  </span>
                  {showStudentTypeBadge && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-[#faf0e6]">
                      {studentTypeLabel}
                    </span>
                  )}
                  {collegeLabel && (
                    <span className="text-xs text-[#b9b4c7]">{collegeLabel}</span>
                  )}
                  {isCommunity && communityTypeLabel && (
                    <span className="text-xs text-[#b9b4c7]">{communityTypeLabel}</span>
                  )}
                </div>
                {profileLoading && (
                  <p className="text-[10px] text-[#b9b4c7] mt-1">Updating profile...</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isSelf && (
                <button
                  onClick={() => setOptionsOpen(true)}
                  className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] hover:bg-white/10"
                  aria-label="More options"
                >
                  <i className="fa-solid fa-circle-info text-sm"></i>
                </button>
              )}
              <button
                onClick={onClose}
                className="text-[#b9b4c7] hover:text-[#faf0e6] text-xl"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center text-xs text-[#b9b4c7] mb-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 py-3">
              <p className="text-base font-semibold text-[#faf0e6]">
                {publicPostCount}
              </p>
              <p>Public Posts</p>
            </div>
            {isCommunity ? (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/5 py-3">
                  <p className="text-base font-semibold text-[#faf0e6]">{memberCount}</p>
                  <p>Members</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 py-3">
                  <p className="text-base font-semibold text-[#faf0e6]">
                    {communityTypeLabel || "Community"}
                  </p>
                  <p>Type</p>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/5 py-3">
                  <p className="text-base font-semibold text-[#faf0e6]">{friendCount}</p>
                  <p>Friends</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 py-3">
                  <p className="text-base font-semibold text-[#faf0e6]">{studentTypeLabel}</p>
                  <p>Student Type</p>
                </div>
              </>
            )}
          </div>

          <div className="mb-6">
            <h4 className="text-sm font-semibold text-[#faf0e6] mb-2">
              {isCommunity ? "About" : "Bio"}
            </h4>
            <p className="text-sm text-[#b9b4c7]">
              {isCommunity ? communityDescription : bioText}
            </p>
          </div>

          <div className="space-y-3 pb-16 sm:pb-4">
            <h4 className="text-sm font-semibold text-[#faf0e6]">Public Posts</h4>
            {publicPosts.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-[#b9b4c7]">
                No public posts available.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {publicPosts.map((post) => {
                  const mediaUrl = resolvePostMediaUrl(post);
                  const isVideo =
                    isVideoUrl(mediaUrl) ||
                    String(post.mediaType || post.type || "").toLowerCase().includes("video");
                  return (
                    <button
                      key={post._id || post.id}
                      type="button"
                      onClick={() => setSelectedPost(post)}
                      className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/5"
                    >
                      {mediaUrl ? (
                        isVideo ? (
                          <video
                            src={mediaUrl}
                            className="h-full w-full object-cover"
                            muted
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          <img
                            src={mediaUrl}
                            alt="Post"
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        )
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-white/5 text-[10px] text-[#b9b4c7] px-2 text-center">
                          {post.content ? post.content.slice(0, 40) : "Post"}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent"></div>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-[#b9b4c7]">
              Anonymous posts remain hidden outside the feed.
            </p>
          </div>

          {!isSelf && (
            <div className="sticky bottom-0 left-0 right-0 mt-6 bg-gradient-to-t from-[#120f0a]/95 via-[#120f0a]/85 to-transparent pt-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleMessage}
                  disabled={!canMessage}
                  className={`flex-1 liquid-button text-xs font-semibold px-4 py-3 rounded-full text-[#faf0e6] ${
                    canMessage ? "" : "opacity-60 cursor-not-allowed"
                  }`}
                >
                  <i className="fa-solid fa-message mr-2"></i>
                  {canMessage ? "Message" : "Friends only"}
                </button>
                <button
                  onClick={() => setOptionsOpen(true)}
                  className="h-11 w-11 rounded-full border border-white/10 bg-white/5 text-[#faf0e6] hover:bg-white/10"
                  aria-label="More options"
                >
                  <i className="fa-solid fa-circle-info"></i>
                </button>
              </div>
            </div>
          )}
        </Motion.div>
      </Motion.div>

      <AnimatePresence>
        {optionsOpen && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-4 sm:items-center"
            onClick={() => setOptionsOpen(false)}
          >
            <Motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 220 }}
              className="w-full max-w-md rounded-3xl glass-card p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[#faf0e6]">More Actions</h3>
                <button
                  onClick={() => setOptionsOpen(false)}
                  className="text-[#b9b4c7] hover:text-[#faf0e6] text-xl"
                >
                  &times;
                </button>
              </div>
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={handleReportUser}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-amber-200 hover:bg-white/10"
                >
                  <i className="fa-solid fa-flag mr-2"></i>
                  Report User
                </button>
                <button
                  type="button"
                  onClick={handleBlockUser}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-rose-200 hover:bg-white/10"
                >
                  <i className="fa-solid fa-ban mr-2"></i>
                  Block User
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-[#faf0e6] hover:bg-white/10"
                >
                  <i className="fa-solid fa-xmark mr-2"></i>
                  Close
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>

      <ReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        onSubmit={submitReport}
        title="Report User"
      />

      {selectedPost && (
        <PostModal
          post={selectedPost}
          isOpen={!!selectedPost}
          onClose={() => setSelectedPost(null)}
          onDelete={() => {}}
        />
      )}
    </>
  );
};

export default function UserProfileModal({
  isOpen,
  user,
  onClose,
  currentUser,
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
        />
      )}
    </AnimatePresence>
  );
}
