/** The folded loop, used at both wordmark and timer sizes. */
export function RibbonMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="ribbon-mark"
      width={size}
      height={size * 0.72}
      viewBox="0 0 80 58"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4 49 29 15c8-10 19-13 29-8l8 5-20 5-24 35Z" fill="#ed5031" />
      <path
        d="M28 17C40 9 48 11 60 25l11 7c4-5 0-16-7-22C51 0 37 4 28 17Z"
        fill="#c53520"
      />
      <path d="m38 41 14-19c5 2 10 5 19 10l-7 9Z" fill="#ffac82" />
      <path d="m38 41 10-8 16 8Z" fill="#df7255" />
    </svg>
  );
}
