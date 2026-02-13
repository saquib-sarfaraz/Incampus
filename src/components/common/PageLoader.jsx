export default function PageLoader({ label = "Loading..." }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="glass-card rounded-3xl px-6 py-5 flex items-center gap-3">
        <div className="spinner"></div>
        <span className="text-sm text-[#b9b4c7]">{label}</span>
      </div>
    </div>
  );
}
