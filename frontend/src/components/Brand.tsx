export function Logo(props: { compact?: boolean }) {
  return (
    <span class={`logo ${props.compact ? "logo-compact" : ""}`}>
      <span class="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
          <path
            d="M6 4.5h9.5A2.5 2.5 0 0 1 18 7v12.5H8.5A2.5 2.5 0 0 1 6 17V4.5Z"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
          <path
            d="M9 8.5h6M9 12h6"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      </span>
      <span class="logo-text">
        MyRef<span class="logo-dot">.</span>
      </span>
    </span>
  );
}
