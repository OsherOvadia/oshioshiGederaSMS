# Harden & Test the Oshioshi Gedera SMS App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close real security gaps (session-token-in-URL leak, non-constant-time login, per-instance rate limiting, weak unsubscribe token), fix correctness bugs (EU-QStash birthday cron, fragile birthday date parsing), remove dead code, and introduce a Vitest test harness with unit coverage for the touched logic.

**Architecture:** This is a Next.js 14 App Router app. Most fixes are isolated to `lib/*` pure helpers (easy to unit-test) plus thin edits to the route handlers and middleware that consume them. We introduce shared helpers (`lib/qstash.ts`, `lib/dates.ts`, `lib/admin-auth.ts`) so that duplicated logic lives in one tested place. Rate limiting gains an Upstash Redis backend (already paying for Upstash via QStash) with a graceful in-memory fallback for local dev. We add Vitest configured with the `@/` path alias.

**Tech Stack:** Next.js 14, TypeScript, `pg`/`better-sqlite3`, `@upstash/qstash`, `jose`, **new:** `vitest`, `@upstash/redis`.

**Conventions for every task:** Tests live under `tests/` mirroring source paths. Run a single test file with `npx vitest run <path>`. Each task is committed on completion. Work on a branch, not `main`.

---

## File Structure

**New files**
- `vitest.config.ts` — Vitest config with `@/` alias, node environment.
- `lib/dates.ts` — `getBirthMonth()` robust birthday-month parser.
- `lib/qstash.ts` — shared QStash base/url helpers + `publishSmsTask()` (DRY across broadcast + cron).
- `lib/admin-auth.ts` — constant-time admin password verification.
- `tests/lib/validation.test.ts`, `tests/lib/dates.test.ts`, `tests/lib/qstash.test.ts`, `tests/lib/security-token.test.ts`, `tests/lib/admin-auth.test.ts`, `tests/lib/ratelimit.test.ts`, `tests/api/login.test.ts`.

**Modified files**
- `package.json` — add `vitest`, `@upstash/redis`, test scripts.
- `lib/ratelimit.ts` — async, Upstash Redis backend + in-memory fallback.
- `lib/security.ts` — stronger unsubscribe token + legacy verification.
- `lib/validation.ts` — add `normalizeAdminPhone()` (extracted from toggle route).
- `app/api/login/route.ts` — constant-time password, set session cookie directly.
- `app/login/LoginForm.tsx` — stop putting the JWT in the URL.
- `middleware.ts` — drop the `?session=` bridge.
- `app/api/cron/birthday_check/route.ts` — use shared QStash helper + robust month parsing.
- `app/api/admin/broadcast/route.ts` — use shared QStash helper.
- `app/api/admin/toggle/route.ts` — use `normalizeAdminPhone()`, drop dead dialect branch.
- `app/api/submit/route.ts`, `app/api/send_sms_task/route.ts`, `app/api/admin/force-init/route.ts`, `app/api/admin/export-csv/route.ts` — `await checkRateLimit(...)`.
- `.env.example`, `README.md` — document `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_URL`, `APP_URL`.

---

## Task 0: Branch

- [ ] **Step 1: Create a working branch**

```bash
git checkout -b harden-and-test
```

---

## Task 1: Vitest harness + first smoke test

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/lib/validation.test.ts`

- [ ] **Step 1: Add Vitest dev dependency and scripts**

Run:

```bash
npm install --save-dev vitest@^2.0.0
```

Then edit `package.json` `"scripts"` so it reads exactly:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 2: Create the Vitest config with the `@/` alias**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 3: Exclude tests from the Next/tsc build**

`tsconfig.json` currently includes `**/*.ts`, so `npm run build` would type-check the new test files (and fail on vitest-only imports). Update the `"exclude"` array in `tsconfig.json` (line 19) from:

```json
  "exclude": ["node_modules"]
```

to:

```json
  "exclude": ["node_modules", "tests", "vitest.config.ts"]
```

Vitest type-resolves its own files independently of this, so the test suite is unaffected.

- [ ] **Step 4: Write a smoke test against existing validation helpers**

Create `tests/lib/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatPhone, isValidEmail, isValidPhone } from "@/lib/validation";

describe("formatPhone", () => {
  it("converts a local 05X number to +972 E.164", () => {
    expect(formatPhone("0501234567")).toBe("+972501234567");
  });
  it("converts a 9-digit 5X number to +972", () => {
    expect(formatPhone("501234567")).toBe("+972501234567");
  });
  it("prefixes + onto a 972 number", () => {
    expect(formatPhone("972501234567")).toBe("+972501234567");
  });
  it("returns empty string for nullish input", () => {
    expect(formatPhone(undefined)).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
  });
  it("rejects a string without @", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
  });
});

describe("isValidPhone", () => {
  it("accepts a +-prefixed 10+ digit phone", () => {
    expect(isValidPhone("+972501234567")).toBe(true);
  });
  it("rejects a phone without +", () => {
    expect(isValidPhone("0501234567")).toBe(false);
  });
});
```

- [ ] **Step 5: Run the smoke test — it must pass against current code**

Run: `npx vitest run tests/lib/validation.test.ts`
Expected: PASS, 8 tests passing. (This proves the harness + alias resolve correctly.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.json tests/lib/validation.test.ts
git commit -m "test: add Vitest harness with @/ alias and validation smoke tests"
```

---

## Task 2: Robust birthday-month parsing (`lib/dates.ts`)

Fixes the bug where `new Date("15/03/1990")` misparses Israeli day-first dates, putting birthdays in the wrong month.

**Files:**
- Create: `lib/dates.ts`
- Create: `tests/lib/dates.test.ts`
- Modify: `app/api/cron/birthday_check/route.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/dates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getBirthMonth } from "@/lib/dates";

describe("getBirthMonth", () => {
  it("parses ISO YYYY-MM-DD", () => {
    expect(getBirthMonth("1990-03-15")).toBe(3);
  });
  it("parses Israeli day-first DD/MM/YYYY", () => {
    expect(getBirthMonth("15/03/1990")).toBe(3);
  });
  it("parses dotted DD.MM.YYYY", () => {
    expect(getBirthMonth("15.03.1990")).toBe(3);
  });
  it("parses single-digit day/month with 2-digit year", () => {
    expect(getBirthMonth("5/7/90")).toBe(7);
  });
  it("returns null for empty/nullish", () => {
    expect(getBirthMonth("")).toBeNull();
    expect(getBirthMonth(null)).toBeNull();
    expect(getBirthMonth(undefined)).toBeNull();
  });
  it("returns null for unparseable text", () => {
    expect(getBirthMonth("not a date")).toBeNull();
  });
  it("returns null for an out-of-range month", () => {
    expect(getBirthMonth("1990-13-01")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/dates.test.ts`
Expected: FAIL — cannot resolve module `@/lib/dates`.

- [ ] **Step 3: Implement `lib/dates.ts`**

Create `lib/dates.ts`:

```ts
/**
 * Extract the birth month (1-12) from a stored date-of-birth string.
 * DOB is stored as free-text, so handle ISO (YYYY-MM-DD) and the
 * Israeli day-first formats (DD/MM/YYYY, DD.MM.YYYY). Returns null when
 * the string cannot be parsed into a valid month, so callers can skip it.
 */
export function getBirthMonth(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const s = dob.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return clampMonth(parseInt(iso[2], 10));

  const dayFirst = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(s);
  if (dayFirst) return clampMonth(parseInt(dayFirst[2], 10));

  return null;
}

function clampMonth(m: number): number | null {
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/dates.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Use `getBirthMonth` in the birthday cron**

In `app/api/cron/birthday_check/route.ts`, add the import near the top (after the existing imports):

```ts
import { getBirthMonth } from "@/lib/dates";
```

Replace the loop that currently reads (around lines 38-50):

```ts
  const birthdaysFound: [string, string][] = [];
  for (const row of rows) {
    const dobStr = row.date_of_birth as string;
    if (!dobStr) continue;
    try {
      const dobDate = new Date(dobStr);
      if (dobDate.getMonth() + 1 === currentMonth) {
        birthdaysFound.push([String(row.phone), String(row.name ?? "")]);
      }
    } catch {
      // skip invalid date
    }
  }
```

with:

```ts
  const birthdaysFound: [string, string][] = [];
  for (const row of rows) {
    const month = getBirthMonth(row.date_of_birth as string);
    if (month === currentMonth) {
      birthdaysFound.push([String(row.phone), String(row.name ?? "")]);
    }
  }
```

- [ ] **Step 6: Verify the suite still passes and the app compiles**

Run: `npx vitest run`
Expected: PASS (validation + dates).

- [ ] **Step 7: Commit**

```bash
git add lib/dates.ts tests/lib/dates.test.ts app/api/cron/birthday_check/route.ts
git commit -m "fix(cron): robust day-first birthday month parsing via lib/dates"
```

---

## Task 3: Shared QStash helper (`lib/qstash.ts`) — fixes EU-QStash birthday bug

The birthday cron hardcodes `https://qstash.upstash.io`, so it silently fails for EU QStash users who set `QSTASH_URL`. Extract the broadcast route's working logic into a shared, tested helper and use it in both places.

**Files:**
- Create: `lib/qstash.ts`
- Create: `tests/lib/qstash.test.ts`
- Modify: `app/api/admin/broadcast/route.ts`
- Modify: `app/api/cron/birthday_check/route.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/qstash.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getQstashPublishBase, normalizeBaseUrl, resolveAppBaseUrl, publishSmsTask } from "@/lib/qstash";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("getQstashPublishBase", () => {
  it("defaults to the global host when QSTASH_URL is unset", () => {
    delete process.env.QSTASH_URL;
    expect(getQstashPublishBase()).toBe("https://qstash.upstash.io");
  });
  it("returns the origin of QSTASH_URL when set (EU region)", () => {
    process.env.QSTASH_URL = "https://eu1-foo-bar.upstash.io/v2/publish";
    expect(getQstashPublishBase()).toBe("https://eu1-foo-bar.upstash.io");
  });
  it("adds https:// to a bare host", () => {
    process.env.QSTASH_URL = "eu1-foo-bar.upstash.io";
    expect(getQstashPublishBase()).toBe("https://eu1-foo-bar.upstash.io");
  });
});

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes and keeps https", () => {
    expect(normalizeBaseUrl("https://app.example.com/")).toBe("https://app.example.com");
  });
  it("prefixes https:// for a bare host", () => {
    expect(normalizeBaseUrl("app.example.com")).toBe("https://app.example.com");
  });
  it("returns empty string for undefined or literal 'undefined'", () => {
    expect(normalizeBaseUrl(undefined)).toBe("");
    expect(normalizeBaseUrl("https://undefined")).toBe("");
  });
});

describe("resolveAppBaseUrl", () => {
  it("prefers the request origin", () => {
    process.env.APP_URL = "https://fallback.example.com";
    expect(resolveAppBaseUrl("https://live.example.com")).toBe("https://live.example.com");
  });
  it("falls back to APP_URL when no origin", () => {
    delete process.env.VERCEL_URL;
    process.env.APP_URL = "https://fallback.example.com";
    expect(resolveAppBaseUrl(undefined)).toBe("https://fallback.example.com");
  });
});

describe("publishSmsTask", () => {
  it("posts to <base>/v2/publish/<endpoint> and reports ok", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await publishSmsTask({
      targetEndpoint: "https://app.example.com/api/send_sms_task",
      phone: "+972501234567",
      message: "hi",
      secret: "s",
      token: "qstash-token",
    });
    expect(res.ok).toBe(true);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      "https://qstash.upstash.io/v2/publish/https://app.example.com/api/send_sms_task"
    );
  });
  it("reports not-ok with status text on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 401 })));
    const res = await publishSmsTask({
      targetEndpoint: "https://app.example.com/api/send_sms_task",
      phone: "+972501234567",
      message: "hi",
      secret: "s",
      token: "qstash-token",
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/qstash.test.ts`
Expected: FAIL — cannot resolve module `@/lib/qstash`.

- [ ] **Step 3: Implement `lib/qstash.ts`**

Create `lib/qstash.ts`:

```ts
const DEFAULT_QSTASH_HOST = "https://qstash.upstash.io";

/** QStash publish base: default global host, or the origin of QSTASH_URL (EU region). */
export function getQstashPublishBase(): string {
  const raw = process.env.QSTASH_URL;
  if (!raw || !String(raw).trim()) return DEFAULT_QSTASH_HOST;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.origin;
  } catch {
    return DEFAULT_QSTASH_HOST;
  }
}

/** Normalize a base URL to https://host with no trailing slash, or "" if unusable. */
export function normalizeBaseUrl(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/undefined/i.test(trimmed)) return "";
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("http://")) return trimmed;
  return `https://${trimmed}`;
}

/** Resolve this app's public base URL: request origin first, then env fallbacks. */
export function resolveAppBaseUrl(requestOrigin: string | undefined): string {
  return (
    normalizeBaseUrl(requestOrigin) ||
    normalizeBaseUrl(process.env.VERCEL_URL) ||
    normalizeBaseUrl(process.env.APP_URL) ||
    normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
  );
}

export type PublishResult = { ok: boolean; status?: number; error?: string };

/**
 * Publish a single SMS job to QStash, which will call our /api/send_sms_task
 * worker. Mirrors the original Python behavior: raw POST, target endpoint
 * appended directly to the publish path.
 */
export async function publishSmsTask(args: {
  targetEndpoint: string;
  phone: string;
  message: string;
  secret: string;
  token: string;
  timeoutMs?: number;
}): Promise<PublishResult> {
  const { targetEndpoint, phone, message, secret, token, timeoutMs = 12000 } = args;
  const url = `${getQstashPublishBase()}/v2/publish/${targetEndpoint}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone, message, secret }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text();
    return { ok: false, status: res.status, error: `QStash ${res.status}: ${text.slice(0, 120)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/qstash.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Refactor the broadcast route to use the shared helper**

In `app/api/admin/broadcast/route.ts`:

Replace the top-of-file QStash/url block (the `getQstashPublishBase` function, the `QSTASH_PUBLISH_BASE` const, and the `normalizeBaseUrl` function — lines 9-31) with a single import added to the existing import group:

```ts
import { resolveAppBaseUrl, publishSmsTask } from "@/lib/qstash";
```

Keep `const QSTASH_TOKEN = process.env.QSTASH_TOKEN;`.

Replace the base-url resolution block (currently lines 84-91) with:

```ts
    // Request origin first (matches Python url_root), then env fallbacks.
    const requestOrigin = req.url ? new URL(req.url).origin : req.nextUrl?.origin ?? "";
    const baseUrl = resolveAppBaseUrl(requestOrigin);
    const targetEndpoint = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/send_sms_task` : "";
```

Replace the QStash URL/auth setup and the chunked send loop (currently lines 113-145) with:

```ts
    const CHUNK = 8;
    let count = 0;
    let lastError: string | null = null;
    for (let i = 0; i < phones.length; i += CHUNK) {
      const chunk = phones.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map((phone) =>
          publishSmsTask({ targetEndpoint, phone, message, secret, token: QSTASH_TOKEN! })
        )
      );
      for (const r of results) {
        if (r.ok) count += 1;
        else if (r.error) lastError = r.error;
      }
    }
```

(The `const secret = getAppSecret();` line and the `if (!QSTASH_TOKEN)` guard above it remain unchanged.)

- [ ] **Step 6: Refactor the birthday cron to use the shared helper**

In `app/api/cron/birthday_check/route.ts`, add to the import group:

```ts
import { resolveAppBaseUrl, publishSmsTask } from "@/lib/qstash";
```

Replace the base-url + send block (currently lines 52-75) with:

```ts
  const baseUrl = resolveAppBaseUrl(req.nextUrl.origin);
  const targetEndpoint = `${baseUrl}/api/send_sms_task`;
  const secret = getAppSecret();
  let sentCount = 0;

  if (QSTASH_TOKEN && baseUrl) {
    for (const [phone, name] of birthdaysFound) {
      const msg = `היי ${name}, חוגג/ת יום הולדת החודש? 🎂\nמזל טוב! מחכה לך הטבה מיוחדת ב-Sushi VIP. בואו לחגוג איתנו! 🍣`;
      const r = await publishSmsTask({
        targetEndpoint,
        phone,
        message: msg,
        secret,
        token: QSTASH_TOKEN,
        timeoutMs: 5000,
      });
      if (r.ok) sentCount += 1;
      else console.error("Failed to queue birthday sms for", phone, r.error);
    }
  }
```

- [ ] **Step 7: Run the full suite and a production build to confirm both routes compile**

Run: `npx vitest run`
Expected: PASS.

Run: `npm run build`
Expected: Build succeeds with no type errors in `broadcast` or `birthday_check`.

- [ ] **Step 8: Commit**

```bash
git add lib/qstash.ts tests/lib/qstash.test.ts app/api/admin/broadcast/route.ts app/api/cron/birthday_check/route.ts
git commit -m "fix(qstash): share publish helper so birthday cron honors QSTASH_URL (EU)"
```

---

## Task 4: Strengthen the unsubscribe token (with legacy compatibility)

The current token is a 64-bit truncated HMAC whose input redundantly embeds the secret. Move to a 128-bit token, but keep verifying already-sent legacy tokens so links in past SMS still work.

**Files:**
- Modify: `lib/security.ts`
- Create: `tests/lib/security-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/security-token.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { generateSecureToken, verifyToken } from "@/lib/security";

const SECRET = "unit-test-secret-key";
beforeEach(() => {
  process.env.SECRET_KEY = SECRET;
  process.env.NODE_ENV = "test";
});

function legacyToken(phone: string): string {
  const data = `${phone}:${SECRET}`;
  return createHmac("sha256", SECRET).update(data).digest("hex").slice(0, 16);
}

describe("unsubscribe token", () => {
  const phone = "+972501234567";

  it("generates a 32-char (128-bit) hex token", () => {
    const t = generateSecureToken(phone);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });
  it("verifies a freshly generated token", () => {
    expect(verifyToken(phone, generateSecureToken(phone))).toBe(true);
  });
  it("still verifies a legacy 16-char token (backward compat)", () => {
    expect(verifyToken(phone, legacyToken(phone))).toBe(true);
  });
  it("rejects a token for a different phone", () => {
    expect(verifyToken("+972500000000", generateSecureToken(phone))).toBe(false);
  });
  it("rejects a garbage token", () => {
    expect(verifyToken(phone, "deadbeef")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/security-token.test.ts`
Expected: FAIL — current token is 16 chars, so the 32-char and legacy assertions fail.

- [ ] **Step 3: Update `lib/security.ts`**

Replace the existing `generateSecureToken` and `verifyToken` functions (lines 14-27) with:

```ts
export function generateSecureToken(phone: string): string {
  // 128-bit HMAC over the phone, keyed by the app secret.
  return createHmac("sha256", getSecret()).update(phone).digest("hex").slice(0, 32);
}

/** Legacy 64-bit token (kept only so unsubscribe links in already-sent SMS still verify). */
function legacySecureToken(phone: string): string {
  const data = `${phone}:${getSecret()}`;
  return createHmac("sha256", getSecret()).update(data).digest("hex").slice(0, 16);
}

export function verifyToken(phone: string, token: string): boolean {
  const candidates = [generateSecureToken(phone), legacySecureToken(phone)];
  return candidates.some((expected) => {
    if (expected.length !== token.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
    } catch {
      return false;
    }
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/security-token.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/security.ts tests/lib/security-token.test.ts
git commit -m "feat(security): 128-bit unsubscribe token with legacy verification"
```

---

## Task 5: Constant-time admin password verification (`lib/admin-auth.ts`)

**Files:**
- Create: `lib/admin-auth.ts`
- Create: `tests/lib/admin-auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/admin-auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyAdminPassword } from "@/lib/admin-auth";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("verifyAdminPassword", () => {
  it("returns true for the correct password", () => {
    process.env.ADMIN_PASSWORD = "s3cret-pass";
    process.env.NODE_ENV = "test";
    expect(verifyAdminPassword("s3cret-pass")).toBe(true);
  });
  it("returns false for the wrong password", () => {
    process.env.ADMIN_PASSWORD = "s3cret-pass";
    process.env.NODE_ENV = "test";
    expect(verifyAdminPassword("nope")).toBe(false);
  });
  it("returns false for a wrong password of different length", () => {
    process.env.ADMIN_PASSWORD = "s3cret-pass";
    process.env.NODE_ENV = "test";
    expect(verifyAdminPassword("x")).toBe(false);
  });
  it("throws in production when ADMIN_PASSWORD is unset", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = "production";
    expect(() => verifyAdminPassword("anything")).toThrow(/ADMIN_PASSWORD/);
  });
  it("falls back to 'admin' only outside production", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = "development";
    expect(verifyAdminPassword("admin")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/admin-auth.test.ts`
Expected: FAIL — cannot resolve module `@/lib/admin-auth`.

- [ ] **Step 3: Implement `lib/admin-auth.ts`**

Create `lib/admin-auth.ts`:

```ts
import { timingSafeEqual } from "crypto";

function getAdminPassword(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ADMIN_PASSWORD must be set in production");
    }
    return "admin";
  }
  return pw;
}

/** Constant-time admin password check. Throws in production if no password is configured. */
export function verifyAdminPassword(input: string): boolean {
  const expected = getAdminPassword();
  const a = Buffer.from(String(input ?? ""), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Compare equal-length buffers to avoid leaking length via early return timing.
    try {
      timingSafeEqual(b, b);
    } catch {
      /* ignore */
    }
    return false;
  }
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/admin-auth.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/admin-auth.ts tests/lib/admin-auth.test.ts
git commit -m "feat(security): constant-time admin password check, require it in prod"
```

---

## Task 6: Login sets the session cookie directly — stop leaking the JWT in the URL

The session JWT currently travels as `/admin?session=<jwt>` (browser history, access logs, Referer). Have `/api/login` set the cookie itself; drop the middleware bridge.

**Files:**
- Modify: `app/api/login/route.ts`
- Modify: `app/login/LoginForm.tsx`
- Modify: `middleware.ts`
- Create: `tests/api/login.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/login.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// getClientIp uses next/headers (request scope); stub it for unit testing.
vi.mock("@/lib/get-ip", () => ({ getClientIp: async () => "test-ip-login" }));

import { POST } from "@/app/api/login/route";
import { COOKIE_NAME } from "@/lib/session-jwt";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.ADMIN_PASSWORD = "login-test-pass";
  process.env.SECRET_KEY = "login-test-secret";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function loginReq(password: string): NextRequest {
  const fd = new FormData();
  fd.set("password", password);
  return new NextRequest("http://localhost/api/login", { method: "POST", body: fd });
}

describe("POST /api/login", () => {
  it("sets the session cookie and does NOT return the token in the body on success", async () => {
    const res = await POST(loginReq("login-test-pass"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.token).toBeUndefined();
    expect(res.cookies.get(COOKIE_NAME)?.value).toBeTruthy();
  });

  it("rejects a wrong password with 401 and no cookie", async () => {
    const res = await POST(loginReq("wrong"));
    expect(res.status).toBe(401);
    expect(res.cookies.get(COOKIE_NAME)?.value).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/login.test.ts`
Expected: FAIL — the current route returns `token` in the body and does not set a cookie.

- [ ] **Step 3: Update the login route to set the cookie**

Replace the entire contents of `app/api/login/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, createSessionJwt, getCookieOptions } from "@/lib/session-jwt";
import { verifyAdminPassword } from "@/lib/admin-auth";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "login", LIMITS.login.max);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  let password = "";
  try {
    const form = await req.formData();
    password = (form.get("password") as string) ?? "";
  } catch {
    const body = await req.json().catch(() => ({}));
    password = (body as { password?: string }).password ?? "";
  }

  if (verifyAdminPassword(password)) {
    const token = await createSessionJwt();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, token, getCookieOptions());
    return res;
  }

  return NextResponse.json({ ok: false, error: "wrong" }, { status: 401 });
}
```

(Note: this also applies the `await checkRateLimit` change for the login route ahead of Task 7.)

- [ ] **Step 4: Run the login test to verify it passes**

Run: `npx vitest run tests/api/login.test.ts`
Expected: PASS, 2 tests.

> If `new NextRequest(...)` with a `FormData` body fails to construct in the node test environment, set `vitest.config.ts` `test.environment` to `"node"` (already set) and ensure Node ≥18.17 (per `package.json` engines). `FormData`/`Request` are globals in that runtime.

- [ ] **Step 5: Stop putting the token in the URL (client)**

In `app/login/LoginForm.tsx`, replace the success block (currently lines 22-28):

```tsx
      if (res.ok && data.ok === true) {
        const token = (data as { token?: string }).token;
        window.location.href = token
          ? "/admin?session=" + encodeURIComponent(token)
          : "/admin";
        return;
      }
```

with:

```tsx
      if (res.ok && data.ok === true) {
        // Session cookie is set by /api/login (Set-Cookie); just navigate.
        window.location.href = "/admin";
        return;
      }
```

- [ ] **Step 6: Remove the `?session=` bridge from middleware**

In `middleware.ts`, delete the entire GET `/admin` block (currently lines 12-26):

```ts
  if (req.method === "GET" && req.nextUrl.pathname === "/admin") {
    const hasCookie = req.cookies.get(COOKIE_NAME)?.value;
    const sessionToken = req.nextUrl.searchParams.get("session");
    if (!hasCookie && sessionToken) {
      const valid = await verifySessionToken(sessionToken);
      if (valid) {
        const url = new URL("/admin", req.url);
        url.searchParams.delete("session");
        const res = NextResponse.redirect(url, 302);
        res.cookies.set(COOKIE_NAME, sessionToken, getCookieOptions());
        return res;
      }
      return NextResponse.redirect(new URL("/login", req.url), 302);
    }
  }
```

Then fix the now-unused imports: change the import on line 3 from

```ts
import { COOKIE_NAME, getCookieOptions, verifySessionToken } from "@/lib/session-jwt";
```

to (the POST `/login` rewrite and headers logic do not use any of them):

```ts
// (no session-jwt imports needed here anymore)
```

Confirm the remaining middleware body still references only `req`, `NextResponse`, and `process.env` — the POST `/login` → `/api/login` rewrite and the production security headers stay exactly as they are.

- [ ] **Step 7: Verify full suite + build**

Run: `npx vitest run`
Expected: PASS.

Run: `npm run build`
Expected: Build succeeds; no "unused variable" or type errors in `middleware.ts` or `login/route.ts`.

- [ ] **Step 8: Manual smoke (optional but recommended)**

Run: `npm run dev`, open `http://localhost:3000/login`, log in with `ADMIN_PASSWORD` (or `admin` in dev). Confirm: the URL after login is `/admin` with **no** `?session=` query string, and the admin page loads.

- [ ] **Step 9: Commit**

```bash
git add app/api/login/route.ts app/login/LoginForm.tsx middleware.ts tests/api/login.test.ts
git commit -m "fix(auth): set session cookie server-side; stop leaking JWT in the URL"
```

---

## Task 7: Distributed rate limiting via Upstash Redis (with in-memory fallback)

In-memory rate limiting resets on every serverless cold start and isn't shared across instances, so login brute-force protection is effectively bypassable on Vercel. Back it with Upstash Redis; fall back to in-memory when Redis env vars are absent (local dev).

**Files:**
- Modify: `package.json` (add `@upstash/redis`)
- Modify: `lib/ratelimit.ts`
- Create: `tests/lib/ratelimit.test.ts`
- Modify: `app/api/submit/route.ts`, `app/api/send_sms_task/route.ts`, `app/api/admin/force-init/route.ts`, `app/api/admin/broadcast/route.ts`, `app/api/admin/export-csv/route.ts` (await the now-async call)

> `app/api/login/route.ts` was already updated to `await checkRateLimit` in Task 6.

- [ ] **Step 1: Add the Upstash Redis dependency**

Run:

```bash
npm install @upstash/redis@^1.34.0
```

- [ ] **Step 2: Write the failing test (in-memory fallback path)**

Create `tests/lib/ratelimit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit } from "@/lib/ratelimit";

beforeEach(() => {
  // No Upstash env -> exercises the in-memory fallback.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("checkRateLimit (in-memory fallback)", () => {
  it("allows up to max requests then blocks", async () => {
    const ip = "rl-test-ip-1";
    const max = 3;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const { ok } = await checkRateLimit(ip, "unit-key", max);
      results.push(ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it("tracks different keys independently", async () => {
    const { ok: a } = await checkRateLimit("rl-test-ip-2", "key-a", 1);
    const { ok: b } = await checkRateLimit("rl-test-ip-2", "key-b", 1);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  it("returns a Promise (is async)", () => {
    expect(checkRateLimit("rl-test-ip-3", "key", 1)).toBeInstanceOf(Promise);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/lib/ratelimit.test.ts`
Expected: FAIL — `checkRateLimit` is currently synchronous, so `await`/`toBeInstanceOf(Promise)` behavior and the assertions don't hold as written.

- [ ] **Step 4: Rewrite `lib/ratelimit.ts`**

Replace the entire contents of `lib/ratelimit.ts` with:

```ts
import { Redis } from "@upstash/redis";

const WINDOW_MS = 60 * 1000; // 1 minute fixed window

// In-memory fallback (per serverless instance) — used only when Upstash is not configured.
const memStore = new Map<string, { count: number; resetAt: number }>();

let redisClient: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

function cleanupMemory(now: number): void {
  Array.from(memStore.entries()).forEach(([k, v]) => {
    if (v.resetAt < now) memStore.delete(k);
  });
}

function checkMemory(key: string, maxRequests: number): { ok: boolean; remaining: number } {
  const now = Date.now();
  if (memStore.size > 10000) cleanupMemory(now);
  let entry = memStore.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    memStore.set(key, entry);
  }
  entry.count += 1;
  return { ok: entry.count <= maxRequests, remaining: Math.max(0, maxRequests - entry.count) };
}

export async function checkRateLimit(
  ip: string,
  limitKey: string,
  maxRequests: number
): Promise<{ ok: boolean; remaining: number }> {
  const key = `rl:${ip}:${limitKey}`;
  const redis = getRedis();
  if (!redis) return checkMemory(key, maxRequests);
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, WINDOW_MS);
    return { ok: count <= maxRequests, remaining: Math.max(0, maxRequests - count) };
  } catch {
    // Redis hiccup — degrade gracefully to in-memory rather than locking users out.
    return checkMemory(key, maxRequests);
  }
}

// Predefined limits (same windows as the original Flask app).
export const LIMITS = {
  home: { max: 20, window: "minute" },
  submit: { max: 5, window: "minute" },
  login: { max: 5, window: "minute" },
  exportCsv: { max: 10, window: "hour" },
  broadcast: { max: 3, window: "hour" },
  forceInit: { max: 1, window: "hour" },
  sendSmsTask: { max: 100, window: "minute" },
  unsubscribe: { max: 10, window: "minute" },
} as const;
```

- [ ] **Step 5: Run the rate-limit test to verify it passes**

Run: `npx vitest run tests/lib/ratelimit.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: `await` the call at every remaining call site**

Make each of these edits (login was already done in Task 6):

In `app/api/submit/route.ts:28`:

```ts
  const { ok } = await checkRateLimit(ip, "submit", LIMITS.submit.max);
```

In `app/api/send_sms_task/route.ts:14`:

```ts
  const { ok } = await checkRateLimit(ip, "send_sms_task", LIMITS.sendSmsTask.max);
```

In `app/api/admin/force-init/route.ts:12`:

```ts
  const { ok: rateOk } = await checkRateLimit(ip, "force-init", LIMITS.forceInit.max);
```

In `app/api/admin/broadcast/route.ts:56`:

```ts
    const { ok: rateOk } = await checkRateLimit(ip, "broadcast", LIMITS.broadcast.max);
```

In `app/api/admin/export-csv/route.ts:12`:

```ts
  const { ok: rateOk } = await checkRateLimit(ip, "export-csv", LIMITS.exportCsv.max);
```

- [ ] **Step 7: Verify no synchronous (un-awaited) usages remain**

Run: `npx vitest run` then a grep to confirm every call site awaits:

```bash
grep -rn "checkRateLimit(" app lib | grep -v "await checkRateLimit" | grep -v "export async function checkRateLimit"
```

Expected: no output (every call site is awaited; only the definition and awaited calls exist).

- [ ] **Step 8: Build to catch any missed `await` (type: `Promise` used as object)**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json lib/ratelimit.ts tests/lib/ratelimit.test.ts \
  app/api/submit/route.ts app/api/send_sms_task/route.ts app/api/admin/force-init/route.ts \
  app/api/admin/broadcast/route.ts app/api/admin/export-csv/route.ts
git commit -m "feat(ratelimit): Upstash Redis backend with in-memory fallback; async API"
```

---

## Task 8: Remove dead dialect branch in toggle route (+ extract & test phone normalization)

`app/api/admin/toggle/route.ts` has identical Postgres/SQLite SQL strings (lines 36-38, 46-48) and inline phone-normalization logic. Extract the normalization to a tested helper and simplify the SQL branching.

**Files:**
- Modify: `lib/validation.ts`
- Modify: `app/api/admin/toggle/route.ts`
- Create: `tests/lib/normalize-admin-phone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/normalize-admin-phone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeAdminPhone } from "@/lib/validation";

describe("normalizeAdminPhone", () => {
  it("keeps a well-formed +972 number", () => {
    expect(normalizeAdminPhone("+972501234567")).toEqual({
      formatted: "+972501234567",
      clean: "972501234567",
    });
  });
  it("prefixes + onto a 972 number with no plus", () => {
    expect(normalizeAdminPhone("972501234567").formatted).toBe("+972501234567");
  });
  it("prefixes + onto a bare digit string", () => {
    expect(normalizeAdminPhone("0501234567").formatted).toBe("+0501234567");
  });
  it("strips non-digits for the clean form", () => {
    expect(normalizeAdminPhone("+972-50-123-4567").clean).toBe("972501234567");
  });
  it("caps the formatted value at 20 chars", () => {
    expect(normalizeAdminPhone("+9725012345670000000000").formatted.length).toBe(20);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/normalize-admin-phone.test.ts`
Expected: FAIL — `normalizeAdminPhone` is not exported from `@/lib/validation`.

- [ ] **Step 3: Add `normalizeAdminPhone` to `lib/validation.ts`**

Append to `lib/validation.ts`:

```ts
/**
 * Normalize an admin-supplied phone for block/unblock lookups.
 * Returns both the `formatted` (+E.164-ish, capped at 20 chars) and the
 * digits-only `clean` form used for a fallback LIKE match.
 */
export function normalizeAdminPhone(phone: string): { formatted: string; clean: string } {
  let formatted = phone.startsWith(" ") ? "+" + phone.trimStart() : phone;
  const clean = formatted.replace(/\D/g, "");
  if (clean.startsWith("972")) formatted = "+" + clean;
  else if (!formatted.startsWith("+")) formatted = "+" + clean;
  formatted = formatted.slice(0, 20);
  return { formatted, clean };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/normalize-admin-phone.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Use the helper and drop the dead branch in the toggle route**

In `app/api/admin/toggle/route.ts`, add to the import group:

```ts
import { normalizeAdminPhone } from "@/lib/validation";
```

Replace the body from the phone-normalization block through the end of the DB logic (currently lines 28-54) with:

```ts
  const { formatted, clean } = normalizeAdminPhone(phone);

  const db = getDb();
  const activeVal = action === "unblock";
  const setVal = db.type === "postgres" ? activeVal : activeVal ? 1 : 0;

  const { rowCount } = await runDb(
    db,
    "UPDATE customers SET active = $2 WHERE phone = $1",
    [formatted, setVal]
  );
  if (rowCount === 0 && clean) {
    await runDb(db, "UPDATE customers SET active = $2 WHERE phone LIKE $1", [`%${clean}`, setVal]);
  }
  if (activeVal) {
    await runDb(db, "UPDATE customers SET received_message_at = NULL WHERE phone = $1", [formatted]);
    if (rowCount === 0 && clean) {
      await runDb(db, "UPDATE customers SET received_message_at = NULL WHERE phone LIKE $1", [`%${clean}`]);
    }
  }
  if (db.type === "sqlite") db.conn.close();
```

- [ ] **Step 6: Verify suite + build**

Run: `npx vitest run`
Expected: PASS.

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/validation.ts app/api/admin/toggle/route.ts tests/lib/normalize-admin-phone.test.ts
git commit -m "refactor(toggle): extract tested normalizeAdminPhone, drop dead SQL branch"
```

---

## Task 9: Document new env vars + final full verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example`**

Replace the contents of `.env.example` with:

```bash
# Required in production
SECRET_KEY=CHANGE_THIS_TO_A_LONG_RANDOM_STRING

# Admin dashboard password (REQUIRED in production — the app refuses a default there)
ADMIN_PASSWORD=admin

# Database: use Postgres on Vercel (or omit for local SQLite)
# POSTGRES_URL=postgres://user:pass@host:5432/dbname?sslmode=require
# DATABASE_URL=postgres://...

# SMS Gateway (Android SMS Gateway app)
ANDROID_SMS_GATEWAY_LOGIN=
ANDROID_SMS_GATEWAY_PASSWORD=
ANDROID_SMS_GATEWAY_API_URL=https://api.sms-gate.app/3rdparty/v1

# QStash for queuing broadcast/birthday SMS
QSTASH_TOKEN=
# Set QSTASH_URL only for the EU region, e.g. https://eu1-xxxx.upstash.io
# QSTASH_URL=

# Upstash Redis for distributed rate limiting (recommended in production).
# Without these, rate limiting falls back to per-instance in-memory (fine for local dev).
# UPSTASH_REDIS_REST_URL=
# UPSTASH_REDIS_REST_TOKEN=

# Public base URL used for unsubscribe links / QStash callback when the
# request origin is unavailable. e.g. https://your-app.vercel.app
# APP_URL=

# Cron: protect birthday check endpoint
CRON_SECRET=YOUR_LONG_CRON_SECRET

# Vercel sets this automatically
# VERCEL_URL=
```

- [ ] **Step 2: Update the README env table**

In `README.md`, add these rows to the Vercel "Environment variables" table (after the `QSTASH_TOKEN` row):

```markdown
   | `QSTASH_URL` | No | Only for QStash EU region (e.g. `https://eu1-xxxx.upstash.io`). Default: global host. |
   | `UPSTASH_REDIS_REST_URL` | No* | Upstash Redis REST URL for distributed rate limiting. |
   | `UPSTASH_REDIS_REST_TOKEN` | No* | Upstash Redis REST token. |
   | `APP_URL` | No | Public base URL fallback for unsubscribe links / QStash callbacks. |
```

And add this note under the table:

```markdown
   \* Rate limiting falls back to per-instance in-memory storage when Upstash Redis is not configured. On Vercel (serverless), set the Upstash Redis vars so limits hold across instances and cold starts.
```

- [ ] **Step 3: Run the complete test suite**

Run: `npm test`
Expected: PASS — all suites: validation, dates, qstash, security-token, admin-auth, ratelimit, normalize-admin-phone, api/login.

- [ ] **Step 4: Run a production build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document QSTASH_URL, Upstash Redis, and APP_URL env vars"
```

---

## Post-implementation notes (for the deployer)

- **Set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` in Vercel** to make rate limiting effective in production. Create a free Upstash Redis database (separate from QStash) for these.
- **`ADMIN_PASSWORD` is now mandatory in production** — the app throws on login if it's unset, instead of silently accepting `admin`.
- **Old unsubscribe links keep working** thanks to legacy-token verification; new SMS use the stronger 128-bit token.
- No database migration is required — schema is unchanged.
```