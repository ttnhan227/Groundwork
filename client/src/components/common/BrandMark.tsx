export function BrandMark({ className = "", size = 20 }: { className?: string; size?: number }) {
  return (
    <span className={`brand-symbol ${className}`.trim()} aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0 }}
      >
        <path
          d="M12 2L15 5.5H13V9H11V5.5H9L12 2Z"
          fill="currentColor"
          opacity="0.95"
        />
        <path
          d="M12 7.5L20 11.5L12 15.5L4 11.5L12 7.5Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
          fill="none"
          opacity="0.9"
        />
        <path
          d="M4 14.5L12 18.5L20 14.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.7"
        />
        <path
          d="M4 17.5L12 21.5L20 17.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.5"
        />
      </svg>
    </span>
  );
}
