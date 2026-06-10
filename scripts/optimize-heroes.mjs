// One-shot preprocessor: the committed originals are 1.2-17MB each. next/image
// optimizes at request time but works from these sources, so shrink them first.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const SOURCES = ["bg1.png", "bg2.png", "bg3.jpg", "bg4.png", "bg5.png", "bg6.png", "bg7.png"];
const SRC_DIR = "public";
const OUT_DIR = "public/hero";
const MAX_WIDTH = 2560; // full-viewport background behind a dark scrim; 2560 is plenty

// Per-file quality overrides for very large originals
const QUALITY_OVERRIDES = { "bg3.jpg": 45 };
const DEFAULT_QUALITY = 70;

await mkdir(OUT_DIR, { recursive: true });
for (const file of SOURCES) {
  const base = path.parse(file).name;
  const quality = QUALITY_OVERRIDES[file] ?? DEFAULT_QUALITY;
  const out = await sharp(path.join(SRC_DIR, file))
    .rotate() // respect EXIF orientation
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true, progressive: true })
    .toFile(path.join(OUT_DIR, `${base}.jpg`));
  console.log(`${file} -> hero/${base}.jpg ${(out.size / 1024).toFixed(0)} KB`);
}
