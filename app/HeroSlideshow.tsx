"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const SLIDES = [
  "/hero/bg1.jpg",
  "/hero/bg2.jpg",
  "/hero/bg3.jpg",
  "/hero/bg4.jpg",
  "/hero/bg5.jpg",
  "/hero/bg6.jpg",
  "/hero/bg7.jpg",
];
const INTERVAL_MS = 7000;

/**
 * Crossfading background slideshow. Only the current and next slides are
 * mounted, so the next image preloads during the current slide's 7s on
 * screen and the other five cost nothing. Decorative: aria-hidden.
 */
export default function HeroSlideshow() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // Vestibular safety: freeze on the first slide.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const next = (index + 1) % SLIDES.length;

  return (
    <div className="hero-bg" aria-hidden="true">
      {SLIDES.map((src, i) =>
        i !== index && i !== next ? null : (
          <div key={src} className="hero-slide" data-active={i === index}>
            <Image
              src={src}
              alt=""
              fill
              sizes="100vw"
              quality={65}
              priority={i === 0}
              style={{ objectFit: "cover" }}
            />
          </div>
        )
      )}
      <div className="hero-scrim" />
      <div className="hero-grain" />
    </div>
  );
}
