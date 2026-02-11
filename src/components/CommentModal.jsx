export default function CommentModal({ onClose }) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end">
        <div className="bg-white w-full p-4 rounded-t-xl">
          <h3 className="font-bold">Comments</h3>
          <input className="border w-full p-2 mt-2" placeholder="Add comment" />
          <button onClick={onClose} className="mt-2 text-red-500">Close</button>
        </div>
      </div>
    );
  }
  