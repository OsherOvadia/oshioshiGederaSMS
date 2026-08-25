import { Frank_Ruhl_Libre, Assistant } from "next/font/google";

// Self-hosted at build time by next/font (no runtime Google request).
//
// Frank Ruhl Libre is the open-source cut of Frank Rühl — the Hebrew book and
// newspaper serif, in continuous use since 1908. It is to Hebrew what Garamond
// is to Latin: high-contrast, print-native, and unmistakably *typeset*. That is
// the point. The previous pairing (Heebo + Secular One) is the default Google
// Fonts Hebrew combination, which is exactly why it reads as machine-chosen.
export const frankRuhl = Frank_Ruhl_Libre({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-display",
});

// Assistant is the modern Israeli UI sans (Ben Nathan). Warm, even colour, and
// legible down to small sizes — it carries the form, where clarity beats
// character. Used at 18px and up so older readers are not straining.
export const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-body",
});
