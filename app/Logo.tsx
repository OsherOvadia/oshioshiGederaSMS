"use client";

import { useState } from "react";

// Intrinsic dimensions of public/logo.png, declared so the browser reserves the
// right box before the file decodes — otherwise the page shifts down on first
// paint, which is the layout jump that reads as "broken" on a slow connection.
const LOGO_WIDTH = 401;
const LOGO_HEIGHT = 126;

/**
 * The mark is a solid black block with white lettering and a vermilion ensō.
 * On the paper pages it is left exactly as it is: a black rectangle on cream
 * reads as a printed label, which is what it is.
 */
export default function Logo({ className = "sheet-mark" }: { className?: string }) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <svg
        className={className}
        viewBox="0 0 401 126"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Oshi Oshi גדרה"
      >
        <rect width="401" height="126" fill="#000" />
        <circle cx="200.5" cy="52" r="21" stroke="#d4232b" strokeWidth="7" fill="none" />
        <text
          x="200.5"
          y="100"
          textAnchor="middle"
          fill="#fff"
          fontSize="20"
          fontWeight="700"
          letterSpacing="6"
          fontFamily="Georgia, serif"
        >
          OSHI OSHI
        </text>
      </svg>
    );
  }

  return (
    <img
      className={className}
      src="/logo.png"
      alt="Oshi Oshi גדרה"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      decoding="async"
      onError={() => setImgFailed(true)}
    />
  );
}
