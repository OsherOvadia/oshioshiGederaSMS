import { Heebo, Secular_One } from "next/font/google";

// Self-hosted at build time by next/font (no runtime Google request).
// Heebo is a variable font; Secular One is single-weight and must declare 400.
export const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-body",
});

export const secularOne = Secular_One({
  weight: "400",
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-display",
});
