import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion as Motion } from "framer-motion";
import { useApp } from "../context/useApp";
import { useAuth } from "../context/authContext";
import StoryBar from "../components/stories/StoryBar";
import Post from "../components/feed/Post";
import PostCreator from "../components/feed/PostCreator";
import Header from "../components/common/Header";
import BottomNav from "../components/common/BottomNav";
import CreatePostModal from "../components/feed/CreatePostModal";
import { fetchRankedFeedPage } from "../services/api";
import {
  getUniversalScore,
  getTimestamp,
  shouldExcludeContent,
  isMutedByUser,
} from "../utils/feedRanking";

const FEED_PAGE_LIMIT = 20;

const getAuthorId = (post) => {
  return post.author?._id || post.authorId || post.author || "";
};

const resolvePostId = (post, index) => {
  const id = post?._id || post?.id || post?.postId || post?.post_id;
  if (id) return String(id);
  return `post-${index}`;
};

const resolvePostIdentity = (post) => {
  const id = post?._id || post?.id || post?.postId || post?.post_id;
  if (id) return String(id);
  const authorId = getAuthorId(post);
  const createdAt = post?.createdAt || post?.created_at || post?.timestamp || "";
  if (authorId || createdAt) return `${authorId || "post"}-${createdAt || "time"}`;
  return "";
};

const resolvePostKey = (post, index) => {
  const id = resolvePostId(post, index);
  if (id) return String(id);
  const authorId = getAuthorId(post);
  const createdAt = post.createdAt || post.created_at || post.timestamp || "";
  if (authorId || createdAt) return `${authorId || "post"}-${createdAt || index}`;
  return `post-${index}`;
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
    post.collegeTagName ||
    post.collegeTag ||
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

const resolveUserCollegeId = (user) => {
  return (
    user?.collegeId ||
    user?.collegeTagId ||
    user?.college_group_id ||
    user?.collegeGroupId ||
    user?.collegeGroup ||
    user?.groupId ||
    ""
  );
};

const resolvePostCollegeId = (post) => {
  return (
    post.collegeId ||
    post.collegeTagId ||
    post.college_group_id ||
    post.collegeGroupId ||
    post.collegeGroup ||
    post.groupId ||
    post.college?.id ||
    post.college?._id ||
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
  if (raw.includes("college") || raw.includes("campus")) return "college";
  if (raw.includes("universal") || raw.includes("public")) return "public";
  if (post.friendsOnly === true || post.isPrivate === true || post.private === true) {
    return "friends";
  }
  if (post.collegeOnly === true || post.campusOnly === true) {
    return "college";
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
  const { posts, loading, feedScope, isUserBlocked, isFriend, loadPosts, loadStories } =
    useApp();
  const { currentUser } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [rankedPosts, setRankedPosts] = useState([]);
  const [rankedPage, setRankedPage] = useState(1);
  const [rankedHasMore, setRankedHasMore] = useState(true);
  const [rankedLoading, setRankedLoading] = useState(false);
  const [rankedError, setRankedError] = useState("");
  const [feedCursor, setFeedCursor] = useState({ key: "", page: 0 });
  const loadMoreRef = useRef(null);
  const prefetchRef = useRef({ page: null, data: null, promise: null });
  const rankedPostsRef = useRef([]);
  const rankedLoadingRef = useRef(false);

  const campusLabel = resolveUserCampus(currentUser);
  const campusId = resolveUserCollegeId(currentUser);
  const shouldFilterByCollege = feedScope === "college";
  const feedKey = useMemo(
    () => `${feedScope}-${campusLabel || ""}-${campusId || ""}`,
    [feedScope, campusLabel, campusId]
  );

  useEffect(() => {
    if (!loadPosts) return;
    const refreshMs = feedScope === "college" ? 30000 : 60000;
    const interval = setInterval(() => {
      loadPosts();
      if (loadStories) {
        loadStories();
      }
    }, refreshMs);
    return () => clearInterval(interval);
  }, [feedScope, loadPosts, loadStories]);

  const consumePrefetch = useCallback((page) => {
    const cached = prefetchRef.current;
    if (cached.page !== page || !Array.isArray(cached.data)) return null;
    prefetchRef.current = { page: null, data: null, promise: null };
    return cached.data;
  }, []);

  const prefetchPage = useCallback(async (page) => {
    if (!page || prefetchRef.current.page === page) return;
    prefetchRef.current = { page, data: null, promise: null };
    try {
      const data = await fetchRankedFeedPage({ page, limit: FEED_PAGE_LIMIT });
      const list = Array.isArray(data) ? data : [];
      if (prefetchRef.current.page === page) {
        prefetchRef.current = { page, data: list, promise: null };
      }
    } catch {
      if (prefetchRef.current.page === page) {
        prefetchRef.current = { page: null, data: null, promise: null };
      }
    }
  }, []);

  const loadRankedPage = useCallback(
    async (page, { replace = false } = {}) => {
      if (rankedLoadingRef.current) return;
      rankedLoadingRef.current = true;
      setRankedLoading(true);
      setRankedError("");
      try {
        const prefetched = consumePrefetch(page);
        const data = prefetched
          ? prefetched
          : await fetchRankedFeedPage({ page, limit: FEED_PAGE_LIMIT });
        const list = Array.isArray(data) ? data : [];
        const basePosts = replace ? [] : rankedPostsRef.current;
        const existingIds = new Set(
          basePosts.map((post) => resolvePostIdentity(post)).filter(Boolean)
        );
        const uniqueList = list.filter((post) => {
          const id = resolvePostIdentity(post);
          if (!id) return true;
          if (existingIds.has(id)) return false;
          existingIds.add(id);
          return true;
        });
        const nextPosts = replace ? uniqueList : [...basePosts, ...uniqueList];
        const addedCount = uniqueList.length;
        rankedPostsRef.current = nextPosts;
        setRankedPosts(nextPosts);
        const canLoadMore = addedCount > 0 && list.length >= FEED_PAGE_LIMIT;
        setRankedHasMore(canLoadMore);
        setRankedPage(page);
        if (canLoadMore) {
          prefetchPage(page + 1);
        }
      } catch (error) {
        setRankedError(error?.message || "Unable to load feed.");
        setRankedHasMore(false);
      } finally {
        rankedLoadingRef.current = false;
        setRankedLoading(false);
      }
    },
    [consumePrefetch, prefetchPage]
  );

  const loadMoreRanked = useCallback(() => {
    if (rankedLoading || !rankedHasMore) return;
    loadRankedPage(rankedPage + 1);
  }, [rankedLoading, rankedHasMore, rankedPage, loadRankedPage]);

  useEffect(() => {
    if (shouldFilterByCollege) return;
    setRankedPosts([]);
    setRankedPage(1);
    setRankedHasMore(true);
    setRankedError("");
    prefetchRef.current = { page: null, data: null, promise: null };
    rankedPostsRef.current = [];
    rankedLoadingRef.current = false;
    loadRankedPage(1, { replace: true });
  }, [shouldFilterByCollege, loadRankedPage]);

  const scopedPosts = useMemo(() => {
    const postsArray = (Array.isArray(posts) ? posts : []).filter((post) => {
      if (shouldExcludeContent(post)) return false;
      const authorId = getAuthorId(post);
      if (isUserBlocked(authorId)) return false;
      if (isMutedByUser(post, currentUser?.id)) return false;
      const privacy = resolvePostPrivacy(post);
      if (privacy === "friends") {
        if (!shouldFilterByCollege) return false;
        if (!isFriend(authorId) && String(authorId) !== String(currentUser?.id)) {
          return false;
        }
      }
      if (privacy === "college" && !shouldFilterByCollege) {
        return false;
      }
      return true;
    });
    return postsArray;
  }, [
    posts,
    shouldFilterByCollege,
    isUserBlocked,
    isFriend,
    currentUser?.id,
  ]);

  const matchesCollege = useCallback(
    (post) => {
      const postCollegeId = resolvePostCollegeId(post);
      if (campusId && postCollegeId) {
        return String(campusId) === String(postCollegeId);
      }
      if (!campusLabel) return false;
      const campusLower = campusLabel.toLowerCase();
      return matchesCampus(post, campusLower);
    },
    [campusId, campusLabel]
  );

  const collegeFeedPosts = useMemo(() => {
    if (!shouldFilterByCollege) return [];
    if (!campusLabel && !campusId) {
      return [...scopedPosts].sort((a, b) => getTimestamp(b) - getTimestamp(a));
    }
    return scopedPosts
      .filter((post) => {
        const authorId = getAuthorId(post);
        if (String(authorId) === String(currentUser?.id)) return true;
        return matchesCollege(post);
      })
      .sort((a, b) => getTimestamp(b) - getTimestamp(a));
  }, [shouldFilterByCollege, scopedPosts, campusLabel, campusId, currentUser?.id, matchesCollege]);

  const universalFeedPosts = useMemo(() => {
    if (shouldFilterByCollege) return [];
    const base = rankedPosts.length > 0 ? rankedPosts : scopedPosts;
    return base.filter((post) => {
      if (shouldExcludeContent(post)) return false;
      const authorId = getAuthorId(post);
      if (isUserBlocked(authorId)) return false;
      if (isMutedByUser(post, currentUser?.id)) return false;
      const privacy = resolvePostPrivacy(post);
      return privacy === "public";
    });
  }, [
    shouldFilterByCollege,
    rankedPosts,
    scopedPosts,
    isUserBlocked,
    currentUser?.id,
  ]);

  const popularPostIds = useMemo(() => {
    if (shouldFilterByCollege || universalFeedPosts.length === 0) return new Set();
    const scored = universalFeedPosts.map((post, index) => ({
      id: resolvePostId(post, index),
      score: getUniversalScore(post),
    }));
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const take = Math.max(1, Math.ceil(sorted.length * 0.1));
    return new Set(sorted.slice(0, take).map((entry) => entry.id));
  }, [shouldFilterByCollege, universalFeedPosts]);

  const finalFeedPosts = shouldFilterByCollege ? collegeFeedPosts : universalFeedPosts;
  const activePage = feedCursor.key === feedKey ? feedCursor.page : 0;
  const visibleCount = 8 + activePage * 6;
  const showSkeletons = shouldFilterByCollege
    ? loading && finalFeedPosts.length === 0
    : rankedLoading && finalFeedPosts.length === 0 && !rankedError;
  const hasMore = shouldFilterByCollege
    ? visibleCount < finalFeedPosts.length
    : rankedHasMore;
  const displayedPosts = shouldFilterByCollege
    ? finalFeedPosts.slice(0, visibleCount)
    : finalFeedPosts;
  const showRankedError =
    !shouldFilterByCollege && rankedError && finalFeedPosts.length === 0;

  useEffect(() => {
    if (!loadMoreRef.current) return;
    if (!hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (shouldFilterByCollege) {
          setFeedCursor((prev) => {
            const basePage = prev.key === feedKey ? prev.page : 0;
            const maxPage = Math.max(0, Math.ceil((finalFeedPosts.length - 8) / 6));
            const nextPage = Math.min(basePage + 1, maxPage);
            return { key: feedKey, page: nextPage };
          });
        } else {
          loadMoreRanked();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [
    hasMore,
    finalFeedPosts.length,
    feedKey,
    shouldFilterByCollege,
    loadMoreRanked,
  ]);

  return (
    <div id="feed-view" className="min-h-screen flex flex-col pb-24 sm:pb-6">
      <Header />
      <main id="feed" className="max-w-6xl mx-auto w-full py-6 px-4 sm:px-6 lg:px-8">
        <div className="mb-6 space-y-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.25em] text-[#b9b4c7]">
              {feedScope === "college" ? "🏫 Your Campus Feed" : "🌍 Campus Network"}
            </p>
            {!shouldFilterByCollege && popularPostIds.size > 0 && (
              <span className="inline-flex w-fit items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">
                🔥 Popular Now
              </span>
            )}
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
          ) : showRankedError ? (
            <div className="text-center py-12 glass-card rounded-3xl">
              <i className="fa-solid fa-triangle-exclamation text-3xl text-[#b9b4c7] mb-3"></i>
              <p className="text-[#b9b4c7]">{rankedError}</p>
            </div>
          ) : finalFeedPosts.length === 0 ? (
            <div className="text-center py-12 glass-card rounded-3xl">
              <i className="fa-solid fa-inbox text-3xl text-[#b9b4c7] mb-3"></i>
              <p className="text-[#b9b4c7]">
                No posts yet. Be the first to share!
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {displayedPosts.map((post, index) => {
                const postId = resolvePostId(post, index);
                const isPopular =
                  !shouldFilterByCollege && popularPostIds.has(postId);
                const badge = isPopular
                  ? {
                      text: "🔥 Popular Now",
                      tone: "border-amber-400/30 bg-amber-400/10 text-amber-200",
                    }
                  : null;
                return (
                  <Post
                    key={resolvePostKey(post, index)}
                    post={post}
                    badge={badge}
                  />
                );
              })}
              {hasMore && (
                <div
                  ref={loadMoreRef}
                  className="h-10 flex items-center justify-center text-xs text-[#b9b4c7]"
                >
                  Loading more...
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
