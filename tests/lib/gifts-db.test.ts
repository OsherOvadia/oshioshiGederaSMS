import { describe, it, expect, beforeEach } from "vitest";
import { applySchema, type DbConnection } from "@/lib/db";
import {
  issueGift,
  issueSignupGifts,
  issueMonthlyGifts,
  redeemGift,
  searchCustomersWithGifts,
  listActiveCustomersWithGifts,
} from "@/lib/gifts";

function memoryDb(): DbConnection {
  const BetterSqlite3 = require("better-sqlite3");
  return { type: "sqlite", conn: BetterSqlite3(":memory:") } as DbConnection;
}

async function seedCustomer(
  db: DbConnection,
  phone: string,
  opts: { name?: string; dob?: string; wedding?: string; active?: number; joined?: string } = {}
) {
  if (db.type !== "sqlite") throw new Error("expected sqlite");
  db.conn
    .prepare(
      "INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      phone,
      opts.name ?? "דנה",
      "a@b.co",
      opts.dob ?? "1990-08-15",
      opts.wedding ?? "",
      "גדרה",
      opts.active ?? 1,
      // Default to a long-standing member so the "joined this month" skip in
      // issueMonthlyGifts doesn't silently swallow unrelated test cases.
      opts.joined ?? "2020-01-15 09:00:00"
    );
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
    const first = await issueSignupGifts(db, { phone: "+972501111111", dob: "1990-01-15", wedding: "" }, "2026-08-19");
    expect(first.joiningIssued).toBe(true);
    const again = await issueSignupGifts(db, { phone: "+972501111111", dob: "1990-01-15", wedding: "" }, "2026-08-19");
    expect(again.joiningIssued).toBe(false); // re-subscriber: joining gift already exists
    const [c] = await searchCustomersWithGifts(db, "0501111111", "2026-08-19");
    expect(c.gifts).toHaveLength(1);
    expect(c.gifts[0].type).toBe("joining");
    expect(c.gifts[0].valid_from).toBe("2026-08-20");
    expect(c.gifts[0].status).toBe("not_yet"); // signup day itself
  });

  it("does NOT grant a same-month celebration gift — declaring this month buys nothing", async () => {
    await seedCustomer(db, "+972502222222", { dob: "1990-08-15", wedding: "2015-08-01", joined: "2026-08-19 08:00:00" });
    await issueSignupGifts(db, { phone: "+972502222222", dob: "1990-08-15", wedding: "2015-08-01" }, "2026-08-19");
    const [c] = await searchCustomersWithGifts(db, "0502222222", "2026-08-19");
    expect(c.gifts.map((g) => g.type)).toEqual(["joining"]);
  });

  it("still gets the celebration gift the following year, from the cron", async () => {
    await seedCustomer(db, "+972502222222", { dob: "1990-08-15", joined: "2026-08-19 08:00:00" });
    await issueSignupGifts(db, { phone: "+972502222222", dob: "1990-08-15", wedding: "" }, "2026-08-19");
    // Next August the member is no longer a same-month joiner.
    const res = await issueMonthlyGifts(db, "2027-08-01");
    expect(res.birthday).toEqual([["+972502222222", "דנה"]]);
    const [c] = await searchCustomersWithGifts(db, "0502222222", "2027-08-05");
    const bday = c.gifts.find((g) => g.type === "birthday")!;
    expect(bday.valid_from).toBe("2027-08-01");
    expect(bday.valid_until).toBe("2027-08-31");
    expect(bday.status).toBe("available");
  });

  it("a member who joins in August with a September birthday gets it on 1 September", async () => {
    await seedCustomer(db, "+972507777777", { name: "ספטמבר", dob: "1990-09-10", joined: "2026-08-19 08:00:00" });
    await issueSignupGifts(db, { phone: "+972507777777", dob: "1990-09-10", wedding: "" }, "2026-08-19");
    const res = await issueMonthlyGifts(db, "2026-09-01");
    expect(res.birthday).toEqual([["+972507777777", "ספטמבר"]]);
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
    if (db.type !== "sqlite") throw new Error("expected sqlite");
    const countBefore = (db.conn.prepare("SELECT COUNT(*) AS n FROM gifts").get() as { n: number }).n;
    const again = await issueMonthlyGifts(db, "2026-08-01");
    expect(again.birthday).toEqual([["+972501111111", "אבי"]]);
    const countAfter = (db.conn.prepare("SELECT COUNT(*) AS n FROM gifts").get() as { n: number }).n;
    expect(countAfter).toBe(countBefore);
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
    // Pin the side effects (and the $1/$2 param order): the gift is now used,
    // redeemed_at is a recent ISO instant, redeemed_by is the waiter.
    const [c] = await searchCustomersWithGifts(db, "0501111111", "2026-08-20");
    const g = c.gifts[0];
    expect(g.status).toBe("used");
    expect(typeof g.redeemed_at).toBe("string");
    expect(new Date(g.redeemed_at!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(new Date(g.redeemed_at!).getTime()).toBeLessThanOrEqual(Date.now());
    if (db.type !== "sqlite") throw new Error("expected sqlite");
    const row = db.conn.prepare("SELECT redeemed_by FROM gifts WHERE id = ?").get(id) as { redeemed_by: string };
    expect(row.redeemed_by).toBe("waiter");
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

  it("escapes LIKE wildcards so '%%' cannot match everyone", async () => {
    await seedCustomer(db, "+972501111111");
    expect(await searchCustomersWithGifts(db, "%%", "2026-08-19")).toEqual([]);
  });

  it("excludes expired gifts from the returned list", async () => {
    await seedCustomer(db, "+972507777777", { name: "נועה" });
    await issueGift(db, {
      phone: "+972507777777",
      type: "birthday",
      period: "2026-07",
      validFrom: "2026-07-01",
      validUntil: "2026-07-31", // expired relative to today=2026-08-19
    });
    await issueGift(db, {
      phone: "+972507777777",
      type: "joining",
      period: "once",
      validFrom: "2026-08-01",
      validUntil: null,
    });
    const [c] = await searchCustomersWithGifts(db, "0507777777", "2026-08-19");
    expect(c.gifts).toHaveLength(1);
    expect(c.gifts[0].type).toBe("joining");
    expect(c.gifts[0].status).toBe("available");
  });
});

describe("postgres SQL branch", () => {
  // Same fake-connection pattern as tests/lib/schema.test.ts: capture the SQL
  // and params sent to a "postgres" connection without a real database.
  function fakePg() {
    const captured: { sql: string; params: unknown[] }[] = [];
    const fake = {
      type: "postgres",
      conn: {
        query: (sql: string, params: unknown[] = []) => {
          captured.push({ sql, params });
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
      },
    } as unknown as DbConnection;
    return { fake, captured };
  }

  it("uses PG dialect SQL and binds exactly one param per $N placeholder", async () => {
    const { fake, captured } = fakePg();
    await issueGift(fake, { phone: "+972501111111", type: "joining", period: "once", validFrom: "2026-08-20", validUntil: null });
    await redeemGift(fake, 1, "waiter", "2026-08-20");
    // Returns [] because the fake yields no rows — the SQL capture is the point.
    expect(await searchCustomersWithGifts(fake, "0501234", "2026-08-19")).toEqual([]);

    // Located by content, not by index: the statement order changes whenever a
    // guard query is added, and that shouldn't break a dialect assertion.
    const find = (needle: string) => captured.find((c) => c.sql.includes(needle))?.sql;

    const issueSql = find("INSERT INTO gifts");
    expect(issueSql).toContain("ON CONFLICT (phone, type, period) DO NOTHING");
    expect(issueSql).not.toContain("OR IGNORE");

    const redeemSql = find("UPDATE gifts SET");
    expect(redeemSql).toContain("active = TRUE");
    expect(redeemSql).not.toContain("active = 1");

    // "ESCAPE" is unique to the name-search statement (the redeem UPDATE also
    // contains a "FROM customers WHERE" subquery).
    const searchSql = find("ESCAPE");
    expect(searchSql).toContain("ILIKE");

    // The SQLite shim rewrites each $N to a positional ? — so every statement
    // must bind exactly as many params as it has $N placeholders (no reuse).
    expect(captured.length).toBeGreaterThan(0);
    for (const { sql, params } of captured) {
      expect((sql.match(/\$\d+/g) ?? []).length).toBe(params.length);
    }
  });
});

describe("listActiveCustomersWithGifts", () => {
  it("returns every active customer with only name, phone and gifts", async () => {
    await seedCustomer(db, "+972501111111", { name: "אבי כהן" });
    await seedCustomer(db, "+972502222222", { name: "בת שבע" });
    await seedCustomer(db, "+972503333333", { name: "מוסר", active: 0 });
    const rows = await listActiveCustomersWithGifts(db, "2026-08-19");
    expect(rows.map((r) => r.name)).toEqual(["אבי כהן", "בת שבע"]);
    expect(Object.keys(rows[0]).sort()).toEqual(["gifts", "name", "phone"]);
  });

  it("attaches each customer's gifts and hides expired ones", async () => {
    await seedCustomer(db, "+972501111111", { name: "אבי" });
    await issueGift(db, { phone: "+972501111111", type: "joining", period: "once", validFrom: "2026-08-20", validUntil: null });
    await issueGift(db, { phone: "+972501111111", type: "birthday", period: "2026-07", validFrom: "2026-07-01", validUntil: "2026-07-31" });
    const [c] = await listActiveCustomersWithGifts(db, "2026-08-19");
    expect(c.gifts).toHaveLength(1);
    expect(c.gifts[0].type).toBe("joining");
    expect(c.gifts[0].status).toBe("not_yet");
  });

  it("returns [] when there are no active customers", async () => {
    await seedCustomer(db, "+972509999999", { active: 0 });
    expect(await listActiveCustomersWithGifts(db, "2026-08-19")).toEqual([]);
  });
});

describe("same-month joiner rule (issueMonthlyGifts)", () => {
  it("skips a member who joined during the gift month, even on a cron re-run", async () => {
    await seedCustomer(db, "+972501111111", { name: "חדש", dob: "1990-08-15", joined: "2026-08-03 10:00:00" });
    await seedCustomer(db, "+972502222222", { name: "ותיק", dob: "1991-08-20", joined: "2025-02-02 10:00:00" });
    const res = await issueMonthlyGifts(db, "2026-08-06");
    expect(res.birthday).toEqual([["+972502222222", "ותיק"]]);
    const [fresh] = await searchCustomersWithGifts(db, "0501111111", "2026-08-06");
    expect(fresh.gifts).toEqual([]);
  });

  it("skips same-month joiners for anniversaries too", async () => {
    await seedCustomer(db, "+972503333333", { name: "נישואין", wedding: "2015-08-04", joined: "2026-08-02 10:00:00" });
    const res = await issueMonthlyGifts(db, "2026-08-06");
    expect(res.anniversary).toEqual([]);
  });

  it("includes a member who joined the month before", async () => {
    await seedCustomer(db, "+972504444444", { name: "יולי", dob: "1990-08-09", joined: "2026-07-28 10:00:00" });
    const res = await issueMonthlyGifts(db, "2026-08-01");
    expect(res.birthday).toEqual([["+972504444444", "יולי"]]);
  });
});

describe("legacy same-month celebration gifts are unusable", () => {
  // Simulates a row written by an older app version that granted the gift at
  // signup: member joined in 2026-08 and holds a 2026-08 birthday gift.
  async function seedLegacyRow() {
    await seedCustomer(db, "+972508888888", { name: "לגסי", dob: "1990-08-10", joined: "2026-08-19 08:00:00" });
    await issueGift(db, {
      phone: "+972508888888",
      type: "birthday",
      period: "2026-08",
      validFrom: "2026-08-01",
      validUntil: "2026-08-31",
    });
    if (db.type !== "sqlite") throw new Error("expected sqlite");
    const row = db.conn.prepare("SELECT id FROM gifts WHERE phone = ?").get("+972508888888") as { id: number };
    return row.id;
  }

  it("refuses redemption even though the validity window is open", async () => {
    const id = await seedLegacyRow();
    expect(await redeemGift(db, id, "waiter", "2026-08-25")).toBe(false);
  });

  it("is hidden from the waiter list and search", async () => {
    await seedLegacyRow();
    const [fromList] = await listActiveCustomersWithGifts(db, "2026-08-25");
    expect(fromList.gifts).toEqual([]);
    const [fromSearch] = await searchCustomersWithGifts(db, "לגסי", "2026-08-25");
    expect(fromSearch.gifts).toEqual([]);
  });

  it("does not affect the joining gift or a later period", async () => {
    await seedCustomer(db, "+972509999999", { name: "תקין", dob: "1990-08-10", joined: "2026-07-19 08:00:00" });
    await issueGift(db, { phone: "+972509999999", type: "joining", period: "once", validFrom: "2026-07-20", validUntil: null });
    await issueGift(db, { phone: "+972509999999", type: "birthday", period: "2026-08", validFrom: "2026-08-01", validUntil: "2026-08-31" });
    const [c] = await listActiveCustomersWithGifts(db, "2026-08-25");
    expect(c.gifts.map((g) => g.type).sort()).toEqual(["birthday", "joining"]);
    const bday = c.gifts.find((g) => g.type === "birthday")!;
    expect(await redeemGift(db, bday.id, "waiter", "2026-08-25")).toBe(true);
  });
});
