# SMS Consent, Gifts & Waiter Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add legally-compliant SMS consent (Israeli Spam Law §30A) to the club signup, a gifts/redemption subsystem (joining + birthday + anniversary gifts), a restricted waiter role that can redeem gifts, an anniversary automation in the existing monthly cron, and a post-signup welcome SMS — plus a no-real-SMS verification report.

**Architecture:** Next.js 14 App Router app. `lib/db.ts` abstracts Postgres (prod) / SQLite (dev) behind `DbConnection` + `queryCustomers`/`runDb` (note: the SQLite shim rewrites `$N` placeholders to positional `?`, so **never reuse a `$N` twice in one statement**). SMS goes out only through QStash → `/api/send_sms_task` → Android SMS Gateway; an unsubscribe footer is appended there automatically. Sessions are JWTs in the `admin_session` cookie; all admin surfaces gate on `getAdminSession()`.

**Tech Stack:** TypeScript, Next.js 14, jose (JWT), pg / better-sqlite3, Upstash QStash, vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-consent-gifts-waiter-design.md` (read it first).

**Conventions for every task:**
- Run tests with `npm test -- --run <file>` or plain `npm test` (vitest).
- DB-logic tests run against in-memory better-sqlite3 connections — never against `customers.db`.
- Hebrew strings must be kept byte-exact as written in this plan.
- No task may send a real SMS or call the real QStash/gateway. All network calls in tests are stubbed.
- Commit after each task with the message given.

---

### Task 1: Schema — gifts table, consent columns, testable `applySchema`

**Files:**
- Modify: `lib/db.ts`
- Test: `tests/lib/schema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applySchema, type DbConnection } from "@/lib/db";

function memoryDb(): DbConnection {
  // Same loading style as lib/db.ts — better-sqlite3 is callable without `new`.
  const BetterSqlite3 = require("better-sqlite3");
  return { type: "sqlite", conn: BetterSqlite3(":memory:") } as DbConnection;
}

describe("applySchema", () => {
  it("creates customers with consent columns and the gifts table", async () => {
    const db = memoryDb();
    await applySchema(db);
    if (db.type !== "sqlite") throw new Error("expected sqlite");
    const custCols = db.conn.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
    const names = custCols.map((c) => c.name);
    expect(names).toContain("consent_at");
    expect(names).toContain("consent_version");
    expect(names).toContain("consent_ip");
    const giftCols = db.conn.prepare("PRAGMA table_info(gifts)").all() as { name: string }[];
    expect(giftCols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["id", "phone", "type", "period", "valid_from", "valid_until", "redeemed_at", "redeemed_by", "created_at"])
    );
  });

  it("is idempotent and enforces UNIQUE(phone, type, period)", async () => {
    const db = memoryDb();
    await applySchema(db);
    await applySchema(db); // second run must not throw
    if (db.type !== "sqlite") throw new Error("expected sqlite");
    db.conn
      .prepare("INSERT INTO gifts (phone, type, period, valid_from) VALUES (?, ?, ?, ?)")
      .run("+972501234567", "joining", "once", "2026-08-20");
    expect(() =>
      db.conn
        .prepare("INSERT INTO gifts (phone, type, period, valid_from) VALUES (?, ?, ?, ?)")
        .run("+972501234567", "joining", "once", "2026-08-20")
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/lib/schema.test.ts`
Expected: FAIL — `applySchema` is not exported.

- [ ] **Step 3: Implement `applySchema` in `lib/db.ts`**

Replace the existing `initDb` function (lines 104–148) with:

```ts
/**
 * Apply the full schema to an open connection. Exported separately from
 * initDb so tests can run it against an in-memory SQLite database.
 */
export async function applySchema(db: DbConnection): Promise<void> {
  const customersSchema = `
    CREATE TABLE IF NOT EXISTS customers (
      phone TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      wedding_day TEXT NOT NULL,
      city TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `;
  // Gift validity dates are Israel-local calendar dates (YYYY-MM-DD, TEXT in
  // both engines) so they compare correctly as strings.
  const giftsSchemaSqlite = `
    CREATE TABLE IF NOT EXISTS gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      type TEXT NOT NULL,
      period TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_until TEXT,
      redeemed_at TEXT,
      redeemed_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(phone, type, period)
    )
  `;
  const giftsSchemaPg = `
    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      type TEXT NOT NULL,
      period TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_until TEXT,
      redeemed_at TEXT,
      redeemed_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(phone, type, period)
    )
  `;
  if (db.type === "postgres") {
    const pgSchema = customersSchema
      .replace("INTEGER DEFAULT 1", "BOOLEAN DEFAULT TRUE")
      .replace("TEXT DEFAULT (datetime('now'))", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    await db.conn.query(pgSchema);
    const alters = [
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS received_message_at TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_version TEXT",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_ip TEXT",
    ];
    for (const sql of alters) await db.conn.query(sql).catch(() => {});
    await db.conn.query(giftsSchemaPg);
  } else {
    db.conn.exec(customersSchema);
    const alters = [
      "ALTER TABLE customers ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
      "ALTER TABLE customers ADD COLUMN received_message_at TEXT",
      "ALTER TABLE customers ADD COLUMN unsubscribed_at TEXT",
      "ALTER TABLE customers ADD COLUMN consent_at TEXT",
      "ALTER TABLE customers ADD COLUMN consent_version TEXT",
      "ALTER TABLE customers ADD COLUMN consent_ip TEXT",
    ];
    for (const sql of alters) {
      try {
        db.conn.prepare(sql).run();
      } catch {}
    }
    db.conn.exec(giftsSchemaSqlite);
  }
}

// Run schema init once per process to avoid repeated ALTERs
export async function initDb(): Promise<void> {
  if (typeof globalForDb._initDone === "boolean" && globalForDb._initDone) return;
  const db = getDb();
  await applySchema(db);
  if (db.type === "sqlite") db.conn.close();
  globalForDb._initDone = true;
}
```

Also extend `CustomerRow` (after `unsubscribed_at`) and `mapRow` accordingly:

```ts
  consent_at: string | null;
  consent_version: string | null;
  consent_ip: string | null;
```

and in `mapRow`'s returned object:

```ts
    consent_at: r.consent_at != null ? String(r.consent_at) : null,
    consent_version: r.consent_version != null ? String(r.consent_version) : null,
    consent_ip: r.consent_ip != null ? String(r.consent_ip) : null,
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run tests/lib/schema.test.ts` → PASS. Then `npm test` (full suite) → all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts tests/lib/schema.test.ts
git commit -m "feat(db): gifts table, consent columns, testable applySchema"
```

---

### Task 2: Gift domain helpers (pure functions)

**Files:**
- Create: `lib/gifts.ts`
- Test: `tests/lib/gifts-helpers.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/gifts-helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { monthPeriod, monthBounds, addDays, giftStatus, GIFT_LABELS, type GiftRow } from "@/lib/gifts";

function gift(overrides: Partial<GiftRow>): GiftRow {
  return {
    id: 1,
    phone: "+972501234567",
    type: "joining",
    period: "once",
    valid_from: "2026-08-20",
    valid_until: null,
    redeemed_at: null,
    redeemed_by: null,
    ...overrides,
  };
}

describe("period helpers", () => {
  it("monthPeriod extracts YYYY-MM", () => {
    expect(monthPeriod("2026-08-19")).toBe("2026-08");
  });
  it("monthBounds handles 31-day, 30-day, and February months", () => {
    expect(monthBounds("2026-08")).toEqual({ from: "2026-08-01", until: "2026-08-31" });
    expect(monthBounds("2026-04")).toEqual({ from: "2026-04-01", until: "2026-04-30" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", until: "2028-02-29" }); // leap
  });
  it("addDays rolls over month and year ends", () => {
    expect(addDays("2026-08-19", 1)).toBe("2026-08-20");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("giftStatus", () => {
  it("is not_yet before valid_from (day-after rule for joining gifts)", () => {
    expect(giftStatus(gift({ valid_from: "2026-08-20" }), "2026-08-19")).toBe("not_yet");
  });
  it("is available from valid_from, forever when valid_until is null", () => {
    expect(giftStatus(gift({ valid_from: "2026-08-20" }), "2026-08-20")).toBe("available");
    expect(giftStatus(gift({ valid_from: "2026-08-20" }), "2027-01-05")).toBe("available");
  });
  it("is expired after valid_until", () => {
    const g = gift({ type: "birthday", period: "2026-08", valid_from: "2026-08-01", valid_until: "2026-08-31" });
    expect(giftStatus(g, "2026-09-01")).toBe("expired");
    expect(giftStatus(g, "2026-08-31")).toBe("available");
  });
  it("is used once redeemed, regardless of dates", () => {
    expect(giftStatus(gift({ redeemed_at: "2026-08-21T10:00:00Z" }), "2026-08-25")).toBe("used");
  });
});

describe("labels", () => {
  it("has a Hebrew label per type", () => {
    expect(GIFT_LABELS.joining).toBe("מתנת הצטרפות");
    expect(GIFT_LABELS.birthday).toBe("מתנת יום הולדת");
    expect(GIFT_LABELS.anniversary).toBe("מתנת יום נישואין");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/lib/gifts-helpers.test.ts` → FAIL (module not found).

- [ ] **Step 3: Create `lib/gifts.ts` with the pure part**

```ts
import type { DbConnection } from "./db";
import { queryCustomers, runDb } from "./db";
import { getBirthMonth, israelToday } from "./dates";

export type GiftType = "joining" | "birthday" | "anniversary";

export const GIFT_LABELS: Record<GiftType, string> = {
  joining: "מתנת הצטרפות",
  birthday: "מתנת יום הולדת",
  anniversary: "מתנת יום נישואין",
};

export type GiftRow = {
  id: number;
  phone: string;
  type: GiftType;
  period: string; // 'once' for joining, 'YYYY-MM' for birthday/anniversary
  valid_from: string; // YYYY-MM-DD, Israel-local
  valid_until: string | null; // YYYY-MM-DD or null = never expires
  redeemed_at: string | null;
  redeemed_by: string | null;
};

export type GiftStatus = "available" | "not_yet" | "used" | "expired";

/** YYYY-MM-DD strings compare correctly as plain strings — no Date parsing needed. */
export function giftStatus(g: GiftRow, today: string = israelToday()): GiftStatus {
  if (g.redeemed_at) return "used";
  if (today < g.valid_from) return "not_yet";
  if (g.valid_until && today > g.valid_until) return "expired";
  return "available";
}

/** 'YYYY-MM' period key for an Israel-local date 'YYYY-MM-DD'. */
export function monthPeriod(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** First and last calendar day of a 'YYYY-MM' period. */
export function monthBounds(period: string): { from: string; until: string } {
  const [y, m] = period.split("-").map((n) => parseInt(n, 10));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, until: `${period}-${String(lastDay).padStart(2, "0")}` };
}

/** isoDate + n days as pure calendar arithmetic (no timezone involved). */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function mapGiftRow(r: Record<string, unknown>): GiftRow {
  return {
    id: Number(r.id),
    phone: String(r.phone ?? ""),
    type: String(r.type ?? "") as GiftType,
    period: String(r.period ?? ""),
    valid_from: String(r.valid_from ?? ""),
    valid_until: r.valid_until != null ? String(r.valid_until) : null,
    redeemed_at: r.redeemed_at != null ? String(r.redeemed_at) : null,
    redeemed_by: r.redeemed_by != null ? String(r.redeemed_by) : null,
  };
}
```

(The `queryCustomers`/`runDb`/`getBirthMonth` imports are used by Task 3 — leave them in place; if lint complains about unused imports at this point, add them in Task 3 instead.)

- [ ] **Step 4: Run tests**

Run: `npm test -- --run tests/lib/gifts-helpers.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/gifts.ts tests/lib/gifts-helpers.test.ts
git commit -m "feat(gifts): gift domain types, labels, period/status helpers"
```

---

### Task 3: Gift DB operations — issue, redeem (atomic), waiter search

**Files:**
- Modify: `lib/gifts.ts`
- Test: `tests/lib/gifts-db.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/gifts-db.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { applySchema, type DbConnection } from "@/lib/db";
import {
  issueGift,
  issueSignupGifts,
  issueMonthlyGifts,
  redeemGift,
  searchCustomersWithGifts,
} from "@/lib/gifts";

function memoryDb(): DbConnection {
  const BetterSqlite3 = require("better-sqlite3");
  return { type: "sqlite", conn: BetterSqlite3(":memory:") } as DbConnection;
}

async function seedCustomer(
  db: DbConnection,
  phone: string,
  opts: { name?: string; dob?: string; wedding?: string; active?: number } = {}
) {
  if (db.type !== "sqlite") throw new Error("expected sqlite");
  db.conn
    .prepare(
      "INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(phone, opts.name ?? "דנה", "a@b.co", opts.dob ?? "1990-08-15", opts.wedding ?? "", "גדרה", opts.active ?? 1);
}

let db: DbConnection;
beforeEach(async () => {
  db = memoryDb();
  await applySchema(db);
});

describe("issueGift", () => {
  it("inserts once and silently ignores duplicates", async () => {
    const first = await issueGift(db, {
      phone: "+972501111111",
      type: "joining",
      period: "once",
      validFrom: "2026-08-20",
      validUntil: null,
    });
    const second = await issueGift(db, {
      phone: "+972501111111",
      type: "joining",
      period: "once",
      validFrom: "2026-08-20",
      validUntil: null,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe("issueSignupGifts", () => {
  it("creates a joining gift valid from the next day", async () => {
    await seedCustomer(db, "+972501111111", { dob: "1990-01-15" });
    await issueSignupGifts(db, { phone: "+972501111111", dob: "1990-01-15", wedding: "" }, "2026-08-19");
    const [c] = await searchCustomersWithGifts(db, "0501111111", "2026-08-19");
    expect(c.gifts).toHaveLength(1);
    expect(c.gifts[0].type).toBe("joining");
    expect(c.gifts[0].valid_from).toBe("2026-08-20");
    expect(c.gifts[0].status).toBe("not_yet"); // signup day itself
  });

  it("also creates birthday/anniversary gifts when the month matches", async () => {
    await seedCustomer(db, "+972502222222", { dob: "1990-08-15", wedding: "2015-08-01" });
    await issueSignupGifts(db, { phone: "+972502222222", dob: "1990-08-15", wedding: "2015-08-01" }, "2026-08-19");
    const [c] = await searchCustomersWithGifts(db, "0502222222", "2026-08-19");
    const types = c.gifts.map((g) => g.type).sort();
    expect(types).toEqual(["anniversary", "birthday", "joining"]);
    const bday = c.gifts.find((g) => g.type === "birthday")!;
    expect(bday.valid_from).toBe("2026-08-01");
    expect(bday.valid_until).toBe("2026-08-31");
    expect(bday.status).toBe("available");
  });
});

describe("issueMonthlyGifts", () => {
  it("issues gifts to this month's celebrants only, skipping inactive members", async () => {
    await seedCustomer(db, "+972501111111", { name: "אבי", dob: "1990-08-15" }); // birthday this month
    await seedCustomer(db, "+972502222222", { name: "בני", dob: "1991-03-02", wedding: "2010-08-20" }); // anniversary
    await seedCustomer(db, "+972503333333", { name: "גדי", dob: "1992-01-01" }); // nothing this month
    await seedCustomer(db, "+972504444444", { name: "דנה", dob: "1993-08-05", active: 0 }); // unsubscribed
    const res = await issueMonthlyGifts(db, "2026-08-01");
    expect(res.birthday).toEqual([["+972501111111", "אבי"]]);
    expect(res.anniversary).toEqual([["+972502222222", "בני"]]);
    // Re-run: no duplicates, same celebrant lists
    const again = await issueMonthlyGifts(db, "2026-08-01");
    expect(again.birthday).toEqual([["+972501111111", "אבי"]]);
  });
});

describe("redeemGift", () => {
  async function issueJoining(phone: string) {
    await seedCustomer(db, phone);
    await issueGift(db, { phone, type: "joining", period: "once", validFrom: "2026-08-20", validUntil: null });
    const [c] = await searchCustomersWithGifts(db, phone.replace("+972", "0"), "2026-08-20");
    return c.gifts[0].id;
  }

  it("redeems an available gift exactly once", async () => {
    const id = await issueJoining("+972501111111");
    expect(await redeemGift(db, id, "waiter", "2026-08-20")).toBe(true);
    expect(await redeemGift(db, id, "waiter", "2026-08-20")).toBe(false); // no double redemption
  });

  it("refuses redemption before valid_from (joining reward day-after rule)", async () => {
    const id = await issueJoining("+972501111111");
    expect(await redeemGift(db, id, "waiter", "2026-08-19")).toBe(false);
  });

  it("refuses redemption after valid_until", async () => {
    await seedCustomer(db, "+972505555555");
    await issueGift(db, {
      phone: "+972505555555",
      type: "birthday",
      period: "2026-08",
      validFrom: "2026-08-01",
      validUntil: "2026-08-31",
    });
    const [c] = await searchCustomersWithGifts(db, "0505555555", "2026-08-15");
    expect(await redeemGift(db, c.gifts[0].id, "waiter", "2026-09-01")).toBe(false);
    expect(await redeemGift(db, c.gifts[0].id, "waiter", "2026-08-31")).toBe(true);
  });

  it("refuses redemption for inactive customers", async () => {
    await seedCustomer(db, "+972506666666", { active: 0 });
    await issueGift(db, { phone: "+972506666666", type: "joining", period: "once", validFrom: "2026-08-01", validUntil: null });
    if (db.type !== "sqlite") throw new Error("expected sqlite");
    const row = db.conn.prepare("SELECT id FROM gifts WHERE phone = ?").get("+972506666666") as { id: number };
    expect(await redeemGift(db, row.id, "waiter", "2026-08-20")).toBe(false);
  });
});

describe("searchCustomersWithGifts", () => {
  it("returns only name and phone (plus gifts) for matching active customers", async () => {
    await seedCustomer(db, "+972501111111", { name: "אבי כהן" });
    await seedCustomer(db, "+972502222222", { name: "אבי לוי", active: 0 });
    const results = await searchCustomersWithGifts(db, "אבי", "2026-08-19");
    expect(results).toHaveLength(1);
    expect(Object.keys(results[0]).sort()).toEqual(["gifts", "name", "phone"]);
    expect(results[0].name).toBe("אבי כהן");
  });

  it("matches by partial phone digits", async () => {
    await seedCustomer(db, "+972501234567", { name: "רות" });
    const results = await searchCustomersWithGifts(db, "0501234", "2026-08-19");
    expect(results).toHaveLength(1);
    expect(results[0].phone).toBe("+972501234567");
  });

  it("returns [] for a blank query instead of listing everyone", async () => {
    await seedCustomer(db, "+972501111111");
    expect(await searchCustomersWithGifts(db, "  ", "2026-08-19")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/lib/gifts-db.test.ts` → FAIL (functions not exported).

- [ ] **Step 3: Append the DB operations to `lib/gifts.ts`**

```ts
/**
 * Insert a gift; the UNIQUE(phone, type, period) key makes re-issues a no-op.
 * Returns true when a new row was actually created.
 */
export async function issueGift(
  db: DbConnection,
  gift: { phone: string; type: GiftType; period: string; validFrom: string; validUntil: string | null }
): Promise<boolean> {
  const sql =
    db.type === "postgres"
      ? `INSERT INTO gifts (phone, type, period, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (phone, type, period) DO NOTHING`
      : `INSERT OR IGNORE INTO gifts (phone, type, period, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5)`;
  const { rowCount } = await runDb(db, sql, [gift.phone, gift.type, gift.period, gift.validFrom, gift.validUntil]);
  return rowCount > 0;
}

/**
 * Gifts granted at signup: the Joining Reward (usable from the NEXT Israel-local
 * day, never expires), plus this month's birthday/anniversary gift when the
 * customer's celebration month is the current month (so mid-month joiners
 * aren't skipped by the cron that already ran on the 1st).
 */
export async function issueSignupGifts(
  db: DbConnection,
  customer: { phone: string; dob: string; wedding: string },
  today: string = israelToday()
): Promise<void> {
  const period = monthPeriod(today);
  const bounds = monthBounds(period);
  const currentMonth = parseInt(period.slice(5, 7), 10);
  await issueGift(db, { phone: customer.phone, type: "joining", period: "once", validFrom: addDays(today, 1), validUntil: null });
  // getBirthMonth parses the month out of any stored date string (dob or wedding).
  if (getBirthMonth(customer.dob) === currentMonth) {
    await issueGift(db, { phone: customer.phone, type: "birthday", period, validFrom: bounds.from, validUntil: bounds.until });
  }
  if (customer.wedding && getBirthMonth(customer.wedding) === currentMonth) {
    await issueGift(db, { phone: customer.phone, type: "anniversary", period, validFrom: bounds.from, validUntil: bounds.until });
  }
}

/**
 * Monthly cron: issue this month's birthday + anniversary gifts for all active
 * members and return the celebrant lists (for SMS queuing). Idempotent —
 * re-runs re-return the celebrants but create no duplicate gifts.
 */
export async function issueMonthlyGifts(
  db: DbConnection,
  today: string = israelToday()
): Promise<{ birthday: [string, string][]; anniversary: [string, string][] }> {
  const period = monthPeriod(today);
  const bounds = monthBounds(period);
  const currentMonth = parseInt(period.slice(5, 7), 10);
  const activeCondition = db.type === "postgres" ? "WHERE active = TRUE" : "WHERE active = 1";
  const rows = await queryCustomers(
    db,
    `SELECT phone, name, date_of_birth, wedding_day FROM customers ${activeCondition}`,
    []
  );
  const birthday: [string, string][] = [];
  const anniversary: [string, string][] = [];
  for (const row of rows) {
    const phone = String(row.phone);
    const name = String(row.name ?? "");
    if (getBirthMonth(row.date_of_birth as string) === currentMonth) {
      await issueGift(db, { phone, type: "birthday", period, validFrom: bounds.from, validUntil: bounds.until });
      birthday.push([phone, name]);
    }
    if (getBirthMonth(row.wedding_day as string) === currentMonth) {
      await issueGift(db, { phone, type: "anniversary", period, validFrom: bounds.from, validUntil: bounds.until });
      anniversary.push([phone, name]);
    }
  }
  return { birthday, anniversary };
}

/**
 * Atomically redeem a gift. The single conditional UPDATE is the
 * double-redemption guard: two concurrent attempts can't both match
 * `redeemed_at IS NULL`. Also enforces the validity window and that the
 * customer is still an active member.
 * NOTE: the SQLite shim maps $N -> positional ?, so `today` is bound twice
 * ($4 and $5) instead of reusing one placeholder.
 */
export async function redeemGift(
  db: DbConnection,
  giftId: number,
  redeemedBy: string,
  today: string = israelToday()
): Promise<boolean> {
  const now = new Date().toISOString();
  const activeTrue = db.type === "postgres" ? "TRUE" : "1";
  const { rowCount } = await runDb(
    db,
    `UPDATE gifts SET redeemed_at = $1, redeemed_by = $2
     WHERE id = $3
       AND redeemed_at IS NULL
       AND valid_from <= $4
       AND (valid_until IS NULL OR valid_until >= $5)
       AND phone IN (SELECT phone FROM customers WHERE active = ${activeTrue})`,
    [now, redeemedBy, giftId, today, today]
  );
  return rowCount > 0;
}

export type WaiterGift = {
  id: number;
  type: GiftType;
  label: string;
  status: GiftStatus;
  valid_from: string;
  valid_until: string | null;
  redeemed_at: string | null;
};

export type WaiterCustomer = { phone: string; name: string; gifts: WaiterGift[] };

/**
 * Waiter-facing search: matches active customers by partial name or phone
 * digits and returns ONLY name + phone + gifts. The column restriction lives
 * here in the SQL, not in the UI.
 */
export async function searchCustomersWithGifts(
  db: DbConnection,
  rawQuery: string,
  today: string = israelToday()
): Promise<WaiterCustomer[]> {
  const q = String(rawQuery ?? "").trim().slice(0, 50);
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  // Phones are stored E.164 (+9725x...); a waiter will type the local 05x...
  // form, so normalize a leading 0 to the 972 country code before matching.
  const normDigits = digits.startsWith("0") ? "972" + digits.slice(1) : digits;
  const activeCondition = db.type === "postgres" ? "active = TRUE" : "active = 1";
  const nameOp = db.type === "postgres" ? "ILIKE" : "LIKE";
  const phoneClause = digits ? " OR REPLACE(phone, '+', '') LIKE $2" : "";
  const params: unknown[] = digits ? [`%${q}%`, `%${normDigits}%`] : [`%${q}%`];
  const custRows = await queryCustomers(
    db,
    `SELECT phone, name FROM customers WHERE ${activeCondition} AND (name ${nameOp} $1${phoneClause}) ORDER BY name ASC LIMIT 20`,
    params
  );
  if (custRows.length === 0) return [];
  const phones = custRows.map((r) => String(r.phone));
  const placeholders = phones.map((_, i) => `$${i + 1}`).join(", ");
  const giftRows = await queryCustomers(
    db,
    `SELECT id, phone, type, period, valid_from, valid_until, redeemed_at, redeemed_by
     FROM gifts WHERE phone IN (${placeholders}) ORDER BY id ASC`,
    phones
  );
  const byPhone = new Map<string, WaiterGift[]>();
  for (const raw of giftRows) {
    const g = mapGiftRow(raw);
    const list = byPhone.get(g.phone) ?? [];
    list.push({
      id: g.id,
      type: g.type,
      label: GIFT_LABELS[g.type] ?? g.type,
      status: giftStatus(g, today),
      valid_from: g.valid_from,
      valid_until: g.valid_until,
      redeemed_at: g.redeemed_at,
    });
    byPhone.set(g.phone, list);
  }
  return custRows.map((r) => ({
    phone: String(r.phone),
    name: String(r.name ?? ""),
    gifts: byPhone.get(String(r.phone)) ?? [],
  }));
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run tests/lib/gifts-db.test.ts` → PASS. Then `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/gifts.ts tests/lib/gifts-db.test.ts
git commit -m "feat(gifts): issue/redeem/search operations with atomic redemption"
```

---

### Task 4: SMS message texts (brand: Oshi Oshi Gedera)

**Files:**
- Create: `lib/sms-messages.ts`
- Test: `tests/lib/sms-messages.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/sms-messages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BRAND, welcomeSms, birthdaySms, anniversarySms } from "@/lib/sms-messages";

describe("sms messages", () => {
  it("brand is Oshi Oshi Gedera", () => {
    expect(BRAND).toBe("Oshi Oshi Gedera");
  });
  // Israeli Spam Law §30A(e)(2): every promo SMS must carry the advertiser name.
  it("every message starts with the brand and includes the name", () => {
    for (const msg of [welcomeSms("דנה"), birthdaySms("דנה"), anniversarySms("דנה")]) {
      expect(msg.startsWith(`${BRAND}:`)).toBe(true);
      expect(msg).toContain("דנה");
    }
  });
  it("welcome message mentions the joining gift starting tomorrow", () => {
    expect(welcomeSms("דנה")).toContain("מתנת הצטרפות");
    expect(welcomeSms("דנה")).toContain("החל ממחר");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/lib/sms-messages.test.ts` → FAIL (module not found).

- [ ] **Step 3: Create `lib/sms-messages.ts`**

```ts
/**
 * All outbound SMS texts live here. Israeli Spam Law §30A(e)(2) requires every
 * promotional SMS to carry the advertiser's name; the opt-out footer is
 * appended automatically by /api/send_sms_task.
 */
export const BRAND = "Oshi Oshi Gedera";

export function welcomeSms(name: string): string {
  return `${BRAND}: היי ${name}, איזה כיף שהצטרפת אלינו! 🍣 מחכה לך מתנת הצטרפות במסעדה החל ממחר, ומעכשיו המבצעים, ההטבות וה-1+1 מגיעים ישירות אליך.`;
}

export function birthdaySms(name: string): string {
  return `${BRAND}: היי ${name}, חוגג/ת יום הולדת החודש? 🎂 מזל טוב! מחכה לך מתנת יום הולדת במסעדה. בואו לחגוג איתנו! 🍣`;
}

export function anniversarySms(name: string): string {
  return `${BRAND}: היי ${name}, חוגגים יום נישואין החודש? 💍 מזל טוב! מחכה לכם מתנת יום נישואין במסעדה. נשמח לחגוג איתכם! 🍣`;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run tests/lib/sms-messages.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sms-messages.ts tests/lib/sms-messages.test.ts
git commit -m "feat(sms): centralize message texts under Oshi Oshi Gedera brand"
```

---

### Task 5: Consent field — parse layer

**Files:**
- Create: `lib/consent.ts`
- Modify: `lib/submit-form.ts`
- Test: `tests/submit-form.test.ts` (modify existing)

- [ ] **Step 1: Create `lib/consent.ts`**

```ts
/**
 * Consent versioning: consent_version stored on the customer row must map
 * back to the exact wording the customer saw (burden of proof is on the
 * sender under Israeli Spam Law §30A). Bump the version whenever
 * CONSENT_TEXT changes, and never edit a past version's text.
 */
export const CONSENT_VERSION = "2026-08-19-v1";

export const CONSENT_TEXT =
  'אני מאשר/ת קבלת הודעות SMS פרסומיות ושיווקיות ממועדון הלקוחות של Oshi Oshi גדרה — כולל מבצעים, הטבות, 1+1 ועדכונים — למספר שמסרתי, בהתאם לתקנון המועדון ומדיניות הפרטיות. ניתן להסיר את ההסכמה בכל עת, ללא עלות, במענה לכל הודעה או בקישור ההסרה שבה.';
```

- [ ] **Step 2: Write the failing tests**

In `tests/submit-form.test.ts`, first add `consent: "on"` to every existing valid-input case (the suite will otherwise fail once consent is required), then add:

```ts
describe("consent", () => {
  const valid = {
    name: "דנה",
    phone: "0501234567",
    email: "a@b.co",
    date_of_birth: "1990-08-15",
    wedding_day: "",
    city: "גדרה",
  };
  it("rejects a submission without the consent checkbox", () => {
    const res = parseSubmitFields({ ...valid });
    expect(res).toEqual({ ok: false, error: "consent" });
  });
  it("accepts checkbox value 'on'", () => {
    const res = parseSubmitFields({ ...valid, consent: "on" });
    expect(res.ok).toBe(true);
  });
  it("rejects consent values that aren't an affirmative checkbox", () => {
    expect(parseSubmitFields({ ...valid, consent: "" }).ok).toBe(false);
    expect(parseSubmitFields({ ...valid, consent: "off" }).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- --run tests/submit-form.test.ts` → FAIL.

- [ ] **Step 4: Implement in `lib/submit-form.ts`**

- Extend the error type: `export type SubmitError = "missing" | "invalid_phone" | "invalid_email" | "consent";`
- Add `consent?: unknown;` to the `raw` parameter type of `parseSubmitFields`.
- After the email check, before `return { ok: true, ... }`, add:

```ts
  // HTML checkboxes submit "on" when checked and are absent when not.
  const consentGiven = raw.consent === "on" || raw.consent === "1" || raw.consent === "true" || raw.consent === true;
  if (!consentGiven) return { ok: false, error: "consent" };
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --run tests/submit-form.test.ts` → PASS. Then `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/consent.ts lib/submit-form.ts tests/submit-form.test.ts
git commit -m "feat(consent): require explicit SMS-consent checkbox at parse layer"
```

---

### Task 6: Submit route — store consent proof, issue gifts, queue welcome SMS

**Files:**
- Modify: `app/api/submit/route.ts`

No new unit test (the route's pieces are covered by Tasks 3/5; correctness here is wiring, verified by `npm run build` + the manual dev check in Task 12).

- [ ] **Step 1: Modify `app/api/submit/route.ts`**

Add imports at top:

```ts
import { issueSignupGifts } from "@/lib/gifts";
import { welcomeSms } from "@/lib/sms-messages";
import { CONSENT_VERSION } from "@/lib/consent";
import { resolveAppBaseUrl, publishSmsTask } from "@/lib/qstash";
import { getAppSecret } from "@/lib/security";
```

Pass the checkbox into the parser (in the `parseSubmitFields` call):

```ts
    consent: form.get("consent"),
```

Replace the INSERT statements so consent proof is stored on the row (note: new signups AND re-subscribes go through here, so `ON CONFLICT` also refreshes consent):

```ts
    const consentAt = new Date().toISOString();
    const insertSql =
      db.type === "postgres"
        ? `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active, consent_at, consent_version, consent_ip)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9)
           ON CONFLICT(phone) DO UPDATE SET active = TRUE, unsubscribed_at = NULL, name = EXCLUDED.name, email = EXCLUDED.email,
           date_of_birth = EXCLUDED.date_of_birth, wedding_day = EXCLUDED.wedding_day, city = EXCLUDED.city,
           consent_at = EXCLUDED.consent_at, consent_version = EXCLUDED.consent_version, consent_ip = EXCLUDED.consent_ip`
        : `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active, consent_at, consent_version, consent_ip)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)
           ON CONFLICT(phone) DO UPDATE SET active = 1, unsubscribed_at = NULL, name = excluded.name, email = excluded.email,
           date_of_birth = excluded.date_of_birth, wedding_day = excluded.wedding_day, city = excluded.city,
           consent_at = excluded.consent_at, consent_version = excluded.consent_version, consent_ip = excluded.consent_ip`;
    await runDb(db, insertSql, [phone, name, email, dob, wedding, city, consentAt, CONSENT_VERSION, ip]);
```

After the insert and **before** the sqlite `close()`, add gift issuance and the welcome SMS:

```ts
    // Joining Reward (+ same-month birthday/anniversary) — issued inside the
    // same request; duplicate-safe on re-subscribes via UNIQUE(phone,type,period).
    try {
      await issueSignupGifts(db, { phone, dob, wedding });
    } catch (e) {
      console.error("Failed to issue signup gifts for", phone, e);
    }
```

Then, after `if (db.type === "sqlite") db.conn.close();` and before the success response:

```ts
    // Welcome SMS — fire-and-forget: consent was just captured on this very
    // submission, and a QStash hiccup must never fail the signup.
    const qstashToken = process.env.QSTASH_TOKEN;
    const baseUrl = resolveAppBaseUrl(req.nextUrl.origin);
    if (qstashToken && baseUrl) {
      const r = await publishSmsTask({
        targetEndpoint: `${baseUrl}/api/send_sms_task`,
        phone,
        message: welcomeSms(name),
        secret: getAppSecret(),
        token: qstashToken,
        timeoutMs: 5000,
      });
      if (!r.ok) console.error("Failed to queue welcome sms for", phone, r.error);
    }
```

- [ ] **Step 2: Verify**

Run: `npm test` → PASS. Run: `npm run build` → compiles with no type errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/submit/route.ts
git commit -m "feat(signup): store consent proof, issue gifts, queue welcome SMS"
```

---

### Task 7: Signup form — explicit consent checkbox

**Files:**
- Modify: `app/VIPForm.tsx`

- [ ] **Step 1: Modify `app/VIPForm.tsx`**

Add to `ERROR_MESSAGES`:

```ts
  consent: "כדי להצטרף למועדון יש לאשר קבלת הודעות SMS",
```

Replace the trailing `<p className="consent">...</p>` block (lines 143–146) with nothing (it is superseded), and insert this **between the city field's closing `</div>` and the submit `<button>`** — a required checkbox, unchecked by default (Israeli Spam Law: pre-checked boxes are not express consent):

```tsx
        <div className="form-group consent-group">
          <label className="consent-label">
            <input type="checkbox" name="consent" required />
            <span>
              אני מאשר/ת קבלת הודעות SMS פרסומיות ושיווקיות ממועדון הלקוחות של Oshi Oshi גדרה — כולל
              מבצעים, הטבות, 1+1 ועדכונים — למספר שמסרתי, בהתאם ל
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                תקנון המועדון ומדיניות הפרטיות
              </a>
              . ניתן להסיר את ההסכמה בכל עת, ללא עלות, במענה &quot;{unsubKeyword}&quot; לכל הודעה או
              בקישור ההסרה שבה.
            </span>
          </label>
        </div>
```

Add minimal styles to `app/globals.css` (append at end):

```css
.consent-group {
  margin-top: 4px;
}
.consent-label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 0.85rem;
  line-height: 1.5;
  cursor: pointer;
}
.consent-label input[type="checkbox"] {
  margin-top: 3px;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: currentColor;
}
.consent-label a {
  text-decoration: underline;
}
```

- [ ] **Step 2: Verify**

Run: `npm run build` → compiles. (Visual check happens in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add app/VIPForm.tsx app/globals.css
git commit -m "feat(signup): explicit unchecked SMS-consent checkbox linking to /terms"
```

---

### Task 8: `/terms` page — club terms + privacy + SMS consent (Hebrew)

**Files:**
- Create: `app/terms/page.tsx`

- [ ] **Step 1: Create `app/terms/page.tsx`**

```tsx
// DRAFT — requires review by an Israeli lawyer before the business relies on it.
// Structured to satisfy: Communications Law §30A (spam), Privacy Protection Law
// §11 (notice at collection), §§13-14 (access/correction), §17F (deletion).

export const metadata = {
  title: "תקנון המועדון ומדיניות פרטיות | Oshi Oshi גדרה",
};

const UPDATED = "19.08.2026";

export default function TermsPage() {
  const keyword = (process.env.UNSUBSCRIBE_KEYWORD || "1111").trim();
  return (
    <main className="container terms-page" dir="rtl">
      <h1>תקנון מועדון הלקוחות ומדיניות פרטיות</h1>
      <p className="terms-updated">עדכון אחרון: {UPDATED}</p>

      <section>
        <h2>1. כללי</h2>
        <p>
          מועדון הלקוחות (&quot;המועדון&quot;) מופעל על ידי מסעדת Oshi Oshi גדרה (&quot;העסק&quot;).
          ההצטרפות למועדון ו/או השימוש בהטבותיו מהווים הסכמה לתקנון זה. ההצטרפות מיועדת לבני 18 ומעלה.
        </p>
      </section>

      <section>
        <h2>2. הצטרפות ומסירת פרטים</h2>
        <p>
          ההצטרפות נעשית בטופס ההרשמה באתר. אין חובה חוקית למסור את הפרטים, אך מסירתם נדרשת לצורך
          החברות במועדון. הפרטים הנאספים: שם, טלפון נייד, דוא&quot;ל, תאריך לידה, תאריך נישואין
          (לא חובה) ועיר מגורים.
        </p>
      </section>

      <section>
        <h2>3. הטבות המועדון</h2>
        <p>
          חברי המועדון עשויים ליהנות ממבצעים, הטבות 1+1, מתנת הצטרפות, מתנת יום הולדת ומתנת יום
          נישואין. ההטבות נקבעות על ידי העסק, ניתנות לשינוי או ביטול בכל עת, אינן ניתנות להמרה
          בכסף, ללא כפל מבצעים. מימוש מתנה ייעשה פעם אחת בלבד ובכפוף לתוקפה; מתנת ההצטרפות ניתנת
          למימוש החל מהיום שלמחרת ההצטרפות.
        </p>
      </section>

      <section>
        <h2>4. הסכמה לקבלת דיוור פרסומי (סעיף 30א לחוק התקשורת)</h2>
        <p>
          בסימון תיבת ההסכמה בטופס ההרשמה ניתנת הסכמה מפורשת, מראש ובכתב, לקבלת הודעות SMS פרסומיות
          ושיווקיות מהעסק — לרבות מבצעים, הטבות ועדכוני מועדון — למספר הטלפון שנמסר. ההסכמה מתועדת
          (מועד, נוסח ההסכמה וכתובת ה-IP) לצורך עמידה בדין.
        </p>
      </section>

      <section>
        <h2>5. הסרה מרשימת הדיוור</h2>
        <p>
          ניתן להסיר את ההסכמה בכל עת וללא תשלום: במענה &quot;{keyword}&quot; לכל הודעה, בלחיצה על
          קישור ההסרה המופיע בכל הודעה, או בפנייה לעסק. ההסרה תיכנס לתוקף מיידית. כמו כן, עומדת לכל
          חבר הזכות לדרוש בכתב את מחיקת פרטיו ממאגר המידע (סעיף 17ו לחוק הגנת הפרטיות).
        </p>
      </section>

      <section>
        <h2>6. פרטיות ושימוש במידע</h2>
        <p>
          הפרטים נשמרים במאגר המידע של העסק ומשמשים אך ורק לניהול המועדון ולמשלוח דיוור והטבות
          לחבריו. המידע לא יועבר לצדדים שלישיים, למעט ספקי תשתית ודיוור הפועלים עבור העסק בלבד,
          וככל שנדרש על פי דין.
        </p>
      </section>

      <section>
        <h2>7. אבטחת מידע ושמירת נתונים</h2>
        <p>
          העסק נוקט אמצעי אבטחה סבירים להגנה על המידע, ושומר אותו רק כל עוד הוא נדרש למטרות
          המועדון או כנדרש בדין.
        </p>
      </section>

      <section>
        <h2>8. עיון, תיקון ומחיקה</h2>
        <p>
          כל חבר זכאי לעיין במידע שנשמר עליו, לבקש את תיקונו או את מחיקתו, בהתאם לסעיפים 13–14
          ו-17ו לחוק הגנת הפרטיות, בפנייה לעסק בפרטי הקשר המופיעים בעמוד הראשי.
        </p>
      </section>

      <section>
        <h2>9. שינויים בתקנון</h2>
        <p>
          העסק רשאי לעדכן תקנון זה מעת לעת; הנוסח המעודכן יפורסם בעמוד זה בציון תאריך עדכון.
          שינוי מהותי באופי הדיוור יחייב הסכמה מחודשת.
        </p>
      </section>

      <section>
        <h2>10. דין וסמכות שיפוט</h2>
        <p>על תקנון זה יחול הדין הישראלי, וסמכות השיפוט נתונה לבתי המשפט המוסמכים במחוז המרכז.</p>
      </section>

      <p className="terms-draft-note">* נוסח זה הינו טיוטה וכפוף לאישור משפטי.</p>
    </main>
  );
}
```

Append to `app/globals.css`:

```css
.terms-page {
  padding-bottom: 48px;
}
.terms-page h1 {
  font-size: 1.6rem;
  margin-bottom: 4px;
}
.terms-page h2 {
  font-size: 1.1rem;
  margin: 20px 0 6px;
}
.terms-page p {
  line-height: 1.7;
}
.terms-updated,
.terms-draft-note {
  font-size: 0.8rem;
  opacity: 0.7;
}
```

- [ ] **Step 2: Verify**

Run: `npm run build` → compiles, `/terms` appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add app/terms/page.tsx app/globals.css
git commit -m "feat(terms): Hebrew club terms + privacy + SMS consent page (draft)"
```

---

### Task 9: Role-aware sessions (admin | waiter)

**Files:**
- Modify: `lib/session-jwt.ts`, `lib/auth.ts`, `lib/admin-auth.ts`
- Test: `tests/lib/session-role.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/session-role.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { createSessionJwt, getTokenRole, verifySessionToken, getSecret } from "@/lib/session-jwt";
import { verifyWaiterCredentials } from "@/lib/admin-auth";

describe("session roles", () => {
  it("admin token has role admin and passes verifySessionToken", async () => {
    const token = await createSessionJwt("admin");
    expect(await getTokenRole(token)).toBe("admin");
    expect(await verifySessionToken(token)).toBe(true);
  });
  it("waiter token has role waiter and FAILS the admin check", async () => {
    const token = await createSessionJwt("waiter");
    expect(await getTokenRole(token)).toBe("waiter");
    expect(await verifySessionToken(token)).toBe(false);
  });
  it("legacy {admin:true} tokens (issued before roles) still count as admin", async () => {
    const legacy = await new SignJWT({ admin: true })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(getSecret());
    expect(await getTokenRole(legacy)).toBe("admin");
  });
  it("garbage tokens have no role", async () => {
    expect(await getTokenRole("not-a-jwt")).toBe(null);
  });
});

describe("verifyWaiterCredentials", () => {
  it("accepts the configured username/password (username case-insensitive)", () => {
    process.env.WAITER_USERNAME = "melzar";
    process.env.WAITER_PASSWORD = "s3cret!";
    expect(verifyWaiterCredentials("melzar", "s3cret!")).toBe(true);
    expect(verifyWaiterCredentials("MELZAR", "s3cret!")).toBe(true);
    expect(verifyWaiterCredentials("melzar", "wrong")).toBe(false);
    expect(verifyWaiterCredentials("other", "s3cret!")).toBe(false);
  });
  it("rejects everything when the waiter account is not configured", () => {
    delete process.env.WAITER_USERNAME;
    delete process.env.WAITER_PASSWORD;
    expect(verifyWaiterCredentials("", "")).toBe(false);
    expect(verifyWaiterCredentials("melzar", "s3cret!")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run tests/lib/session-role.test.ts` → FAIL.

- [ ] **Step 3: Implement `lib/session-jwt.ts` changes**

Replace `createSessionJwt` and `verifySessionToken` with:

```ts
export type SessionRole = "admin" | "waiter";

export async function createSessionJwt(role: SessionRole = "admin"): Promise<string> {
  // `admin: true` kept on admin tokens for backward compatibility with
  // sessions issued before roles existed.
  const claims: Record<string, unknown> = role === "admin" ? { role, admin: true } : { role };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
  return token;
}

/** Role carried by a session token, or null when missing/invalid/expired. */
export async function getTokenRole(token: string): Promise<SessionRole | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.role === "waiter") return "waiter";
    if (payload.role === "admin" || payload.admin === true) return "admin";
    return null;
  } catch {
    return null;
  }
}

/** Admin-only check — every existing admin surface gates on this. */
export async function verifySessionToken(token: string): Promise<boolean> {
  return (await getTokenRole(token)) === "admin";
}
```

- [ ] **Step 4: Implement `lib/auth.ts` changes**

Replace the whole file body with:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  COOKIE_NAME,
  createSessionJwt,
  getTokenRole,
  getCookieOptions,
  type SessionRole,
} from "./session-jwt";

export async function setSession(role: SessionRole): Promise<void> {
  const token = await createSessionJwt(role);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, getCookieOptions());
}

/** Role of the current session, refreshing the cookie when valid. */
export async function getSessionRole(): Promise<SessionRole | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const role = await getTokenRole(token);
    if (!role) return null;
    try {
      await setSession(role);
    } catch {
      // Cookie refresh failed; token is still valid, allow access
    }
    return role;
  } catch {
    return null;
  }
}

export async function getAdminSession(): Promise<boolean> {
  return (await getSessionRole()) === "admin";
}

/** Call this on any admin API response (redirect or file) so the browser keeps the session. */
export async function attachSessionCookie(res: NextResponse, role: SessionRole = "admin"): Promise<NextResponse> {
  const token = await createSessionJwt(role);
  res.cookies.set(COOKIE_NAME, token, getCookieOptions());
  return res;
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
```

(`setAdminSession` had no callers outside this file except via login route which builds its own token — grep to confirm: `grep -rn "setAdminSession" app lib tests`. If any caller exists, keep `export const setAdminSession = () => setSession("admin");`.)

- [ ] **Step 5: Implement `lib/admin-auth.ts` addition**

Append:

```ts
function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Single waiter account from env. Both vars must be set for the account to
 * exist at all; username matches case-insensitively, password exactly.
 */
export function verifyWaiterCredentials(username: string, password: string): boolean {
  const expectedUser = (process.env.WAITER_USERNAME ?? "").trim();
  const expectedPass = process.env.WAITER_PASSWORD ?? "";
  if (!expectedUser || !expectedPass) return false;
  return (
    constantTimeEquals(String(username ?? "").trim().toLowerCase(), expectedUser.toLowerCase()) &&
    constantTimeEquals(String(password ?? ""), expectedPass)
  );
}
```

Also export `getSecret` from `lib/session-jwt.ts` if it isn't already exported (it is — confirm).

- [ ] **Step 6: Run tests**

Run: `npm test -- --run tests/lib/session-role.test.ts` → PASS. Then `npm test` → all PASS (the existing `tests/lib/admin-auth.test.ts` and `tests/api/login.test.ts` must still pass; the test env stubs must clean up `WAITER_*` vars — the new test deletes them in its own cases).

- [ ] **Step 7: Commit**

```bash
git add lib/session-jwt.ts lib/auth.ts lib/admin-auth.ts tests/lib/session-role.test.ts
git commit -m "feat(auth): role-aware sessions with waiter credentials"
```

---

### Task 10: Login — username field, waiter redirect

**Files:**
- Modify: `app/api/login/route.ts`, `app/login/LoginForm.tsx`

- [ ] **Step 1: Modify `app/api/login/route.ts`**

Replace the credential-reading and verification section with:

```ts
  let username = "";
  let password = "";
  try {
    const form = await req.formData();
    username = ((form.get("username") as string) ?? "").trim();
    password = (form.get("password") as string) ?? "";
  } catch {
    const body = await req.json().catch(() => ({}));
    username = ((body as { username?: string }).username ?? "").trim();
    password = (body as { password?: string }).password ?? "";
  }

  // No username (or "admin") = the owner logging in with the admin password,
  // exactly as before. Any other username is checked against the waiter account.
  if (!username || username.toLowerCase() === "admin") {
    if (verifyAdminPassword(password)) {
      const token = await createSessionJwt("admin");
      const res = NextResponse.json({ ok: true, role: "admin" });
      res.cookies.set(COOKIE_NAME, token, getCookieOptions());
      return res;
    }
  } else if (verifyWaiterCredentials(username, password)) {
    const token = await createSessionJwt("waiter");
    const res = NextResponse.json({ ok: true, role: "waiter" });
    res.cookies.set(COOKIE_NAME, token, getCookieOptions());
    return res;
  }

  return NextResponse.json({ ok: false, error: "wrong" }, { status: 401 });
```

and extend the import: `import { verifyAdminPassword, verifyWaiterCredentials } from "@/lib/admin-auth";`

- [ ] **Step 2: Modify `app/login/LoginForm.tsx`**

Add a username input above the password field:

```tsx
      <div className="form-group">
        <input
          type="text"
          name="username"
          placeholder="שם משתמש (ריק = מנהל)"
          autoComplete="username"
          disabled={loading}
        />
      </div>
```

and change the success redirect to honor the role:

```tsx
      if (res.ok && data.ok === true) {
        window.location.href = data.role === "waiter" ? "/waiter" : "/admin";
        return;
      }
```

- [ ] **Step 3: Verify**

Run: `npm test` → PASS (existing `tests/api/login.test.ts` posts password-only and must still get an admin session). Run: `npm run build` → compiles.

- [ ] **Step 4: Commit**

```bash
git add app/api/login/route.ts app/login/LoginForm.tsx
git commit -m "feat(login): username field routes to waiter or admin session"
```

---

### Task 11: Waiter APIs + page

**Files:**
- Create: `app/api/waiter/customers/route.ts`, `app/api/waiter/redeem/route.ts`, `app/waiter/page.tsx`, `app/waiter/WaiterPanel.tsx`
- Modify: `lib/ratelimit.ts` (add limit)

- [ ] **Step 1: Add rate limit**

In `lib/ratelimit.ts` `LIMITS`, add: `waiter: { max: 30, window: "minute" },`

- [ ] **Step 2: Create `app/api/waiter/customers/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionRole } from "@/lib/auth";
import { getDb, initDb } from "@/lib/db";
import { searchCustomersWithGifts } from "@/lib/gifts";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function GET(req: NextRequest) {
  const role = await getSessionRole();
  if (role !== "waiter" && role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "waiter", LIMITS.waiter.max);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  try {
    await initDb();
    const db = getDb();
    // searchCustomersWithGifts returns ONLY phone + name + gifts — the waiter
    // must never see email/birthday/city, enforced at the SQL level.
    const customers = await searchCustomersWithGifts(db, q);
    if (db.type === "sqlite") db.conn.close();
    return NextResponse.json({ customers });
  } catch (e) {
    console.error("Waiter search error:", e);
    return NextResponse.json({ error: "system" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create `app/api/waiter/redeem/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionRole } from "@/lib/auth";
import { getDb, initDb } from "@/lib/db";
import { redeemGift } from "@/lib/gifts";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const role = await getSessionRole();
  if (role !== "waiter" && role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "waiter", LIMITS.waiter.max);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let giftId: unknown;
  try {
    const body = await req.json();
    giftId = (body as { giftId?: unknown }).giftId;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const id = Number(giftId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  try {
    await initDb();
    const db = getDb();
    const redeemed = await redeemGift(db, id, role);
    if (db.type === "sqlite") db.conn.close();
    if (!redeemed) {
      // Already used, outside its validity window, or customer inactive.
      return NextResponse.json({ ok: false, error: "unavailable" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Waiter redeem error:", e);
    return NextResponse.json({ ok: false, error: "system" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create `app/waiter/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import WaiterPanel from "./WaiterPanel";

export const dynamic = "force-dynamic";

export default async function WaiterPage() {
  const role = await getSessionRole();
  if (role !== "waiter" && role !== "admin") redirect("/login");
  return (
    <main className="container waiter-page">
      <h1>מסך מלצרים 🍣</h1>
      <p className="waiter-sub">חיפוש לקוח לפי שם או טלפון, וסימון מתנות שמומשו.</p>
      <WaiterPanel />
    </main>
  );
}
```

- [ ] **Step 5: Create `app/waiter/WaiterPanel.tsx`**

```tsx
"use client";

import { useState } from "react";

type Gift = {
  id: number;
  type: string;
  label: string;
  status: "available" | "not_yet" | "used" | "expired";
  valid_from: string;
  valid_until: string | null;
  redeemed_at: string | null;
};
type Customer = { phone: string; name: string; gifts: Gift[] };

function statusText(g: Gift): string {
  switch (g.status) {
    case "available":
      return g.valid_until ? `זמינה למימוש עד ${g.valid_until}` : "זמינה למימוש";
    case "not_yet":
      return `זמינה החל מ-${g.valid_from}`;
    case "used":
      return `מומשה ב-${(g.redeemed_at ?? "").slice(0, 10)}`;
    case "expired":
      return "פג תוקף";
  }
}

export default function WaiterPanel() {
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(query: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/waiter/customers?q=${encodeURIComponent(query)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setCustomers(data.customers ?? []);
    } catch {
      setError("שגיאה בחיפוש. נסו שוב.");
    } finally {
      setLoading(false);
    }
  }

  async function redeem(gift: Gift) {
    if (!window.confirm(`לאשר מימוש "${gift.label}"? פעולה זו אינה ניתנת לביטול.`)) return;
    setError(null);
    try {
      const res = await fetch("/api/waiter/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ giftId: gift.id }),
      });
      if (res.status === 409) {
        setError("המתנה כבר מומשה או אינה בתוקף.");
      } else if (!res.ok) {
        setError("שגיאה במימוש. נסו שוב.");
      }
    } catch {
      setError("שגיאה במימוש. נסו שוב.");
    }
    await search(q); // always refresh so the screen shows the true state
  }

  return (
    <div className="waiter-panel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 2) search(q.trim());
        }}
      >
        <div className="form-group">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="שם או מספר טלפון (לפחות 2 תווים)"
            aria-label="חיפוש לקוח"
          />
        </div>
        <button type="submit" disabled={loading || q.trim().length < 2}>
          {loading ? "מחפש..." : "חיפוש"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {customers.map((c) => (
        <div key={c.phone} className="waiter-customer">
          <div className="waiter-customer-head">
            <strong>{c.name}</strong>
            <span dir="ltr">{c.phone}</span>
          </div>
          {c.gifts.length === 0 ? (
            <p className="waiter-no-gifts">אין מתנות ללקוח זה.</p>
          ) : (
            <ul className="waiter-gifts">
              {c.gifts.map((g) => (
                <li key={g.id} className={`waiter-gift status-${g.status}`}>
                  <span className="gift-label">{g.label}</span>
                  <span className="gift-status">{statusText(g)}</span>
                  {g.status === "available" && (
                    <button type="button" className="redeem-btn" onClick={() => redeem(g)}>
                      סימון כמומשה
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
```

Append to `app/globals.css`:

```css
.waiter-page h1 {
  margin-bottom: 2px;
}
.waiter-sub {
  opacity: 0.75;
  margin-bottom: 16px;
}
.waiter-customer {
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 10px;
  padding: 12px 14px;
  margin-top: 14px;
}
.waiter-customer-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.waiter-gifts {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.waiter-gift {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 0.9rem;
}
.waiter-gift .gift-status {
  opacity: 0.75;
}
.waiter-gift.status-used,
.waiter-gift.status-expired {
  opacity: 0.55;
}
.redeem-btn {
  margin-inline-start: auto;
  padding: 6px 12px;
  font-size: 0.85rem;
}
.waiter-no-gifts {
  opacity: 0.6;
  font-size: 0.85rem;
}
```

- [ ] **Step 6: Verify**

Run: `npm test` → PASS. Run: `npm run build` → compiles; `/waiter`, `/api/waiter/customers`, `/api/waiter/redeem` in route list.

- [ ] **Step 7: Commit**

```bash
git add app/api/waiter app/waiter lib/ratelimit.ts app/globals.css
git commit -m "feat(waiter): restricted waiter screen with gift redemption"
```

---

### Task 12: Monthly cron — birthdays + anniversaries + gift issuance

**Files:**
- Modify: `app/api/cron/birthday_check/route.ts`

- [ ] **Step 1: Rewrite the handler body**

Replace everything in `handleCron` after the auth check with:

```ts
  const db = getDb();
  // Issue this month's gifts FIRST — gift existence must never depend on
  // QStash being configured or reachable.
  const { birthday, anniversary } = await issueMonthlyGifts(db);
  if (db.type === "sqlite") db.conn.close();

  const baseUrl = resolveAppBaseUrl(req.nextUrl.origin);
  const targetEndpoint = `${baseUrl}/api/send_sms_task`;
  const secret = getAppSecret();
  let birthdayQueued = 0;
  let anniversaryQueued = 0;

  if (QSTASH_TOKEN && baseUrl) {
    for (const [phone, name] of birthday) {
      const r = await publishSmsTask({
        targetEndpoint,
        phone,
        message: birthdaySms(name),
        secret,
        token: QSTASH_TOKEN,
        timeoutMs: 5000,
      });
      if (r.ok) birthdayQueued += 1;
      else console.error("Failed to queue birthday sms for", phone, r.error);
    }
    for (const [phone, name] of anniversary) {
      const r = await publishSmsTask({
        targetEndpoint,
        phone,
        message: anniversarySms(name),
        secret,
        token: QSTASH_TOKEN,
        timeoutMs: 5000,
      });
      if (r.ok) anniversaryQueued += 1;
      else console.error("Failed to queue anniversary sms for", phone, r.error);
    }
  }

  return NextResponse.json({
    status: "success",
    birthdays: { found: birthday.length, queued: birthdayQueued },
    anniversaries: { found: anniversary.length, queued: anniversaryQueued },
  });
```

Update imports: remove `queryCustomers`/`getBirthMonth` if now unused; add:

```ts
import { initDb } from "@/lib/db";
import { issueMonthlyGifts } from "@/lib/gifts";
import { birthdaySms, anniversarySms } from "@/lib/sms-messages";
```

and call `await initDb();` before `getDb()` (the gifts table must exist).

`vercel.json` stays unchanged — `0 10 1 * *` already runs on the 1st of every month (10:00 UTC = 13:00 Israel), which is the required schedule.

- [ ] **Step 2: Verify**

Run: `npm test` → PASS. Run: `npm run build` → compiles.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/birthday_check/route.ts
git commit -m "feat(cron): monthly run issues birthday+anniversary gifts and queues both SMS"
```

---

### Task 13: Env template, README notes

**Files:**
- Modify: `.env.example`, `README.md`

- [ ] **Step 1: `.env.example`** — after the `ADMIN_PASSWORD` block add:

```
# Waiter account (single restricted login for the waiter screen at /waiter).
# Both must be set or waiter login is disabled entirely.
WAITER_USERNAME=
WAITER_PASSWORD=
```

- [ ] **Step 2: `README.md`** — add a short section (mirror the file's existing tone/structure) covering: the consent checkbox + `/terms` (lawyer review required before launch), the gifts table and redemption rules (joining = day after signup, never expires; birthday/anniversary = calendar month), the waiter login (`WAITER_USERNAME`/`WAITER_PASSWORD`, `/waiter`), and that the monthly cron now also handles anniversaries.

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: waiter account env vars and new club features"
```

---

### Task 14: Full verification (NO real SMS) + verification report

**Files:**
- Create: `docs/verification-report.md`

**Hard rule: do not set real `ANDROID_SMS_GATEWAY_*` or `QSTASH_TOKEN` values at any point; with them unset, every SMS path is a safe no-op or logged error.**

- [ ] **Step 1: Full test suite + build**

Run: `npm test` → all PASS. Run: `npm run build` → success.

- [ ] **Step 2: Manual dev-run smoke test (SQLite, no SMS env)**

Copy the dev db aside first: `Copy-Item customers.db customers.db.bak`. Then `npm run dev` and verify with curl/browser:
1. `GET /` shows the consent checkbox, unchecked; submitting without it is blocked by the browser (required) and `POST /api/submit` without `consent` returns `{"success":false,"error":"consent"}`.
2. A valid signup (with `consent=on`, `Accept: application/json`) returns success; the sqlite row has `consent_at/consent_version/consent_ip` set and a `joining` gift exists with `valid_from` = tomorrow (Israel).
3. `GET /terms` renders.
4. `GET /api/cron/birthday_check?secret=$env:CRON_SECRET` (with `CRON_SECRET` set in `.env.local`, QStash unset) returns `birthdays/anniversaries` counts with `queued: 0` and creates month-bound gift rows for matching customers — and **no SMS is sent** (no gateway env).
5. Login with waiter creds (set temp `WAITER_USERNAME`/`WAITER_PASSWORD` in `.env.local`) lands on `/waiter`; search shows only name+phone+gifts; redeeming an available gift works once and returns 409 the second time; `GET /admin` as waiter redirects to `/login`.
6. Restore: stop dev server, `Move-Item -Force customers.db.bak customers.db`, remove temp env values.

- [ ] **Step 3: Write `docs/verification-report.md`**

Structure (fill every line with the actual observed result, not "OK"):

```markdown
# Verification Report — SMS, Cron, Gifts (2026-08-19)

No real SMS was sent at any point: gateway/QStash credentials were never present
in the test environment; all network paths were stubbed or no-op.

## SMS configuration
- Provider: Android SMS Gateway (sms-gate.app) via Basic auth — configured in
  /api/send_sms_task; env vars required in prod: ANDROID_SMS_GATEWAY_LOGIN/PASSWORD/API_URL. [state what .env.example documents and what the code expects — matched/mismatched]
- Queue: Upstash QStash (QSTASH_TOKEN, optional QSTASH_URL for EU). Publish path verified by tests/lib/qstash.test.ts. [result]
- Opt-out: every SMS gets unsubscribe link + keyword appended in send_sms_task; inbound "1111" webhook at /api/sms/incoming verified by tests/lib/unsubscribe-webhook.test.ts. [result]
- Every message text starts with the advertiser name (Oshi Oshi Gedera) — tests/lib/sms-messages.test.ts. [result]

## Cron jobs
- vercel.json crons: exactly one — /api/cron/birthday_check at `0 10 1 * *` = 1st of every month, 10:00 UTC (13:00 Israel). Matches the requirement. [confirmed]
- The run is auth-protected by CRON_SECRET (Bearer or ?secret=). [confirmed]
- Birthday automation: issues month-bound birthday gifts + queues birthday SMS for active members with a birthday this month. [test/manual result]
- Anniversary automation: same run, wedding_day month match. [test/manual result]
- Idempotency: re-running the cron creates no duplicate gifts (UNIQUE(phone,type,period)). [test result]

## Gift data wiring
- Joining Reward: created on signup, valid from the NEXT Israel-local day, never expires, single-use. [test results]
- Birthday/anniversary gifts: valid only within their calendar month. [test results]
- Redemption: atomic conditional UPDATE — double redemption impossible; inactive customers blocked. [test results]

## Test suite
- `npm test`: [N] files, [M] tests, all passing. New coverage: schema, gift helpers, gift DB ops, sms messages, consent parsing, session roles.
- `npm run build`: success.

## Manual smoke test (local SQLite, no SMS env)
[record the six checks from Task 14 Step 2 with actual outcomes]

## Gaps / follow-ups
- /terms wording requires lawyer sign-off before launch.
- Production Postgres will get the gifts table + consent columns on first request after deploy (initDb) — verify once after deploying.
- WAITER_USERNAME/WAITER_PASSWORD must be set in Vercel env before the waiter can log in.
```

- [ ] **Step 4: Commit**

```bash
git add docs/verification-report.md
git commit -m "docs: verification report — SMS config, cron, gifts (no real SMS sent)"
```

---

## Task order & dependencies

1 → 2 → 3 (schema → helpers → DB ops), 4 and 5 independent after 1, 6 needs 3+4+5, 7 needs 5, 8 independent, 9 → 10 → 11 (auth chain), 12 needs 3+4, 13 anytime after 10, 14 last.
