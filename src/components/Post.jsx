export default function Post({ post }) {
    return (
      <div className="krazy-card bg-white p-4 rounded-xl shadow">
        <div className="flex items-center mb-3">
          <div className="w-10 h-10 rounded-full bg-genz-secondary flex items-center justify-center text-white mr-3">
            {post.author?.[0] || "A"}
          </div>
          <div>
            <p className="font-bold">
              {post.isAnonymous ? "Anonymous Student" : post.author}
            </p>
            <small className="text-slate-500">2h ago</small>
          </div>
        </div>
  
        <p className="text-slate-700 mb-4">{post.content}</p>
  
        <div className="flex justify-around text-slate-500 pt-4 border-t">
          <span>❤️ {post.likesCount || 0} Likes</span>
          <span>💬 {post.comments?.length || 0} Comments</span>
          <span>🔁 {post.repostsCount || 0} Reposts</span>
        </div>
      </div>
    );
  }
  