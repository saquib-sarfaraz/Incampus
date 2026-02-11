export default function BottomNav({ setView }) {
    return (
      <nav className="fixed bottom-0 w-full bg-white flex justify-around py-2">
        <button onClick={() => setView("feed")}>Feed</button>
        <button onClick={() => setView("chat")}>Chat</button>
        <button onClick={() => setView("profile")}>Profile</button>
      </nav>
    );
  }
  