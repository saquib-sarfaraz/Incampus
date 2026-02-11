export default function StoryBar() {
    return (
      <div className="mb-6">
        <div className="bg-white rounded-xl shadow p-4 krazy-card">
          <div className="flex justify-between items-center mb-3 px-2">
            <h2 className="text-sm font-bold text-slate-500">Stories</h2>
            <button className="text-xs font-semibold px-2 py-1 rounded-full bg-genz-secondary text-white">
              + Add Story
            </button>
          </div>
  
          <div className="flex space-x-4 overflow-x-auto pb-2">
            {["You", "nemat E", "saad D"].map((u, i) => (
              <div key={i} className="w-16 flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-genz-primary flex items-center justify-center text-white">
                  {u[0]}
                </div>
                <p className="text-xs truncate">{u}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  