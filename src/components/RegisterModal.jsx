export default function RegisterModal({ onClose }) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center">
        <div className="bg-white p-6 rounded-xl w-80">
          <h2 className="font-bold text-xl mb-2">Register</h2>
          <input className="border p-2 w-full mb-2" placeholder="Email" />
          <input className="border p-2 w-full mb-2" placeholder="Full Name" />
          <input className="border p-2 w-full mb-2" placeholder="Course" />
          <button className="bg-genz-primary text-white w-full py-2">Register</button>
          <button onClick={onClose} className="mt-2 text-red-500">Cancel</button>
        </div>
      </div>
    );
  }
  