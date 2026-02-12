import { useState, useMemo, useCallback } from "react";
import { motion as Motion } from "framer-motion";
import { useApp } from "../context/useApp";
import { useAuth } from "../context/authContext";
import StoryBar from "../components/stories/StoryBar";
import Post from "../components/feed/Post";
import PostCreator from "../components/feed/PostCreator";
import Header from "../components/common/Header";
import BottomNav from "../components/common/BottomNav";
import CreatePostModal from "../components/feed/CreatePostModal";

const getPostTimestamp = (post) => {
  if (!post.createdAt) return 0;
  const ts = new Date(post.createdAt).getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

const getAuthorId = (post) => {
  return post.author?._id || post.authorId || post.author || "";
};

const resolveUserCampus = (user) => {
  return (
    user?.university ||
    user?.college ||
    user?.campus ||
    user?.school ||
    user?.course ||
    ""
  );
};

const resolvePostCampus = (post) => {
  return (
    post.university ||
    post.college ||
    post.campus ||
    post.school ||
    post.author?.university ||
    post.author?.college ||
    post.author?.campus ||
    post.author?.school ||
    ""
  );
};

const resolvePostCollegeTag = (post) => {
  return (
    post.collegeTagName ||
    post.collegeTag ||
    post.collegeName ||
    post.college ||
    post.university ||
    ""
  );
};

const resolvePostPrivacy = (post) => {
  const raw = String(
    post.visibility ||
      post.privacy ||
      post.privacyType ||
      post.postVisibility ||
      post.audience ||
      ""
  ).toLowerCase();
  if (raw.includes("friend") || raw.includes("private")) return "friends";
  if (raw.includes("universal") || raw.includes("public")) return "public";
  if (post.friendsOnly === true || post.isPrivate === true || post.private === true) {
    return "friends";
  }
  return "public";
};

const matchesCampus = (post, campusLower) => {
  const postCampus = resolvePostCampus(post);
  const postTag = resolvePostCollegeTag(post);
  const campusMatch =
    postCampus && String(postCampus).toLowerCase() === campusLower;
  const tagMatch = postTag && String(postTag).toLowerCase() === campusLower;
  return campusMatch || tagMatch;
};

export default function Feed() {
  const { posts, loading, feedScope, isUserBlocked, isFriend } = useApp();
  const { currentUser } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const campusLabel = resolveUserCampus(currentUser);
  const shouldFilterByCollege = feedScope === "college" && Boolean(campusLabel);

  const scopedPosts = useMemo(() => {
    const postsArray = (Array.isArray(posts) ? posts : []).filter((post) => {
      const authorId = getAuthorId(post);
      if (isUserBlocked(authorId)) return false;
      const privacy = resolvePostPrivacy(post);
      if (
        privacy === "friends" &&
        !isFriend(authorId) &&
        String(authorId) !== String(currentUser?.id)
      ) {
        return false;
      }
      return true;
    });
    if (!shouldFilterByCollege) return postsArray;
    const campusLower = campusLabel.toLowerCase();
    return postsArray.filter((post) => {
      const authorId = getAuthorId(post);
      if (String(authorId) === String(currentUser?.id)) return true;
      if (isFriend(authorId)) return true;
      return matchesCampus(post, campusLower);
    });
  }, [posts, shouldFilterByCollege, campusLabel, isUserBlocked, isFriend, currentUser?.id]);

  const sortedByLatest = useMemo(() => {
    return [...scopedPosts].sort((a, b) => getPostTimestamp(b) - getPostTimestamp(a));
  }, [scopedPosts]);

  const applyFriendBoost = useCallback(
    (list) => {
      return [...list].sort((a, b) => {
        const aFriend = isFriend(getAuthorId(a));
        const bFriend = isFriend(getAuthorId(b));
        if (aFriend !== bFriend) return aFriend ? -1 : 1;
        return getPostTimestamp(b) - getPostTimestamp(a);
      });
    },
    [isFriend]
  );

  const campusPosts = useMemo(() => {
    if (!campusLabel) return [];
    const campusLower = campusLabel.toLowerCase();
    const filtered = sortedByLatest.filter((post) => matchesCampus(post, campusLower));
    return applyFriendBoost(filtered);
  }, [sortedByLatest, campusLabel, applyFriendBoost]);

  const globalPosts = useMemo(() => {
    if (!campusLabel) return sortedByLatest;
    const campusLower = campusLabel.toLowerCase();
    const filtered = sortedByLatest.filter((post) => {
      return !matchesCampus(post, campusLower);
    });
    return applyFriendBoost(filtered);
  }, [sortedByLatest, campusLabel, applyFriendBoost]);

  const finalFeedPosts = useMemo(() => {
    if (shouldFilterByCollege) return campusPosts;
    return campusPosts.length > 0 ? [...campusPosts, ...globalPosts] : sortedByLatest;
  }, [shouldFilterByCollege, campusPosts, globalPosts, sortedByLatest]);

  const showSkeletons = loading && finalFeedPosts.length === 0;

  return (
    <div id="feed-view" className="min-h-screen flex flex-col pb-24 sm:pb-6">
      <Header />
      <main id="feed" className="max-w-6xl mx-auto w-full py-6 px-4 sm:px-6 lg:px-8">
        <div className="mb-6 space-y-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.25em] text-[#b9b4c7]">
              {feedScope === "college" ? "My University Feed" : "Campus Highlights"}
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-[#faf0e6]">
              Campus-first feed
            </h1>
            {feedScope === "college" && !campusLabel && (
              <p className="text-sm text-[#b9b4c7]">
                Set your university to filter your feed. Showing all posts for now.
              </p>
            )}
          </div>
        </div>

        <section className="space-y-6">
          <div className="hidden sm:block">
            <PostCreator />
          </div>
          <StoryBar />

          {showSkeletons ? (
            <div className="space-y-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="glass-card rounded-3xl p-6 animate-pulse"
                >
                  <div className="h-4 bg-white/10 rounded w-3/4 mb-4"></div>
                  <div className="h-28 bg-white/10 rounded mb-4"></div>
                  <div className="h-4 bg-white/10 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : finalFeedPosts.length === 0 ? (
            <div className="text-center py-12 glass-card rounded-3xl">
              <i className="fa-solid fa-inbox text-3xl text-[#b9b4c7] mb-3"></i>
              <p className="text-[#b9b4c7]">
                No posts yet. Be the first to share!
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {!shouldFilterByCollege && campusPosts.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-[#faf0e6]">
                      {campusLabel || "Your University"}
                    </h2>
                    <span className="text-xs text-[#b9b4c7]">Campus priority</span>
                  </div>
                  <div className="space-y-6">
                    {campusPosts.map((post) => (
                      <Post key={post._id} post={post} />
                    ))}
                  </div>
                </div>
              )}

              {!shouldFilterByCollege && globalPosts.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-[#faf0e6]">Global Highlights</h2>
                    <span className="text-xs text-[#b9b4c7]">All campuses</span>
                  </div>
                  <div className="space-y-6">
                    {globalPosts.map((post) => (
                      <Post key={post._id} post={post} />
                    ))}
                  </div>
                </div>
              )}

              {shouldFilterByCollege && (
                <div className="space-y-6">
                  {finalFeedPosts.map((post) => (
                    <Post key={post._id} post={post} />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      <Motion.button
        type="button"
        onClick={() => setShowCreateModal(true)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={`hidden sm:flex fixed bottom-6 right-6 z-40 create-fab liquid-button h-14 w-14 items-center justify-center text-[#faf0e6] ${
          showCreateModal ? "opacity-0 pointer-events-none" : ""
        }`}
        aria-label="Create post"
      >
        <i className="fa-solid fa-plus text-lg"></i>
      </Motion.button>
      <CreatePostModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <BottomNav onCreate={() => setShowCreateModal(true)} overlay={showCreateModal} />
    </div>
  );
}
