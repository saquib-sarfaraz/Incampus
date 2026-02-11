export default function ProfileView({ user }) {
    return (
      <div className="p-6 text-center">
        <img
          src="https://placehold.co/100x100"
          className="rounded-full mx-auto mb-3"
        />
        <h2 className="text-xl font-bold">{user.username}</h2>
        <p className="text-slate-500">Student</p>
      </div>
    );
  }
  