/** Render with the company identity, without a separate badge image request. */
export function OnColabbMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} style={{ width: size, height: size, flexShrink: 0 }} viewBox="0 0 28 28" fill="none" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="26" height="26" rx="8" fill="white" stroke="#D4E0E7" />
      <path d="M5 8.804 14 14 5 19.196V8.804Z" fill="#FF6A00" transform="translate(-1 0)" />
      <path d="M23 8.804 14 14 23 19.196V8.804Z" fill="#FF6A00" transform="translate(1 0)" />
    </svg>
  );
}
