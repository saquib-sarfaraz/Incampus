export default function Header({ setView, setAuthToken }) {
    const logout = () => {
      localStorage.removeItem("authToken");
      localStorage.removeItem("currentUserId");
      setAuthToken(null);
      window.location.reload();
    };
  
    return (
      <header className="bg-white shadow-md sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 flex justify-between h-16 items-center">
          <div
            className="flex items-center space-x-2 cursor-pointer"
            onClick={() => setView("feed")}
          >
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl shadow-md shadow-[#0b1f3a]/40">
              <img
                src="/incampus-icon.svg"
                alt="InCampus"
                className="h-8 w-8"
              />
            </span>
            <span className="text-xl font-bold">InCampus</span>
          </div>
  
          <div className="flex space-x-4">
            <button onClick={() => setView("chat")}>Chat</button>
            <button onClick={() => setView("profile")}>Profile</button>
            <button onClick={logout}>Logout</button>
          </div>
        </div>
      </header>
    );
  }
  
