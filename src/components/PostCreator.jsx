import { useState } from "react";

export default function PostCreator() {
  const [text, setText] = useState("");
  const [anon, setAnon] = useState(false);

  return (
    <div className="mb-6">
      <div className="bg-white rounded-xl shadow p-4 krazy-card">
        <textarea
          className="w-full border-0 rounded-md p-2 text-slate-700 resize-none"
          rows="3"
          placeholder="What's on your mind?"
          value={text}
          onChange={e => setText(e.target.value)}
        />

        <div className="flex justify-between items-center mt-4 pt-4 border-t">
          <label className="flex items-center space-x-2">
            <span className="text-sm">Post Anonymously</span>
            <input
              type="checkbox"
              checked={anon}
              onChange={() => setAnon(!anon)}
            />
          </label>

          <button className="bg-genz-primary text-white px-5 py-2 rounded-full">
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
