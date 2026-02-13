export default function BlueTick({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center text-[14px] ml-1 leading-none ${className}`}
      role="img"
      aria-label="Verified"
      title="Verified"
    >
      <i
        className="fa-solid fa-circle-check text-[#1DA1F2]"
        aria-hidden="true"
      ></i>
    </span>
  );
}
