import { useNavigate } from "react-router-dom";
import ReelUpload from "../components/inbuzz/ReelUpload";

export default function CreateInBuzz() {
  const navigate = useNavigate();
  return (
    <div className="min-h-[100dvh] bg-[#0b0b0f] text-[#faf0e6]">
      <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-4 bg-black/40 backdrop-blur border-b border-white/10">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="h-9 w-9 rounded-full border border-white/10 bg-white/5 flex items-center justify-center"
          aria-label="Back"
        >
          <i className="fa-solid fa-arrow-left"></i>
        </button>
        <div>
          <p className="text-sm font-semibold">Create InBuzz</p>
          <p className="text-[11px] text-[#b9b4c7]">Upload a vertical reel</p>
        </div>
      </div>

      <main className="max-w-5xl mx-auto w-full px-4 py-6 space-y-6">
        <ReelUpload />
      </main>
    </div>
  );
}
