import { useEffect, useState } from "react";
import StoryBar from "../components/StoryBar";
import PostCreator from "../components/PostCreator";
import Post from "../components/Post";

const API_BASE_URL = import.meta.env.VITE_API_URL;

export default function FeedView({ authToken }) {
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    if (!authToken) return;

    fetch(`${API_BASE_URL}/posts`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
      .then(res => res.json())
      .then(data => setPosts(data.posts || []))
      .catch(console.error);
  }, [authToken]);

  return (
    <main className="max-w-5xl mx-auto py-6 px-4">
      <StoryBar />
      <PostCreator />
      <div className="space-y-6">
        {posts.map((post, index) => {
          const postKey =
            post?._id || post?.id || post?.postId || post?.post_id || `post-${index}`;
          return <Post key={String(postKey)} post={post} />;
        })}
      </div>
    </main>
  );
}
