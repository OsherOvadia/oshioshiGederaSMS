# VIP Site UI/UX & Performance Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Oshioshi Gedera VIP club site from a generic white-card-over-slideshow into a premium dark "Omakase Noir" experience, cut page weight from ~25MB to ~1MB, and upgrade the admin panel with KPI cards, an SMS segment counter, searchable mobile-friendly customer list, and safe destructive actions.

**Architecture:** Next.js 14 App Router (existing). The CSS-keyframe background slideshow (which forces ~25MB of raw images through the browser) is replaced by a client `HeroSlideshow` component using `next/image` crossfade with only current+next slides mounted. Design tokens move to CSS variables in `globals.css` with `next/font` Hebrew fonts (Secular One display + Heebo body). Pure logic (submit-field parsing, SMS segment math, KPI math) is extracted into tested `lib/` modules; UI components consume them.

**Tech Stack:** Next.js 14, React 18, TypeScript, vitest, sharp (dev-only, image preprocessing), next/font (Secular One + Heebo, Hebrew subsets), plain CSS (no Tailwind — repo convention), recharts (existing, admin only).

**Design direction ("Omakase Noir"):** base `#0c0a09`, dark glass card `rgba(22,19,17,0.78)` + `backdrop-filter: blur(16px)`, gold accent `#d4a853` (buttons, focus rings, hairline borders), warm off-white text `#faf7f2`, film-grain overlay, slow Ken Burns on slides, gradient scrim guaranteeing text contrast. Admin pages stay light (white cards on warm paper `#f7f5f1`) for data readability.

**Research-backed decisions baked into this plan** (from competitor research: SlickText/Attentive/InforUMobile/Japanika and Israeli spam-law sources):
- Benefit bullets with icons before the form; honest copy only (no invented signup gifts — the club's real perks are 1+1 deals and the birthday SMS the cron already sends).
- Wedding-day field becomes **optional** (high-friction field; few competitors ask for it). Requires a small API change, done TDD.
- Israeli spam-law (תיקון 40) consent line under the submit button naming the business, recurring SMS, and the exact opt-out keyword (`1111` via `UNSUBSCRIBE_KEYWORD`).
- Hebrew SMS is always UCS-2: 70 chars = 1 segment, 71 = 2, then 67/segment. JS `string.length` (UTF-16 code units) is the correct counting unit. The auto-appended unsubscribe footer must be counted.
- Destructive "reset DB" gets type-to-confirm and moves to a danger zone at the page bottom (GitHub pattern).
- 10-column table collapses to cards below 700px (never horizontal-scroll a 10-column table on a phone).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/optimize-heroes.mjs` | Create | One-shot sharp script: 7 raw bg images → `public/hero/*.jpg` ≤2560px q78 |
| `public/hero/bg1.jpg` … `bg7.jpg` | Create (generated) | Optimized slideshow sources for next/image |
| `public/bg1.png` … `bg7.png`, `public/bg3.jpg` | Delete (Task 3) | 25MB of raw images, replaced |
| `next.config.js` | Modify | Add `images.formats` (AVIF/WebP) |
| `app/fonts.ts` | Create | next/font setup: Secular One (display) + Heebo (body), Hebrew subset |
| `app/globals.css` | Rewrite | Design tokens, dark theme, hero/landing/admin styles, a11y (focus-visible, reduced-motion) |
| `app/layout.tsx` | Rewrite | Font variables on `<html>`, full metadata (OG, themeColor), viewport |
| `app/icon.svg` | Create | Favicon (maki-roll glyph, App Router file convention) |
| `app/HeroSlideshow.tsx` | Create | Client crossfade slideshow: next/image, current+next mounting, Ken Burns, reduced-motion |
| `app/page.tsx` | Rewrite | Landing: eyebrow, display headline, benefit bullets, form |
| `app/VIPForm.tsx` | Rewrite | Form with a11y attrs, optional wedding field, success view, consent line |
| `lib/submit-form.ts` | Create | `parseSubmitFields` — pure, tested; wedding optional |
| `tests/submit-form.test.ts` | Create | TDD for `parseSubmitFields` |
| `app/api/submit/route.ts` | Modify | Use `parseSubmitFields` |
| `lib/sms-segments.ts` | Create | UCS-2 unit/segment math + unsubscribe-footer estimate — pure, tested |
| `tests/sms-segments.test.ts` | Create | TDD for segment math |
| `app/admin/BroadcastForm.tsx` | Rewrite | Audience radio, live char/segment counter, draft test-send, confirm with totals |
| `app/admin/TestMessageForm.tsx` | Delete | Superseded by draft test-send in BroadcastForm |
| `lib/kpis.ts` | Create | `computeKpis` — pure, tested |
| `tests/kpis.test.ts` | Create | TDD for KPI math |
| `app/admin/CustomerTable.tsx` | Create | Client: search box, desktop table + mobile cards, block/unblock |
| `app/admin/page.tsx` | Rewrite | KPI cards, composer card, stats, CustomerTable, danger zone at bottom |
| `app/admin/ResetDbForm.tsx` | Rewrite | Type-to-confirm destructive reset |
| `app/unsubscribe/[phone]/page.tsx` | Modify | Polished copy + re-join link |
| `.env.example` | Modify | Document `NEXT_PUBLIC_BUSINESS_PHONE`, `NEXT_PUBLIC_WHATSAPP_PHONE` |

Files NOT touched: `api/` (legacy Flask, kept as-is), `lib/db.ts`, `lib/auth.ts`, all other API routes, `middleware.ts` (its matcher already skips `_next/image` and image extensions).

---

### Task 1: Optimize hero images

**Files:**
- Create: `scripts/optimize-heroes.mjs`
- Create: `public/hero/bg1.jpg` … `public/hero/bg7.jpg` (generated)
- Modify: `next.config.js`

- [ ] **Step 1: Install sharp as a dev dependency**

Run: `npm install -D sharp`
Expected: added to `devDependencies` in `package.json`, exit code 0.

- [ ] **Step 2: Write the conversion script**

Create `scripts/optimize-heroes.mjs`:

```js
// One-shot preprocessor: the committed originals are 1.2-17MB each. next/image
// optimizes at request time but works from these sources, so shrink them first.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const SOURCES = ["bg1.png", "bg2.png", "bg3.jpg", "bg4.png", "bg5.png", "bg6.png", "bg7.png"];
const SRC_DIR = "public";
const OUT_DIR = "public/hero";
const MAX_WIDTH = 2560; // full-viewport background behind a dark scrim; 2560 is plenty

await mkdir(OUT_DIR, { recursive: true });
for (const file of SOURCES) {
  const base = path.parse(file).name;
  const out = await sharp(path.join(SRC_DIR, file))
    .rotate() // respect EXIF orientation
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true, progressive: true })
    .toFile(path.join(OUT_DIR, `${base}.jpg`));
  console.log(`${file} -> hero/${base}.jpg ${(out.size / 1024).toFixed(0)} KB`);
}
```

- [ ] **Step 3: Run the script and verify output sizes**

Run: `node scripts/optimize-heroes.mjs`
Expected: 7 lines printed, each `bgN.* -> hero/bgN.jpg NNN KB`.

Run (PowerShell): `Get-ChildItem public/hero | Select-Object Name, Length`
Expected: 7 `.jpg` files, **each under ~500KB** (they sit behind a dark scrim; artifacts are invisible). If any file exceeds 600KB, lower `quality` to 70 in the script and re-run.

- [ ] **Step 4: Enable AVIF/WebP in next.config.js**

Replace the full contents of `next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    optimizePackageImports: ["recharts"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) config.externals = [...(config.externals || []), "better-sqlite3"];
    return config;
  },
};

module.exports = nextConfig;
```

- [ ] **Step 5: Verify the build still passes**

Run: `npm run build`
Expected: `✓ Compiled successfully` (warnings about env vars are fine; no errors).

- [ ] **Step 6: Commit**

```bash
git add scripts/optimize-heroes.mjs public/hero next.config.js package.json package-lock.json
git commit -m "perf(images): add sharp preprocessing for hero images + AVIF/WebP formats"
```

---

### Task 2: Fonts, design tokens, and dark theme (globals.css + layout)

**Files:**
- Create: `app/fonts.ts`
- Rewrite: `app/globals.css`
- Rewrite: `app/layout.tsx`

- [ ] **Step 1: Create app/fonts.ts**

```ts
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
```

- [ ] **Step 2: Rewrite app/layout.tsx with fonts + full metadata**

```tsx
import type { Metadata, Viewport } from "next";
import { heebo, secularOne } from "./fonts";
import "./globals.css";

const appUrl = process.env.APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "מועדון ה-VIP | סושי גדרה",
  description:
    "הצטרפו בחינם למועדון ה-VIP — מבצעי 1+1, הטבת יום הולדת ועדכונים חמים ישירות ב-SMS.",
  openGraph: {
    title: "מועדון ה-VIP | סושי גדרה",
    description: "מבצעי 1+1, הטבת יום הולדת ועדכונים חמים ישירות ב-SMS.",
    type: "website",
    locale: "he_IL",
    images: [{ url: "/hero/bg1.jpg" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0c0a09",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${secularOne.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Rewrite app/globals.css completely**

Replace the entire file with:

```css
/* ───────────────────────── Design tokens — "Omakase Noir" ───────────────────────── */
:root {
  --bg: #0c0a09;
  --surface: rgba(22, 19, 17, 0.78);
  --surface-strong: #1c1917;
  --glass-border: rgba(212, 168, 83, 0.22);
  --accent: #d4a853;
  --accent-deep: #b08537;
  --on-accent: #1a1208;
  --text: #faf7f2;
  --text-muted: #a8a29e;
  --danger: #ef5350;
  --ok: #81c784;
  --brand-red: #d32f2f;
  --radius: 20px;
  --radius-sm: 10px;
  --font-body-stack: var(--font-body), system-ui, -apple-system, sans-serif;
  --font-display-stack: var(--font-display), var(--font-body), sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-body-stack);
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

/* ───────────────────────── Hero slideshow (rendered by HeroSlideshow.tsx) ───────── */
.hero-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: var(--bg); /* solid fallback: no white flash while images decode */
}

.hero-slide {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 1.5s ease-in-out;
  will-change: opacity;
}

.hero-slide[data-active="true"] {
  opacity: 1;
}

/* Ken Burns: transform-only (GPU-composited, zero CLS) */
.hero-slide[data-active="true"] img {
  animation: kenburns 9s ease-out forwards;
}

@keyframes kenburns {
  from { transform: scale(1); }
  to { transform: scale(1.06); }
}

.hero-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    rgba(12, 10, 9, 0.92) 0%,
    rgba(12, 10, 9, 0.45) 45%,
    rgba(12, 10, 9, 0.6) 100%
  );
}

.hero-grain {
  position: absolute;
  inset: 0;
  opacity: 0.07;
  mix-blend-mode: overlay;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='128' height='128' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
}

@media (prefers-reduced-motion: reduce) {
  .hero-slide {
    transition: none;
  }
  .hero-slide img {
    animation: none !important;
  }
}

/* ───────────────────────── Card / container ───────────────────────── */
.container {
  position: relative;
  z-index: 1;
  background: var(--surface);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  backdrop-filter: blur(16px) saturate(1.2);
  border: 1px solid var(--glass-border);
  padding: 32px 24px;
  border-radius: var(--radius);
  width: 100%;
  max-width: 520px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
  text-align: center;
}

/* ───────────────────────── Typography ───────────────────────── */
.eyebrow {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.35em;
  color: var(--accent);
  text-transform: uppercase;
  margin-bottom: 10px;
}

.headline {
  font-family: var(--font-display-stack);
  font-weight: 400;
  font-size: clamp(1.9rem, 6vw, 2.7rem);
  line-height: 1.15;
  color: var(--text);
  margin-bottom: 10px;
}

.subline {
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1.6;
  margin-bottom: 18px;
}

h2 {
  font-family: var(--font-display-stack);
  font-weight: 400;
  color: var(--text);
  margin-bottom: 8px;
  font-size: 26px;
}

p {
  color: var(--text-muted);
  margin-bottom: 16px;
  font-size: 14px;
  line-height: 1.6;
}

.logo-area {
  margin-bottom: 16px;
  display: flex;
  justify-content: center;
}

.logo-area img,
.logo-area .logo-svg {
  width: 300px;
  height: auto;
  max-width: 100%;
  object-fit: contain;
}

/* ───────────────────────── Benefits ───────────────────────── */
.benefits {
  list-style: none;
  display: grid;
  gap: 10px;
  margin: 18px 0 22px;
  text-align: right;
}

.benefit {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  padding: 12px 14px;
}

.benefit-icon {
  font-size: 22px;
  line-height: 1.2;
}

.benefit-title {
  font-weight: 700;
  font-size: 14px;
  color: var(--text);
}

.benefit-text {
  font-size: 13px;
  color: var(--text-muted);
  margin: 2px 0 0;
}

/* ───────────────────────── Forms ───────────────────────── */
.form-group {
  margin-bottom: 14px;
  text-align: right;
}

label {
  display: block;
  font-size: 13px;
  color: var(--text);
  margin-bottom: 5px;
  font-weight: 600;
  text-align: right;
}

.label-hint {
  font-weight: 400;
  color: var(--text-muted);
  font-size: 12px;
}

input,
textarea,
select {
  width: 100%;
  padding: 12px 14px;
  min-height: 48px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 16px;
  font-family: inherit;
  direction: rtl;
  text-align: right;
}

input::placeholder,
textarea::placeholder {
  color: rgba(250, 247, 242, 0.35);
}

input[type="date"] {
  color-scheme: dark;
}

.input-ltr {
  direction: ltr;
  text-align: left;
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(212, 168, 83, 0.18);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

textarea {
  resize: vertical;
  min-height: 80px;
}

/* ───────────────────────── Buttons ───────────────────────── */
button {
  background: var(--accent);
  color: var(--on-accent);
  border: none;
  padding: 14px 18px;
  width: 100%;
  min-height: 48px;
  border-radius: var(--radius-sm);
  font-size: 16px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  margin-top: 12px;
  transition: filter 0.2s, transform 0.05s;
}

button:hover {
  filter: brightness(1.08);
}

button:active {
  transform: scale(0.985);
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}

.btn-ghost {
  display: inline-block;
  padding: 12px 18px;
  min-height: 44px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--accent);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.btn-ghost:hover {
  text-decoration: none;
  border-color: var(--accent);
}

.btn-secondary {
  background: transparent;
  border: 1px solid #bbb;
  color: #555;
}

.btn-danger {
  background: var(--brand-red);
  color: #fff;
}

/* ───────────────────────── Feedback / misc ───────────────────────── */
.success {
  color: var(--ok);
  font-weight: 700;
  font-size: 16px;
}

.error {
  color: var(--danger);
  font-weight: 700;
}

a {
  color: var(--accent);
  text-decoration: none;
  font-size: 14px;
}

a:hover {
  text-decoration: underline;
}

.small-text {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 12px;
  display: block;
}

.consent {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 12px 0 0;
}

.success-view {
  padding: 12px 0 4px;
}

.success-check {
  width: 56px;
  height: 56px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background: rgba(129, 199, 132, 0.15);
  border: 2px solid var(--ok);
  color: var(--ok);
  font-size: 28px;
  line-height: 52px;
}

.success-view h3 {
  font-family: var(--font-display-stack);
  font-weight: 400;
  font-size: 22px;
  margin-bottom: 8px;
}

.success-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 16px;
}

/* ───────────────────────── Mobile (landing) ───────────────────────── */
@media (max-width: 600px) {
  body {
    padding: 10px;
    align-items: flex-start;
    padding-top: max(14px, env(safe-area-inset-top));
    padding-bottom: max(16px, env(safe-area-inset-bottom));
    padding-left: max(10px, env(safe-area-inset-left));
    padding-right: max(10px, env(safe-area-inset-right));
  }

  .container {
    padding: 22px 16px;
    border-radius: 16px;
    max-width: 100%;
  }

  .logo-area img,
  .logo-area .logo-svg {
    max-width: 240px;
  }
}

/* ═════════════════════════ Admin (light theme on dark body) ═════════════════════════ */
.admin-container {
  max-width: 960px;
  background: #f7f5f1;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  border: none;
  color: #1c1917;
}

.admin-container h2,
.admin-container h3,
.admin-container h4 {
  font-family: var(--font-body-stack);
  color: #1c1917;
}

.admin-container p {
  color: #555;
}

.admin-container label {
  color: #444;
}

.admin-container input,
.admin-container textarea,
.admin-container select {
  background: #fff;
  border: 1px solid #ddd6cc;
  color: #1c1917;
}

.admin-container input[type="date"] {
  color-scheme: light;
}

.admin-container a {
  color: #1976d2;
}

.admin-container .success {
  color: #2e7d32;
}

.admin-container .error {
  color: #c62828;
}

.admin-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
}

.admin-header .admin-title {
  flex: 1 1 100%;
  margin: 0;
}

.admin-header .admin-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

@media (min-width: 520px) {
  .admin-header .admin-title {
    flex: 1 1 auto;
  }
}

.admin-card {
  background: #fff;
  padding: 20px;
  border: 1px solid #eee;
  border-radius: 12px;
  margin-bottom: 20px;
}

@media (max-width: 600px) {
  .admin-card {
    padding: 14px;
    margin-bottom: 16px;
  }
}

.admin-btn,
.admin-btn-green,
.admin-btn-logout {
  display: inline-block;
  padding: 10px 14px;
  border-radius: 8px;
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  min-height: 44px;
  box-sizing: border-box;
  text-align: center;
  line-height: 1.25;
}

.admin-btn-green {
  background: #4caf50;
  color: white;
}

.admin-btn-logout {
  background: #333;
  color: white;
}

@media (max-width: 519px) {
  .admin-actions {
    width: 100%;
  }

  .admin-actions .admin-btn,
  .admin-actions a.admin-btn {
    flex: 1 1 auto;
    min-width: 0;
  }
}

/* KPI cards */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

@media (max-width: 700px) {
  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.kpi-card {
  background: #fff;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 14px;
}

.kpi-value {
  font-size: 26px;
  font-weight: 800;
  color: #1c1917;
}

.kpi-label {
  font-size: 12px;
  color: #777;
  margin-top: 2px;
}

.kpi-sub {
  font-size: 11px;
  color: #a09a90;
  margin-top: 2px;
}

/* Broadcast composer */
.sms-counter {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #777;
  margin-top: 6px;
}

.sms-counter[data-level="warn"] {
  color: #e65100;
}

.sms-counter[data-level="high"] {
  color: #c62828;
}

.audience-group {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin: 12px 0 0;
  font-size: 14px;
}

.audience-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #333;
  margin: 0;
}

.audience-group input[type="radio"] {
  width: auto;
  min-height: 0;
  accent-color: var(--brand-red);
}

/* Customer list */
.table-search {
  max-width: 320px;
  margin-bottom: 12px;
}

.admin-table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.admin-table-btn {
  background: none;
  border: none;
  padding: 6px 4px;
  min-height: 0;
  width: auto;
  font-size: 12px;
  color: #1976d2;
  cursor: pointer;
  text-decoration: underline;
  margin: 0;
}

.customers-desktop {
  display: block;
}

.customers-mobile {
  display: none;
}

@media (max-width: 700px) {
  .customers-desktop {
    display: none;
  }

  .customers-mobile {
    display: grid;
    gap: 10px;
  }
}

.customer-card {
  background: #fff;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 12px 14px;
}

.customer-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.customer-card-name {
  font-weight: 700;
  font-size: 15px;
  color: #1c1917;
}

.customer-card-line {
  font-size: 13px;
  color: #555;
  margin: 4px 0 0;
}

.customer-card details {
  margin-top: 6px;
  font-size: 13px;
  color: #555;
}

.customer-card summary {
  cursor: pointer;
  color: #1976d2;
  font-size: 12px;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.badge-active {
  background: #e8f5e9;
  color: #2e7d32;
}

.badge-removed {
  background: #ffebee;
  color: #c62828;
}

.badge-new {
  background: #e3f2fd;
  color: #1565c0;
}

/* Filter chips */
.filter-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 15px;
}

.filter-chip {
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid var(--brand-red);
  background: #fff;
  color: var(--brand-red);
}

.filter-chip[data-active="true"] {
  background: var(--brand-red);
  color: #fff;
}

/* Danger zone */
.danger-zone {
  border: 1px solid #f3b9b5;
  background: #fff7f6;
  border-radius: 12px;
  padding: 16px;
  margin-top: 28px;
}

.danger-zone h3 {
  color: #b71c1c;
  margin-top: 0;
}

/* Stats + upload (existing responsive rules, kept) */
.stats-chart-container {
  height: 280px;
  width: 100%;
}

@media (max-width: 600px) {
  .stats-chart-container {
    height: 220px;
  }

  .stats-card {
    padding: 14px !important;
  }

  .stats-section .stats-section-title {
    font-size: 1.1rem !important;
  }

  .admin-table {
    font-size: 12px;
  }

  .admin-table th,
  .admin-table td {
    padding: 8px 6px !important;
  }
}

.admin-upload-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

@media (max-width: 480px) {
  .admin-upload-form input[type="file"] {
    max-width: 100% !important;
  }

  .admin-upload-form button {
    width: 100%;
  }
}
```

- [ ] **Step 4: Verify build + visual smoke test**

Run: `npm run build`
Expected: compiles successfully.

Run: `npm run dev`, open http://localhost:3000.
Expected: dark page, glass card, Hebrew display font on the heading. The photo slideshow is GONE for now (solid dark background) — that's expected; Task 3 restores it properly. `/admin` (after login) shows light cards on the dark body.

- [ ] **Step 5: Commit**

```bash
git add app/fonts.ts app/globals.css app/layout.tsx
git commit -m "feat(design): Omakase Noir design tokens, Hebrew next/font, full metadata"
```

---

### Task 3: HeroSlideshow component (next/image crossfade)

**Files:**
- Create: `app/HeroSlideshow.tsx`
- Modify: `app/page.tsx` (render it — minimal edit here; full page redesign is Task 5)
- Delete: `public/bg1.png` … `public/bg7.png`, `public/bg3.jpg`

- [ ] **Step 1: Create app/HeroSlideshow.tsx**

```tsx
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
```

- [ ] **Step 2: Render it on the landing page**

In `app/page.tsx`, add the import and render it as the first element (wrap the return in a fragment):

```tsx
import Logo from "./Logo";
import VIPForm from "./VIPForm";
import HeroSlideshow from "./HeroSlideshow";

export default function HomePage() {
  return (
    <>
      <HeroSlideshow />
      <div className="container">
        <div className="logo-area">
          <Logo />
        </div>
        <p className="eyebrow">מועדון ה-VIP · גדרה</p>
        <h2>מועדון ה-VIP שלנו</h2>
        <p>הירשמו לקבלת הטבות בלעדיות, מבצעי 1+1 ועדכונים חמים!</p>

        <VIPForm />
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`, open http://localhost:3000.
Expected: first photo visible immediately behind the dark scrim + glass card; slides crossfade every ~7s with a slow zoom; no flash of white/empty background. In DevTools → Network, confirm images are served from `/_next/image?...` as AVIF or WebP at a few hundred KB max, NOT the multi-MB originals. In DevTools → Rendering → "Emulate CSS prefers-reduced-motion", confirm the slideshow freezes on slide 1.

- [ ] **Step 4: Delete the old raw images**

Run:

```bash
git rm public/bg1.png public/bg2.png public/bg3.jpg public/bg4.png public/bg5.png public/bg6.png public/bg7.png
```

(The copies under `api/static/` belong to the legacy Flask app — leave them.)

Re-check http://localhost:3000 — slideshow still works (it reads `/hero/*.jpg`).

- [ ] **Step 5: Commit**

```bash
git add app/HeroSlideshow.tsx app/page.tsx
git commit -m "perf(hero): next/image crossfade slideshow, drop 25MB of raw backgrounds"
```

---

### Task 4: Extract submit-field parsing (TDD) — wedding day becomes optional

**Files:**
- Create: `lib/submit-form.ts`
- Create: `tests/submit-form.test.ts`
- Modify: `app/api/submit/route.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/submit-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSubmitFields } from "@/lib/submit-form";

const valid = {
  name: "  שרה כהן ",
  phone: "050-1234567",
  email: "sara@example.com",
  date_of_birth: "1990-05-12",
  wedding_day: "2015-08-01",
  city: "גדרה",
};

describe("parseSubmitFields", () => {
  it("accepts a full valid submission, trimming and normalizing the phone", () => {
    const r = parseSubmitFields(valid);
    expect(r).toEqual({
      ok: true,
      fields: {
        name: "שרה כהן",
        phone: "+972501234567",
        email: "sara@example.com",
        dob: "1990-05-12",
        wedding: "2015-08-01",
        city: "גדרה",
      },
    });
  });

  it("accepts a submission with no wedding day (optional field)", () => {
    const r = parseSubmitFields({ ...valid, wedding_day: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.wedding).toBe("");
  });

  it("accepts a submission with wedding_day absent entirely", () => {
    const { wedding_day: _omit, ...rest } = valid;
    const r = parseSubmitFields(rest);
    expect(r.ok).toBe(true);
  });

  it.each(["name", "phone", "email", "date_of_birth", "city"] as const)(
    "rejects with 'missing' when %s is empty",
    (key) => {
      const r = parseSubmitFields({ ...valid, [key]: "   " });
      expect(r).toEqual({ ok: false, error: "missing" });
    }
  );

  it("rejects an invalid phone", () => {
    const r = parseSubmitFields({ ...valid, phone: "123" });
    expect(r).toEqual({ ok: false, error: "invalid_phone" });
  });

  it("rejects an invalid email", () => {
    const r = parseSubmitFields({ ...valid, email: "not-an-email" });
    expect(r).toEqual({ ok: false, error: "invalid_email" });
  });

  it("caps oversized values instead of failing", () => {
    const r = parseSubmitFields({ ...valid, name: "א".repeat(500) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.name).toHaveLength(100);
  });

  it("treats non-string values (e.g. a File) as empty", () => {
    const r = parseSubmitFields({ ...valid, name: 42 });
    expect(r).toEqual({ ok: false, error: "missing" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/submit-form.test.ts`
Expected: FAIL — `Cannot find module '@/lib/submit-form'` (or equivalent resolve error).

- [ ] **Step 3: Implement lib/submit-form.ts**

```ts
import { formatPhone, isValidEmail, isValidPhone } from "./validation";

export type SubmitError = "missing" | "invalid_phone" | "invalid_email";

export type ParsedSubmit =
  | {
      ok: true;
      fields: { name: string; phone: string; email: string; dob: string; wedding: string; city: string };
    }
  | { ok: false; error: SubmitError };

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Validate and normalize the VIP signup fields. Wedding day is optional —
 * it's a nice-to-have for the anniversary treat, not a gate to joining.
 */
export function parseSubmitFields(raw: {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  date_of_birth?: unknown;
  wedding_day?: unknown;
  city?: unknown;
}): ParsedSubmit {
  const name = str(raw.name, 100);
  const rawPhone = str(raw.phone, 20);
  const email = str(raw.email, 255);
  const dob = str(raw.date_of_birth, 10);
  const wedding = str(raw.wedding_day, 10);
  const city = str(raw.city, 50);

  if (!name || !rawPhone || !email || !dob || !city) return { ok: false, error: "missing" };

  const phone = formatPhone(rawPhone);
  if (!isValidPhone(phone)) return { ok: false, error: "invalid_phone" };
  if (!isValidEmail(email)) return { ok: false, error: "invalid_email" };

  return { ok: true, fields: { name, phone, email, dob, wedding, city } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/submit-form.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Use it in the submit route**

In `app/api/submit/route.ts`, replace the import of validation helpers and the manual extraction/validation block. The full updated file:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, runDb, queryCustomers, initDb } from "@/lib/db";
import { parseSubmitFields, type SubmitError } from "@/lib/submit-form";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export type SubmitErrorKey = SubmitError | "already_registered" | "system" | "rate";

function wantsJson(req: NextRequest): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json");
}

function jsonResponse(ok: boolean, error?: SubmitErrorKey) {
  return NextResponse.json({ success: ok, error: error ?? null });
}

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "submit", LIMITS.submit.max);
  if (!ok) {
    if (wantsJson(req)) return jsonResponse(false, "rate");
    return NextResponse.redirect(new URL("/?error=rate", req.url));
  }

  const form = await req.formData();
  const parsed = parseSubmitFields({
    name: form.get("name"),
    phone: form.get("phone"),
    email: form.get("email"),
    date_of_birth: form.get("date_of_birth"),
    wedding_day: form.get("wedding_day"),
    city: form.get("city"),
  });

  if (!parsed.ok) {
    if (wantsJson(req)) return jsonResponse(false, parsed.error);
    return NextResponse.redirect(new URL(`/?error=${parsed.error}`, req.url));
  }
  const { name, phone, email, dob, wedding, city } = parsed.fields;

  try {
    await initDb();
    const db = getDb();
    const existingRows = await queryCustomers(
      db,
      "SELECT phone, active FROM customers WHERE phone = $1",
      [phone]
    );
    const existing = existingRows[0];

    if (existing) {
      const isActive = existing.active === true || existing.active === 1;
      if (isActive) {
        if (wantsJson(req)) return jsonResponse(false, "already_registered");
        return NextResponse.redirect(new URL("/?error=already_registered", req.url));
      }
    }

    const insertSql =
      db.type === "postgres"
        ? `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)
           ON CONFLICT(phone) DO UPDATE SET active = TRUE, unsubscribed_at = NULL, name = EXCLUDED.name, email = EXCLUDED.email,
           date_of_birth = EXCLUDED.date_of_birth, wedding_day = EXCLUDED.wedding_day, city = EXCLUDED.city`
        : `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active)
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT(phone) DO UPDATE SET active = 1, unsubscribed_at = NULL, name = excluded.name, email = excluded.email,
           date_of_birth = excluded.date_of_birth, wedding_day = excluded.wedding_day, city = excluded.city`;
    await runDb(db, insertSql, [phone, name, email, dob, wedding, city]);

    if (db.type === "sqlite") db.conn.close();
    if (wantsJson(req)) return jsonResponse(true);
    return NextResponse.redirect(new URL("/?success=1", req.url));
  } catch (e) {
    console.error("Submit error:", e);
    if (wantsJson(req)) return jsonResponse(false, "system");
    return NextResponse.redirect(new URL("/?error=system", req.url));
  }
}
```

- [ ] **Step 6: Run all tests and build**

Run: `npm test`
Expected: all suites pass (existing 9 + new submit-form).

Run: `npm run build`
Expected: compiles.

- [ ] **Step 7: Commit**

```bash
git add lib/submit-form.ts tests/submit-form.test.ts app/api/submit/route.ts
git commit -m "refactor(submit): extract tested parseSubmitFields; wedding day now optional"
```

---

### Task 5: Landing page redesign (copy, benefits, form, success state, consent)

**Files:**
- Rewrite: `app/page.tsx`
- Rewrite: `app/VIPForm.tsx`
- Modify: `.env.example`

- [ ] **Step 1: Rewrite app/page.tsx**

```tsx
import Logo from "./Logo";
import VIPForm from "./VIPForm";
import HeroSlideshow from "./HeroSlideshow";

const BENEFITS = [
  {
    icon: "🥢",
    title: "מבצעים לחברים בלבד",
    text: "דילים ומבצעי 1+1 לפני כולם, ישירות ב-SMS",
  },
  {
    icon: "🎂",
    title: "פינוק יום הולדת",
    text: "מתנה שמחכה לכם כל שנה בחודש יום ההולדת",
  },
  {
    icon: "📱",
    title: "בלי אפליקציות ובלי כרטיסים",
    text: "הצטרפות של 30 שניות — הכל בהודעה אחת",
  },
];

export default function HomePage() {
  const unsubKeyword = (process.env.UNSUBSCRIBE_KEYWORD || "1111").trim();

  return (
    <>
      <HeroSlideshow />
      <main className="container">
        <div className="logo-area">
          <Logo />
        </div>
        <p className="eyebrow">מועדון ה-VIP · גדרה</p>
        <h1 className="headline">הטבות בלעדיות, ישר לנייד</h1>
        <p className="subline">
          הצטרפות של 30 שניות, פינוקים כל השנה — מבצעי 1+1, הטבת יום הולדת ועדכונים חמים ב-SMS.
        </p>
        <ul className="benefits">
          {BENEFITS.map((b) => (
            <li key={b.title} className="benefit">
              <span className="benefit-icon" aria-hidden="true">
                {b.icon}
              </span>
              <span>
                <span className="benefit-title">{b.title}</span>
                <p className="benefit-text">{b.text}</p>
              </span>
            </li>
          ))}
        </ul>
        <VIPForm unsubKeyword={unsubKeyword} />
      </main>
    </>
  );
}
```

(`main` replaces the outer `div` for landmark semantics; `h1` replaces `h2` — one h1 per page. The old `.city-name` element is gone; "גדרה" lives in the eyebrow.)

- [ ] **Step 2: Rewrite app/VIPForm.tsx**

```tsx
"use client";

import { useState, useRef } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "אנא מלאו את כל שדות החובה",
  invalid_phone: "מספר טלפון לא תקין",
  invalid_email: 'כתובת דוא"ל לא תקינה',
  already_registered: "אתם כבר רשומים למועדון! המספר שלכם כבר קיים במערכת.",
  system: "תקלה במערכת",
  rate: "יותר מדי בקשות. נסו שוב מאוחר יותר.",
};

// Optional business contact for the success screen; buttons hide when unset.
const BUSINESS_PHONE = process.env.NEXT_PUBLIC_BUSINESS_PHONE ?? "";
const WHATSAPP_PHONE = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "";

export default function VIPForm({ unsubKeyword }: { unsubKeyword: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = formRef.current;
    if (!form) return;

    setLoading(true);
    const formData = new FormData(form);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      });
      const data = await res.json();

      if (data.success) {
        setDone(true);
      } else if (data.error && ERROR_MESSAGES[data.error]) {
        setError(ERROR_MESSAGES[data.error]);
      } else {
        setError("שגיאה. נסו שוב.");
      }
    } catch {
      setError("תקלה במערכת. נסו שוב.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="success-view" role="status">
        <div className="success-check" aria-hidden="true">
          ✓
        </div>
        <h3>איזה כיף שהצטרפת! 🎉</h3>
        <p>מעכשיו ההטבות, מבצעי ה-1+1 והפינוקים מגיעים ישירות אליך ב-SMS.</p>
        {(BUSINESS_PHONE || WHATSAPP_PHONE) && (
          <div className="success-actions">
            {BUSINESS_PHONE && (
              <a className="btn-ghost" href={`tel:${BUSINESS_PHONE}`}>
                📞 חיוג למסעדה
              </a>
            )}
            {WHATSAPP_PHONE && (
              <a
                className="btn-ghost"
                href={`https://wa.me/${WHATSAPP_PHONE}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                💬 וואטסאפ
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} aria-describedby="form-feedback">
        <div className="form-group">
          <label htmlFor="name">שם מלא *</label>
          <input type="text" id="name" name="name" placeholder="שמך" required maxLength={100} autoComplete="name" />
        </div>
        <div className="form-group">
          <label htmlFor="phone">טלפון נייד *</label>
          <input
            type="tel"
            id="phone"
            name="phone"
            className="input-ltr"
            dir="ltr"
            placeholder="050-1234567"
            required
            maxLength={20}
            inputMode="tel"
            autoComplete="tel"
          />
        </div>
        <div className="form-group">
          <label htmlFor="email">דוא&quot;ל *</label>
          <input
            type="email"
            id="email"
            name="email"
            className="input-ltr"
            dir="ltr"
            placeholder="example@email.com"
            required
            autoComplete="email"
          />
        </div>
        <div className="form-group">
          <label htmlFor="dob">
            תאריך לידה * <span className="label-hint">— כדי שנדע מתי לפנק 🎂</span>
          </label>
          <input type="date" id="dob" name="date_of_birth" required autoComplete="bday" />
        </div>
        <div className="form-group">
          <label htmlFor="wedding">
            יום נישואין <span className="label-hint">— לא חובה, נדאג לפינוק זוגי 💍</span>
          </label>
          <input type="date" id="wedding" name="wedding_day" />
        </div>
        <div className="form-group">
          <label htmlFor="city">עיר *</label>
          <input type="text" id="city" name="city" placeholder="גדרה" maxLength={50} required />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "שולח..." : "אני בפנים 🍣"}
        </button>
      </form>
      <p id="form-feedback" role="alert" aria-live="assertive" className="error" style={{ marginTop: "14px", marginBottom: 0, minHeight: error ? undefined : 0 }}>
        {error}
      </p>
      <p className="consent">
        בלחיצה על &quot;אני בפנים&quot; אני מאשר/ת קבלת הודעות ועדכונים פרסומיים ב-SMS ממועדון הלקוחות.
        ניתן להסיר את עצמכם בכל עת בהשבת &quot;{unsubKeyword}&quot; לכל הודעה או בלחיצה על קישור ההסרה שבה.
      </p>
    </>
  );
}
```

- [ ] **Step 3: Document the new optional env vars**

Append to the end of `.env.example`:

```bash
# Optional: shown as action buttons on the signup success screen (hidden when unset).
# NEXT_PUBLIC_BUSINESS_PHONE: tel: link target, e.g. +97288591234
# NEXT_PUBLIC_WHATSAPP_PHONE: wa.me number, digits only with country code, e.g. 972501234567
NEXT_PUBLIC_BUSINESS_PHONE=
NEXT_PUBLIC_WHATSAPP_PHONE=
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`, open http://localhost:3000.
Checklist:
- Eyebrow + display headline + benefit bullets render RTL, phone/email inputs are LTR.
- Submitting with an empty required field triggers native validation in Hebrew.
- A valid submission (use local SQLite) swaps the form for the success view.
- Submitting the same phone again shows "אתם כבר רשומים…" via the alert region.
- A submission with wedding day left blank succeeds.
- Consent line shows the keyword (1111 by default).

Run: `npm test` — all pass.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/VIPForm.tsx .env.example
git commit -m "feat(landing): benefit-led redesign, success state, spam-law consent line"
```

---

### Task 6: SMS segment counting library (TDD)

**Files:**
- Create: `lib/sms-segments.ts`
- Create: `tests/sms-segments.test.ts`

Background: Hebrew forces UCS-2 encoding. Limits: ≤70 UTF-16 code units = 1 segment; above that, `ceil(units / 67)` segments. JS `string.length` counts UTF-16 code units — exactly the billing unit (do NOT use `[...str].length`; it undercounts emoji, which cost 2 units as surrogate pairs).

- [ ] **Step 1: Write the failing test**

Create `tests/sms-segments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  smsUnits,
  segmentsForUnits,
  smsSegments,
  estimateUnsubFooterUnits,
} from "@/lib/sms-segments";

describe("smsUnits", () => {
  it("counts Hebrew letters, spaces and punctuation as 1 unit each", () => {
    expect(smsUnits("שלום, עולם!")).toBe(11);
  });

  it("counts an astral-plane emoji as 2 units (surrogate pair)", () => {
    expect(smsUnits("🍣")).toBe(2);
  });

  it("counts a newline as 1 unit", () => {
    expect(smsUnits("א\nב")).toBe(3);
  });
});

describe("segmentsForUnits", () => {
  it.each([
    [0, 0],
    [1, 1],
    [70, 1], // single-segment boundary
    [71, 2], // crossing 70 jumps straight to 67-per-segment math
    [134, 2],
    [135, 3],
    [201, 3],
    [202, 4],
  ])("%i units -> %i segments", (units, expected) => {
    expect(segmentsForUnits(units)).toBe(expected);
  });
});

describe("smsSegments", () => {
  it("is segmentsForUnits over the text length", () => {
    expect(smsSegments("א".repeat(70))).toBe(1);
    expect(smsSegments("א".repeat(71))).toBe(2);
    expect(smsSegments("")).toBe(0);
  });
});

describe("estimateUnsubFooterUnits", () => {
  it("matches the worker's footer template with a sample link", () => {
    const units = estimateUnsubFooterUnits("1111", "https://example.vercel.app");
    const expected =
      "\n\nלהסרה: השב/י 1111 או לחצ/י כאן: https://example.vercel.app/unsubscribe/972501234567?token=" +
      "x".repeat(64);
    expect(units).toBe(expected.length);
  });

  it("strips a trailing slash from the base URL", () => {
    expect(estimateUnsubFooterUnits("1111", "https://a.b/")).toBe(
      estimateUnsubFooterUnits("1111", "https://a.b")
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sms-segments.test.ts`
Expected: FAIL — cannot resolve `@/lib/sms-segments`.

- [ ] **Step 3: Implement lib/sms-segments.ts**

```ts
/**
 * Hebrew SMS is always UCS-2 (any char outside GSM 03.38 forces the whole
 * message to UCS-2, and every Hebrew letter is outside it). Billing counts
 * UTF-16 code units — which is exactly JS string.length. Astral-plane emoji
 * are surrogate pairs and correctly cost 2.
 */
export const UCS2_SINGLE = 70;
export const UCS2_MULTI = 67; // 6-byte concat header = 3 UCS-2 chars per part

export function smsUnits(text: string): number {
  return text.length;
}

export function segmentsForUnits(units: number): number {
  if (units <= 0) return 0;
  return units <= UCS2_SINGLE ? 1 : Math.ceil(units / UCS2_MULTI);
}

export function smsSegments(text: string): number {
  return segmentsForUnits(smsUnits(text));
}

const SAMPLE_PHONE_DIGITS = "972501234567";
const SAMPLE_TOKEN = "x".repeat(64); // generateSecureToken emits 64 hex chars

/**
 * Estimated UTF-16 length of the footer the SMS worker appends
 * (see app/api/send_sms_task/route.ts):
 *   "\n\nלהסרה: השב/י {keyword} או לחצ/י כאן: {link}"
 * Token length and recipient number vary by a few chars — treat as ≈.
 */
export function estimateUnsubFooterUnits(
  keyword = "1111",
  baseUrl = "https://example.vercel.app"
): number {
  const link = `${baseUrl.replace(/\/+$/, "")}/unsubscribe/${SAMPLE_PHONE_DIGITS}?token=${SAMPLE_TOKEN}`;
  return `\n\nלהסרה: השב/י ${keyword} או לחצ/י כאן: ${link}`.length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/sms-segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sms-segments.ts tests/sms-segments.test.ts
git commit -m "feat(sms): UCS-2 segment counting lib with unsubscribe-footer estimate"
```

---

### Task 7: Broadcast composer upgrade

**Files:**
- Rewrite: `app/admin/BroadcastForm.tsx`
- Delete: `app/admin/TestMessageForm.tsx`
- Modify: `app/admin/page.tsx` (remove TestMessageForm import/usage only — full page rewrite is Task 9)

- [ ] **Step 1: Rewrite app/admin/BroadcastForm.tsx**

```tsx
"use client";

import { useMemo, useState } from "react";
import {
  smsUnits,
  segmentsForUnits,
  estimateUnsubFooterUnits,
} from "@/lib/sms-segments";

type Props = { importToken: string; activeCount: number; newCount: number };

export default function BroadcastForm({ importToken, activeCount, newCount }: Props) {
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"all" | "new_only">("all");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);

  const footerUnits = useMemo(() => estimateUnsubFooterUnits(), []);
  const units = smsUnits(message);
  const totalUnits = units === 0 ? 0 : units + footerUnits;
  const totalSegments = segmentsForUnits(totalUnits);
  const recipients = audience === "all" ? activeCount : newCount;
  const level = totalSegments >= 4 ? "high" : totalSegments >= 3 ? "warn" : "ok";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const confirmMsg =
      audience === "new_only"
        ? `לשלוח רק ל-${newCount} לקוחות חדשים (שטרם קיבלו הודעה)?\n~${totalSegments} מקטעי SMS לנמען, ~${newCount * totalSegments} הודעות בסך הכל.`
        : `לשלוח לכולם (${activeCount} פעילים)?\n~${totalSegments} מקטעי SMS לנמען, ~${activeCount * totalSegments} הודעות בסך הכל.`;
    if (!confirm(confirmMsg)) return;

    setFeedback(null);
    setSending(true);
    const formData = new FormData();
    formData.set("message", message);
    formData.set("send_to", audience);
    formData.set("import_token", importToken);

    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (data.msg != null) {
        setFeedback({ ok: data.ok === true, msg: data.msg });
        if (data.ok === true) setMessage("");
      } else {
        setFeedback({ ok: false, msg: res.ok ? "תגובה לא צפויה מהשרת." : `שגיאה ${res.status}` });
      }
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : "שגיאת רשת." });
    } finally {
      setSending(false);
    }
  }

  function handleTestSend() {
    const phone = window.prompt("מספר טלפון לבדיקה (למשל 0501234567):");
    if (!phone) return;
    // Plain form POST so the existing 303-redirect-with-?msg= flow shows the result.
    const f = document.createElement("form");
    f.method = "POST";
    f.action = "/api/admin/send-test";
    const add = (name: string, value: string) => {
      const i = document.createElement("input");
      i.type = "hidden";
      i.name = name;
      i.value = value;
      f.appendChild(i);
    };
    add("import_token", importToken);
    add("phone", phone);
    add("message", message);
    document.body.appendChild(f);
    f.submit();
  }

  return (
    <>
      {feedback && (
        <p
          style={{
            marginBottom: "10px",
            padding: "8px 12px",
            borderRadius: "6px",
            fontWeight: "bold",
            backgroundColor: feedback.ok ? "#e8f5e9" : "#ffebee",
            color: feedback.ok ? "#2e7d32" : "#c62828",
          }}
          role="status"
        >
          {feedback.msg}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <textarea
          name="message"
          placeholder="הקלידו הודעה כאן..."
          required
          disabled={sending}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{ height: "100px" }}
          aria-describedby="sms-counter"
        />
        <div id="sms-counter" className="sms-counter" data-level={level}>
          <span>{units} תווים</span>
          <span>
            כולל קישור הסרה: ~{totalUnits} תווים · ~{totalSegments} מקטעי SMS לנמען
          </span>
        </div>
        <fieldset className="audience-group" style={{ border: "none" }}>
          <label>
            <input
              type="radio"
              name="audience"
              checked={audience === "all"}
              onChange={() => setAudience("all")}
              disabled={sending}
            />
            כל הפעילים ({activeCount})
          </label>
          <label>
            <input
              type="radio"
              name="audience"
              checked={audience === "new_only"}
              onChange={() => setAudience("new_only")}
              disabled={sending || newCount === 0}
            />
            רק חדשים שטרם קיבלו הודעה ({newCount})
          </label>
        </fieldset>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <button
            type="submit"
            disabled={sending || message.trim() === "" || recipients === 0}
            style={{ width: "auto", flex: "1 1 auto" }}
          >
            {sending ? "שולח..." : `🚀 שלח ל-${recipients} לקוחות`}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleTestSend}
            disabled={sending || message.trim() === ""}
            style={{ width: "auto" }}
          >
            📱 שלח בדיקה אליי
          </button>
        </div>
      </form>
    </>
  );
}
```

- [ ] **Step 2: Remove TestMessageForm**

In `app/admin/page.tsx`: delete the line `import TestMessageForm from "./TestMessageForm";` and the line `<TestMessageForm importToken={importToken} />`.

Run: `git rm app/admin/TestMessageForm.tsx`

- [ ] **Step 3: Verify**

Run: `npm run build` — compiles (this confirms the `@/lib/sms-segments` client import bundles fine).

Run: `npm run dev`, log in at `/login`, open `/admin`:
- Typing Hebrew in the textarea updates "X תווים" live; counter shows ~segments including the footer estimate.
- 🍣 emoji bumps the count by 2.
- Audience radio switches the recipient count on the send button.
- "שלח בדיקה אליי" prompts for a phone and posts the current draft (with no SMS gateway configured it redirects back with an error msg — that's the expected wiring).

- [ ] **Step 4: Commit**

```bash
git add app/admin/BroadcastForm.tsx app/admin/page.tsx
git commit -m "feat(admin): broadcast composer with segment counter, audience selector, draft test-send"
```

---

### Task 8: KPI computation library (TDD)

**Files:**
- Create: `lib/kpis.ts`
- Create: `tests/kpis.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/kpis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeKpis, type KpiCustomer } from "@/lib/kpis";

// computeKpis takes "today" (Israel local, YYYY-MM-DD) injected for determinism.
const TODAY = "2026-06-11";

function cust(over: Partial<KpiCustomer>): KpiCustomer {
  return {
    active: true,
    created_at: "2026-06-10 08:00:00",
    unsubscribed_at: null,
    received_message_at: "2026-06-10 09:00:00",
    ...over,
  };
}

describe("computeKpis", () => {
  it("returns zeros for an empty list", () => {
    expect(computeKpis([], TODAY)).toEqual({
      total: 0,
      active: 0,
      newLast7: 0,
      removedLast30: 0,
      neverMessaged: 0,
    });
  });

  it("counts active vs total and never-messaged actives", () => {
    const k = computeKpis(
      [
        cust({}),
        cust({ received_message_at: null }),
        cust({ active: false, unsubscribed_at: "2026-06-01 10:00:00" }),
      ],
      TODAY
    );
    expect(k.total).toBe(3);
    expect(k.active).toBe(2);
    expect(k.neverMessaged).toBe(1);
  });

  it("counts signups within the last 7 Israel-local days (inclusive window)", () => {
    const k = computeKpis(
      [
        cust({ created_at: "2026-06-11 05:00:00" }), // today
        cust({ created_at: "2026-06-05 05:00:00" }), // 6 days ago — inside
        cust({ created_at: "2026-06-04 05:00:00" }), // 7 days ago — outside
        cust({ created_at: null }),
      ],
      TODAY
    );
    expect(k.newLast7).toBe(2);
  });

  it("counts removals within the last 30 days only for inactive customers", () => {
    const k = computeKpis(
      [
        cust({ active: false, unsubscribed_at: "2026-06-01 10:00:00" }), // inside
        cust({ active: false, unsubscribed_at: "2026-05-13 10:00:00" }), // 29 days ago — inside
        cust({ active: false, unsubscribed_at: "2026-05-12 10:00:00" }), // 30 days ago — outside
        cust({ active: true, unsubscribed_at: "2026-06-01 10:00:00" }), // re-joined — not counted
      ],
      TODAY
    );
    expect(k.removedLast30).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/kpis.test.ts`
Expected: FAIL — cannot resolve `@/lib/kpis`.

- [ ] **Step 3: Implement lib/kpis.ts**

```ts
import { toIsraelDateStr } from "./dates";

export type KpiCustomer = {
  active: boolean;
  created_at: string | null;
  unsubscribed_at: string | null;
  received_message_at: string | null;
};

export type Kpis = {
  total: number;
  active: number;
  newLast7: number;
  removedLast30: number;
  neverMessaged: number;
};

/** YYYY-MM-DD string arithmetic in UTC (inputs are already calendar dates). */
function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Dashboard KPIs over the full customer list. `todayIsrael` is injected
 * (israelToday() at the call site) so the math is pure and testable.
 */
export function computeKpis(customers: KpiCustomer[], todayIsrael: string): Kpis {
  const weekCutoff = shiftDateStr(todayIsrael, -6); // 7-day inclusive window
  const monthCutoff = shiftDateStr(todayIsrael, -29); // 30-day inclusive window

  let active = 0;
  let newLast7 = 0;
  let removedLast30 = 0;
  let neverMessaged = 0;

  for (const c of customers) {
    if (c.active) {
      active++;
      if (!c.received_message_at) neverMessaged++;
    }
    const created = toIsraelDateStr(c.created_at);
    if (created && created >= weekCutoff && created <= todayIsrael) newLast7++;
    const removed = toIsraelDateStr(c.unsubscribed_at);
    if (!c.active && removed && removed >= monthCutoff && removed <= todayIsrael) removedLast30++;
  }

  return { total: customers.length, active, newLast7, removedLast30, neverMessaged };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/kpis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/kpis.ts tests/kpis.test.ts
git commit -m "feat(admin): tested KPI computation (active, new-7d, removed-30d, never-messaged)"
```

---

### Task 9: Customer table component + admin page restructure

**Files:**
- Create: `app/admin/CustomerTable.tsx`
- Rewrite: `app/admin/page.tsx`

- [ ] **Step 1: Create app/admin/CustomerTable.tsx**

```tsx
"use client";

import { useMemo, useState } from "react";

export type CustomerView = {
  phone: string;
  name: string;
  email: string;
  date_of_birth: string;
  wedding_day: string;
  city: string;
  active: boolean;
  regDate: string; // pre-formatted YYYY-MM-DD or "-"
  isNew: boolean; // active and never messaged
};

type Props = { customers: CustomerView[]; importToken: string };

function ToggleForm({ phone, active, importToken }: { phone: string; active: boolean; importToken: string }) {
  return (
    <form action="/api/admin/toggle" method="POST" style={{ display: "inline" }}>
      <input type="hidden" name="import_token" value={importToken} />
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="action" value={active ? "block" : "unblock"} />
      <button type="submit" className="admin-table-btn">
        {active ? "⛔ חסימה" : "✅ שחזור"}
      </button>
    </form>
  );
}

function StatusBadges({ c }: { c: CustomerView }) {
  return (
    <span style={{ display: "inline-flex", gap: "6px" }}>
      {c.active ? <span className="badge badge-active">פעיל</span> : <span className="badge badge-removed">הוסר</span>}
      {c.isNew && <span className="badge badge-new">חדש</span>}
    </span>
  );
}

export default function CustomerTable({ customers, importToken }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    const qDigits = q.replace(/\D/g, "");
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (qDigits !== "" && c.phone.replace(/\D/g, "").includes(qDigits))
    );
  }, [customers, query]);

  return (
    <>
      <input
        type="search"
        className="table-search"
        placeholder="חיפוש לפי שם, טלפון, עיר או דוא&quot;ל..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="חיפוש לקוחות"
      />
      {query && (
        <p style={{ fontSize: "13px", margin: "0 0 10px" }}>
          {filtered.length} תוצאות מתוך {customers.length}
        </p>
      )}

      {/* Desktop: full table */}
      <div className="customers-desktop admin-table-wrap">
        <table className="admin-table">
          <thead style={{ background: "#f5f5f5" }}>
            <tr style={{ borderBottom: "2px solid #d32f2f" }}>
              <th style={{ padding: "10px", textAlign: "right" }}>שם</th>
              <th style={{ padding: "10px", textAlign: "right" }}>דוא&quot;ל</th>
              <th style={{ padding: "10px", textAlign: "right" }}>טלפון</th>
              <th style={{ padding: "10px", textAlign: "center" }}>תאריך לידה</th>
              <th style={{ padding: "10px", textAlign: "center" }}>יום נישואין</th>
              <th style={{ padding: "10px", textAlign: "right" }}>עיר</th>
              <th style={{ padding: "10px", textAlign: "center" }}>תאריך רישום</th>
              <th style={{ padding: "10px", textAlign: "center" }}>סטטוס</th>
              <th style={{ padding: "10px", textAlign: "center" }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: "20px", textAlign: "center", color: "#666" }}>
                  אין תוצאות
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.phone} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px", textAlign: "right" }}>{c.name}</td>
                <td style={{ padding: "10px", textAlign: "right", fontSize: "12px" }}>{c.email || "-"}</td>
                <td style={{ padding: "10px", textAlign: "right", fontSize: "12px", direction: "ltr" }}>{c.phone}</td>
                <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.date_of_birth || "-"}</td>
                <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.wedding_day || "-"}</td>
                <td style={{ padding: "10px", textAlign: "right", fontSize: "12px" }}>{c.city || "-"}</td>
                <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.regDate}</td>
                <td style={{ padding: "10px", textAlign: "center" }}>
                  <StatusBadges c={c} />
                </td>
                <td style={{ padding: "10px", textAlign: "center" }}>
                  <ToggleForm phone={c.phone} active={c.active} importToken={importToken} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards with progressive disclosure */}
      <div className="customers-mobile">
        {filtered.length === 0 && <p style={{ textAlign: "center" }}>אין תוצאות</p>}
        {filtered.map((c) => (
          <div key={c.phone} className="customer-card">
            <div className="customer-card-head">
              <span className="customer-card-name">{c.name}</span>
              <StatusBadges c={c} />
            </div>
            <p className="customer-card-line">
              <a href={`tel:${c.phone}`} style={{ direction: "ltr", unicodeBidi: "embed" }}>
                {c.phone}
              </a>
              {c.city ? ` · ${c.city}` : ""}
            </p>
            <p className="customer-card-line">נרשם/ה {c.regDate}</p>
            <details>
              <summary>פרטים נוספים</summary>
              <p className="customer-card-line">דוא&quot;ל: {c.email || "-"}</p>
              <p className="customer-card-line">תאריך לידה: {c.date_of_birth || "-"}</p>
              <p className="customer-card-line">יום נישואין: {c.wedding_day || "-"}</p>
            </details>
            <div style={{ marginTop: "6px" }}>
              <ToggleForm phone={c.phone} active={c.active} importToken={importToken} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Rewrite app/admin/page.tsx**

```tsx
import { redirect } from "next/navigation";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth";
import { createImportToken } from "@/lib/security";
import { getDb, queryCustomers, mapRow, initDb, type CustomerRow } from "@/lib/db";
import { israelToday, toIsraelDateStr } from "@/lib/dates";
import { computeKpis } from "@/lib/kpis";
import BroadcastForm from "./BroadcastForm";
import UploadForm from "./UploadForm";
import ResetDbForm from "./ResetDbForm";
import CustomerTable, { type CustomerView } from "./CustomerTable";

const AdminStats = nextDynamic(() => import("./AdminStats"), {
  ssr: true,
  loading: () => (
    <div style={{ minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
      טוען סטטיסטיקות...
    </div>
  ),
});

export const dynamic = "force-dynamic";

function formatRegDate(created: string | null): string {
  if (!created) return "-";
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) return created.trim().split(" ")[0] || "-";
  return d.toISOString().slice(0, 10);
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; filter?: string }>;
}) {
  const ok = await getAdminSession();
  if (!ok) redirect("/login");

  let importToken = "";
  try {
    importToken = createImportToken();
  } catch {
    importToken = "";
  }

  let customers: CustomerRow[] = [];
  try {
    await initDb();
    const db = getDb();
    const rows = await queryCustomers(
      db,
      "SELECT phone, name, email, date_of_birth, wedding_day, city, active, created_at, received_message_at, unsubscribed_at FROM customers ORDER BY active DESC, name ASC",
      []
    );
    if (db.type === "sqlite") db.conn.close();
    customers = rows.map(mapRow);
  } catch (e) {
    console.error("Admin page DB error:", e);
    redirect("/login?error=system");
  }

  const today = israelToday();
  const kpis = computeKpis(customers, today);

  const byDate: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  for (const c of customers) {
    const d = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : "";
    if (d) byDate[d] = (byDate[d] ?? 0) + 1;
    const city = (c.city ?? "").trim() || "ללא עיר";
    byCity[city] = (byCity[city] ?? 0) + 1;
  }
  const signupsByDate = Object.entries(byDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const cityCounts = Object.entries(byCity)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const params = await searchParams;
  const msg = params.msg ?? "";

  const isSignupToday = (c: CustomerRow) => toIsraelDateStr(c.created_at) === today;
  const isRemovedToday = (c: CustomerRow) => !c.active && toIsraelDateStr(c.unsubscribed_at) === today;
  const signupTodayCount = customers.filter(isSignupToday).length;
  const removedTodayCount = customers.filter(isRemovedToday).length;

  const filter = params.filter === "signup_today" || params.filter === "unsub_today" ? params.filter : "";
  const displayed =
    filter === "signup_today"
      ? customers.filter(isSignupToday)
      : filter === "unsub_today"
        ? customers.filter(isRemovedToday)
        : customers;

  const customerViews: CustomerView[] = displayed.map((c) => ({
    phone: c.phone,
    name: c.name,
    email: c.email,
    date_of_birth: c.date_of_birth,
    wedding_day: c.wedding_day,
    city: c.city,
    active: c.active,
    regDate: formatRegDate(c.created_at),
    isNew: c.active && !c.received_message_at,
  }));

  return (
    <div className="container admin-container">
      <div style={{ direction: "rtl", textAlign: "right" }}>
        <div className="admin-header">
          <h2 className="admin-title">ניהול לקוחות 🍣</h2>
          <div className="admin-actions">
            <Link
              href="/api/admin/export-csv"
              className="admin-btn admin-btn-green"
              target="_blank"
              rel="noopener noreferrer"
            >
              📊 ייצוא CSV
            </Link>
            <Link href="/api/logout" className="admin-btn admin-btn-logout">
              יציאה
            </Link>
          </div>
        </div>

        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-value">{kpis.active}</div>
            <div className="kpi-label">לקוחות פעילים</div>
            <div className="kpi-sub">מתוך {kpis.total} רשומים</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{kpis.newLast7}</div>
            <div className="kpi-label">חדשים ב-7 ימים</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{kpis.removedLast30}</div>
            <div className="kpi-label">הוסרו ב-30 יום</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{kpis.neverMessaged}</div>
            <div className="kpi-label">טרם קיבלו הודעה</div>
          </div>
        </div>

        <div className="admin-card">
          <h3 style={{ marginTop: 0 }}>📢 שליחת הודעה</h3>
          <BroadcastForm importToken={importToken} activeCount={kpis.active} newCount={kpis.neverMessaged} />
          {msg && <p style={{ color: "#1565c0", fontWeight: "bold", marginTop: "10px" }}>{msg}</p>}
        </div>

        <div className="admin-card">
          <UploadForm importToken={importToken} />
        </div>

        <AdminStats signupsByDate={signupsByDate} cityCounts={cityCounts} />

        <h3 style={{ borderBottom: "2px solid #d32f2f", paddingBottom: "5px", display: "inline-block", marginBottom: "15px" }}>
          רשימת לקוחות ({displayed.length})
        </h3>

        <div className="filter-chips">
          {[
            { key: "", label: `הכל (${customers.length})`, href: "/admin" },
            { key: "signup_today", label: `נרשמו היום (${signupTodayCount})`, href: "/admin?filter=signup_today" },
            { key: "unsub_today", label: `הוסרו היום (${removedTodayCount})`, href: "/admin?filter=unsub_today" },
          ].map((f) => (
            <Link key={f.key || "all"} href={f.href} className="filter-chip" data-active={filter === f.key}>
              {f.label}
            </Link>
          ))}
        </div>

        <CustomerTable customers={customerViews} importToken={importToken} />

        <div className="danger-zone">
          <h3>אזור מסוכן</h3>
          <p style={{ fontSize: "13px" }}>פעולות בלתי הפיכות. להשתמש בזהירות.</p>
          <ResetDbForm importToken={importToken} />
        </div>
      </div>
    </div>
  );
}
```

Note: `UploadForm` keeps its current implementation; it just moves into its own card.

- [ ] **Step 3: Verify**

Run: `npm run build` — compiles.

Run: `npm run dev`, open `/admin`:
- KPI row renders 4 cards (2×2 on a narrow window).
- Search box filters the list live by name/phone digits/city/email.
- Below 700px width (DevTools device toolbar): table disappears, cards appear, "פרטים נוספים" expands, phone is a tap-to-call link, block/unblock works from a card.
- Reset button now sits in the red danger zone at the bottom, not the header.

- [ ] **Step 4: Commit**

```bash
git add app/admin/CustomerTable.tsx app/admin/page.tsx
git commit -m "feat(admin): KPI cards, searchable customer list with mobile cards, danger zone"
```

---

### Task 10: Type-to-confirm database reset

**Files:**
- Rewrite: `app/admin/ResetDbForm.tsx`

- [ ] **Step 1: Rewrite the component**

```tsx
"use client";

import { useState } from "react";

const CONFIRM_WORD = "מחיקה";

export default function ResetDbForm({ importToken }: { importToken: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const armed = typed.trim() === CONFIRM_WORD;

  if (!open) {
    return (
      <button type="button" className="btn-danger" style={{ width: "auto" }} onClick={() => setOpen(true)}>
        איפוס מאגר (מחיקת כל הלקוחות)…
      </button>
    );
  }

  return (
    <form
      action="/api/admin/reset-db"
      method="POST"
      onSubmit={(e) => {
        if (!armed) e.preventDefault();
      }}
    >
      <input type="hidden" name="import_token" value={importToken} />
      <p style={{ fontSize: "13px", fontWeight: 600, color: "#b71c1c" }}>
        פעולה זו תמחק את כל הלקוחות לצמיתות. אין שחזור. כדי להמשיך, הקלידו: <strong>{CONFIRM_WORD}</strong>
      </p>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={CONFIRM_WORD}
        aria-label={`הקלידו ${CONFIRM_WORD} לאישור`}
        autoComplete="off"
        style={{ maxWidth: "200px" }}
      />
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button type="submit" className="btn-danger" disabled={!armed} style={{ width: "auto" }}>
          מחק את כל הלקוחות
        </button>
        <button
          type="button"
          className="btn-secondary"
          style={{ width: "auto" }}
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run dev`, open `/admin`, scroll to the danger zone:
- Initial state is a single red button; clicking reveals the type-to-confirm form.
- The delete button stays disabled until exactly `מחיקה` is typed.
- ביטול collapses and clears the input.
(Do NOT actually submit against a database you care about.)

- [ ] **Step 3: Commit**

```bash
git add app/admin/ResetDbForm.tsx
git commit -m "feat(admin): type-to-confirm guard on database reset"
```

---

### Task 11: Favicon

**Files:**
- Create: `app/icon.svg`

- [ ] **Step 1: Create app/icon.svg** (App Router file convention — becomes the favicon automatically; a maki roll seen from above in the brand palette)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0c0a09"/>
  <circle cx="32" cy="32" r="18" fill="none" stroke="#faf7f2" stroke-width="7"/>
  <circle cx="32" cy="32" r="18" fill="none" stroke="#d4a853" stroke-width="2"/>
  <circle cx="32" cy="32" r="8" fill="#e8745a"/>
</svg>
```

- [ ] **Step 2: Verify**

Run: `npm run dev`, hard-refresh http://localhost:3000.
Expected: browser tab shows the dark maki-roll icon (check in an incognito window if the old favicon is cached).

- [ ] **Step 3: Commit**

```bash
git add app/icon.svg
git commit -m "feat(meta): maki-roll favicon via App Router icon convention"
```

---

### Task 12: Unsubscribe page polish

**Files:**
- Modify: `app/unsubscribe/[phone]/page.tsx`

- [ ] **Step 1: Update the rendered JSX** (logic above the return stays identical). Replace the `return` block with:

```tsx
  return (
    <div className="container">
      <div className="logo-area">
        <Logo />
      </div>
      <h2 className="success">הוסרת בהצלחה</h2>
      <p>לא תקבלו מאיתנו יותר הודעות.</p>
      <p>התחרטתם? תמיד אפשר לחזור — ניתן להירשם מחדש בכל רגע.</p>
      <a className="btn-ghost" href="/">
        הצטרפות מחדש למועדון
      </a>
    </div>
  );
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add "app/unsubscribe/[phone]/page.tsx"
git commit -m "feat(unsubscribe): friendlier copy with re-join path"
```

---

### Task 13: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass — the 9 pre-existing test files plus `submit-form.test.ts`, `sms-segments.test.ts`, `kpis.test.ts`.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `✓ Compiled successfully`, route list prints with `/` as a static-ish page and `/admin` dynamic.

- [ ] **Step 3: Manual checklist** (run `npm run dev`)

Landing (`/`):
- Photos crossfade smoothly; total image transfer in DevTools Network is well under 1MB after a full slideshow cycle (AVIF/WebP via `/_next/image`).
- Lighthouse (DevTools, mobile): Performance ≥ 90, Accessibility ≥ 95. If LCP flags the first slide, confirm it carries `fetchpriority="high"` in the rendered HTML.
- Keyboard-only pass: tab order reaches every field and the submit button with a visible gold focus ring.
- Reduced motion emulation freezes the slideshow.
- Successful signup → success view; duplicate signup → Hebrew error announced via the alert region; signup without wedding date succeeds.

Admin (`/admin`):
- KPI cards correct against the seeded data; composer counter math spot-check: 70 Hebrew chars in the textarea + footer estimate shows ≥3 segments (the footer alone is ~110 units).
- Mobile width: KPI 2×2, composer usable, customer cards with working block/unblock, danger zone requires typing `מחיקה`.

Login (`/login`) and unsubscribe pages render in the dark theme with no stray light-on-light or dark-on-dark text.

- [ ] **Step 4: Fix anything found, then final commit if needed**

```bash
git add -A
git commit -m "chore: post-overhaul verification fixes"
```

---

## Out of scope (deliberately)

- **Broadcast scheduling** (QStash `notBefore`) — natural follow-up, separate plan.
- **Double opt-in confirmation SMS** — recommended by the spam-law research as gold-standard consent proof; touches the SMS worker and DB schema, separate plan.
- **Form-field reduction to name+phone two-step** — highest-converting pattern from research, but it changes the data contract (email/dob/city currently required by the owner); raise with the owner before planning.
- **Signup-gift headline copy** ("רול במתנה") — requires the owner to commit to an actual gift; current copy only promises what the system already delivers (1+1 deals, birthday SMS).
- The legacy `api/` Flask folder and its `api/static` images.
